import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import YAML from "yaml";
import { z } from "zod";

import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { AuthBinding } from "./types.js";

const bindingSchema = z.object({
  agent_id: z.string().min(1),
  broker: z.string().min(1),
  enabled: z.boolean().default(true),
  token_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  expires_at: z.string().datetime({ offset: true }),
});
const tokenFileSchema = z.object({ version: z.literal(1), agents: z.array(bindingSchema) });

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parseAuthBindings(yaml: string): AuthBinding[] {
  const parsed = tokenFileSchema.parse(YAML.parse(yaml));
  const seenAgents = new Set<string>();
  const seenHashes = new Set<string>();
  return parsed.agents.map((entry) => {
    if (seenAgents.has(entry.agent_id)) throw new Error(`Duplicate authenticated identity '${entry.agent_id}'.`);
    if (seenHashes.has(entry.token_sha256)) throw new Error("Duplicate token hash in auth file.");
    seenAgents.add(entry.agent_id);
    seenHashes.add(entry.token_sha256);
    return {
      agentId: entry.agent_id,
      broker: entry.broker,
      enabled: entry.enabled,
      tokenSha256: entry.token_sha256,
      expiresAt: Math.floor(new Date(entry.expires_at).getTime() / 1000),
    };
  });
}

function hashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export class TokenFileVerifier implements OAuthTokenVerifier {
  public constructor(private readonly tokenFile: string) {}

  public async verifyAccessToken(token: string): Promise<AuthInfo> {
    const bindings = parseAuthBindings(await readFile(this.tokenFile, "utf8"));
    const digest = sha256(token);
    const binding = bindings.find((candidate) => hashEquals(digest, candidate.tokenSha256));
    const now = Math.floor(Date.now() / 1000);
    if (!binding || !binding.enabled || binding.expiresAt <= now) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Unknown, disabled, or expired access token.");
    }
    return {
      token: `sha256:${digest}`,
      clientId: binding.agentId,
      scopes: ["vault"],
      expiresAt: binding.expiresAt,
      extra: { broker: binding.broker },
    };
  }
}
