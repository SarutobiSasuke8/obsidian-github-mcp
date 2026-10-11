// Offline GitHub contents API for the mcp-eval contract suite.
//
// Preloaded into the server process with `node --import`, the same way the packaged e2e proof
// uses test/e2e/github-fixture.mjs. It replaces globalThis.fetch, so the server cannot reach
// the real GitHub API or any other host while the suite runs. Reads come from a committed
// fixture; writes are answered with fixed synthetic SHAs and change nothing, so every run sees
// the same repository state.
import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/github/repository.json", import.meta.url), "utf8"));
const contentsPrefix = `/repos/${fixture.owner}/${fixture.repo}/contents/`;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function blocked(url) {
  return new Error(`mcp-eval GitHub stub: outbound request blocked (${url.origin}${url.pathname})`);
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== "https://api.github.com" || !url.pathname.startsWith(contentsPrefix)) throw blocked(url);

  const repoPath = decodeURIComponent(url.pathname.slice(contentsPrefix.length));
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const branch = method === "PUT" ? body?.branch : url.searchParams.get("ref");
  if (branch !== fixture.branch) return json({ message: "No commit found for the ref" }, 404);

  if (method === "PUT") {
    const existing = fixture.files[repoPath];
    if (existing && body?.sha !== existing.sha) return json({ message: "sha does not match" }, 409);
    if (!existing && body?.sha) return json({ message: "sha does not match" }, 409);
    return json({ content: { sha: "eval-content-sha" }, commit: { sha: "eval-commit-sha" } }, existing ? 200 : 201);
  }
  if (method !== "GET") throw blocked(url);

  const file = fixture.files[repoPath];
  if (file) {
    return json({ type: "file", sha: file.sha, content: Buffer.from(file.content, "utf8").toString("base64") });
  }

  // A directory listing holds the direct children of repoPath, files and sub-directories.
  const prefix = `${repoPath}/`;
  const children = new Map();
  for (const [filePath, entry] of Object.entries(fixture.files)) {
    if (!filePath.startsWith(prefix)) continue;
    const [name, ...rest] = filePath.slice(prefix.length).split("/");
    const childPath = `${prefix}${name}`;
    if (rest.length > 0) {
      children.set(childPath, { path: childPath, name, type: "dir", sha: `dir-${name}`, size: 0 });
    } else {
      children.set(childPath, {
        path: childPath,
        name,
        type: "file",
        sha: entry.sha,
        size: Buffer.byteLength(entry.content, "utf8"),
      });
    }
  }
  if (children.size > 0) return json([...children.values()].sort((a, b) => a.path.localeCompare(b.path)));
  return json({ message: "Not Found" }, 404);
};
