import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { RepositoryEntry, RepositoryFile, WriteResult } from "./types.js";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const REQUEST_TIMEOUT_MS = 15_000;

export interface TokenProvider {
  getToken(): Promise<string>;
}

export class StaticTokenProvider implements TokenProvider {
  public constructor(private readonly token: string) {}
  public async getToken(): Promise<string> {
    return this.token;
  }
}

interface CachedInstallationToken {
  token: string;
  expiresAt: number;
}

export class GitHubAppTokenProvider implements TokenProvider {
  private cached?: CachedInstallationToken;

  public constructor(
    private readonly appId: string,
    private readonly installationId: string,
    private readonly privateKeyFile: string,
    private readonly repository: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  public async getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cached && this.cached.expiresAt - 60 > now) return this.cached.token;
    const jwt = await this.createAppJwt(now);
    const response = await this.fetchFn(
      `${API_ROOT}/app/installations/${encodeURIComponent(this.installationId)}/access_tokens`,
      {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: this.headers(jwt),
        body: JSON.stringify({ repositories: [this.repository], permissions: { contents: "write" } }),
      },
    );
    if (!response.ok) throw await githubError(response, "create an installation token");
    const body = (await response.json()) as { token?: unknown; expires_at?: unknown };
    if (typeof body.token !== "string" || typeof body.expires_at !== "string") {
      throw new Error("GitHub returned an invalid installation-token response.");
    }
    this.cached = {
      token: body.token,
      expiresAt: Math.floor(new Date(body.expires_at).getTime() / 1000),
    };
    return this.cached.token;
  }

  private async createAppJwt(now: number): Promise<string> {
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.appId }));
    const unsigned = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const signature = signer.sign(await readFile(this.privateKeyFile, "utf8"), "base64url");
    return `${unsigned}.${signature}`;
  }

  private headers(token: string): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "obsidian-github-mcp",
      "X-GitHub-Api-Version": API_VERSION,
    };
  }
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function encodePath(repoPath: string): string {
  return repoPath.split("/").map(encodeURIComponent).join("/");
}

async function githubError(response: Response, action: string): Promise<Error> {
  const requestId = response.headers.get("x-github-request-id");
  const raw = await response.text();
  let message = raw.slice(0, 500);
  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    // Keep the bounded response text.
  }
  return new Error(
    `GitHub could not ${action}: ${response.status} ${message}${requestId ? ` (request ${requestId})` : ""}`,
  );
}

export class GitHubRepositoryClient {
  public constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.tokenProvider.getToken();
    return this.fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "obsidian-github-mcp",
        "X-GitHub-Api-Version": API_VERSION,
        ...init.headers,
      },
    });
  }

  private contentUrl(repoPath: string, branch: string): string {
    const base = `${API_ROOT}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
    return `${base}/contents/${encodePath(repoPath)}?ref=${encodeURIComponent(branch)}`;
  }

  public async getFile(repoPath: string, branch: string): Promise<RepositoryFile> {
    const response = await this.request(this.contentUrl(repoPath, branch));
    if (!response.ok) throw await githubError(response, `read '${repoPath}'`);
    const body = (await response.json()) as Record<string, unknown>;
    if (body.type !== "file" || typeof body.sha !== "string" || typeof body.content !== "string") {
      throw new Error(`'${repoPath}' is not a regular file.`);
    }
    return {
      path: repoPath,
      sha: body.sha,
      content: Buffer.from(body.content.replaceAll("\n", ""), "base64").toString("utf8"),
      ...(typeof body.html_url === "string" ? { htmlUrl: body.html_url } : {}),
    };
  }

  public async listDirectory(repoPath: string, branch: string): Promise<RepositoryEntry[]> {
    const response = await this.request(this.contentUrl(repoPath, branch));
    if (!response.ok) throw await githubError(response, `list '${repoPath}'`);
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) throw new Error(`'${repoPath}' is not a directory.`);
    return body.map((raw) => {
      if (!raw || typeof raw !== "object") throw new Error("GitHub returned an invalid directory entry.");
      const entry = raw as Record<string, unknown>;
      if (
        typeof entry.path !== "string" ||
        typeof entry.name !== "string" ||
        typeof entry.sha !== "string" ||
        typeof entry.size !== "number" ||
        !["file", "dir", "symlink", "submodule"].includes(String(entry.type))
      ) {
        throw new Error("GitHub returned an invalid directory entry.");
      }
      return {
        path: entry.path,
        name: entry.name,
        type: entry.type as RepositoryEntry["type"],
        sha: entry.sha,
        size: entry.size,
        ...(typeof entry.html_url === "string" ? { htmlUrl: entry.html_url } : {}),
      };
    });
  }

  public async putFile(
    repoPath: string,
    branch: string,
    content: string,
    message: string,
    sha?: string,
  ): Promise<WriteResult> {
    const endpoint = this.contentUrl(repoPath, branch).split("?", 1)[0]!;
    const response = await this.request(endpoint, {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!response.ok) throw await githubError(response, `write '${repoPath}'`);
    const body = (await response.json()) as {
      content?: { sha?: unknown };
      commit?: { sha?: unknown; html_url?: unknown };
    };
    if (typeof body.content?.sha !== "string" || typeof body.commit?.sha !== "string") {
      throw new Error("GitHub returned an invalid write response.");
    }
    return {
      path: repoPath,
      branch,
      contentSha: body.content.sha,
      commitSha: body.commit.sha,
      ...(typeof body.commit.html_url === "string" ? { commitUrl: body.commit.html_url } : {}),
    };
  }
}
