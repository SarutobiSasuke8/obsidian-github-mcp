import path from "node:path";

import { z } from "zod";

const envSchema = z.object({
  VAULT_MCP_HOST: z.string().default("127.0.0.1"),
  VAULT_MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3210),
  VAULT_MCP_ALLOWED_HOSTS: z.string().optional(),
  VAULT_MCP_ALLOWED_ORIGINS: z.string().optional(),
  VAULT_MCP_POLICY_FILE: z.string().min(1),
  VAULT_MCP_TOKEN_FILE: z.string().min(1),
  VAULT_MCP_AUDIT_LOG: z.string().default("var/audit.jsonl"),
  VAULT_MCP_GITHUB_OWNER: z.string().min(1),
  VAULT_MCP_GITHUB_REPO: z.string().min(1),
  VAULT_MCP_MAX_FILE_BYTES: z.coerce.number().int().positive().max(1_048_576).default(262_144),
  VAULT_MCP_ALLOWED_EXTENSIONS: z.string().default(".md,.txt,.json,.yaml,.yml,.csv,.base"),
  VAULT_MCP_RATE_LIMIT: z.coerce.number().int().positive().max(10_000).default(120),
  VAULT_MCP_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  VAULT_MCP_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_FILE: z.string().optional(),
});

function csv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

export interface AppConfig {
  host: string;
  port: number;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  fleetFile: string;
  tokenFile: string;
  auditLog: string;
  githubOwner: string;
  githubRepo: string;
  maxFileBytes: number;
  allowedExtensions: Set<string>;
  rateLimit: number;
  rateWindowMs: number;
  trustProxyHops: number;
  githubToken?: string;
  githubApp?: { appId: string; installationId: string; privateKeyFile: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const appValues = [
    parsed.GITHUB_APP_ID,
    parsed.GITHUB_APP_INSTALLATION_ID,
    parsed.GITHUB_APP_PRIVATE_KEY_FILE,
  ];
  const hasAnyAppValue = appValues.some(Boolean);
  const hasAllAppValues = appValues.every(Boolean);
  if (hasAnyAppValue && !hasAllAppValues) {
    throw new Error("Set all three GitHub App variables or none of them.");
  }
  if (!hasAllAppValues && !parsed.GITHUB_TOKEN) {
    throw new Error("Configure a GitHub App or GITHUB_TOKEN.");
  }

  const allowedHosts = csv(parsed.VAULT_MCP_ALLOWED_HOSTS);
  const allowedOrigins = csv(parsed.VAULT_MCP_ALLOWED_ORIGINS);
  return {
    host: parsed.VAULT_MCP_HOST,
    port: parsed.VAULT_MCP_PORT,
    ...(allowedHosts ? { allowedHosts } : {}),
    ...(allowedOrigins ? { allowedOrigins } : {}),
    fleetFile: path.resolve(parsed.VAULT_MCP_POLICY_FILE),
    tokenFile: path.resolve(parsed.VAULT_MCP_TOKEN_FILE),
    auditLog: path.resolve(parsed.VAULT_MCP_AUDIT_LOG),
    githubOwner: parsed.VAULT_MCP_GITHUB_OWNER,
    githubRepo: parsed.VAULT_MCP_GITHUB_REPO,
    maxFileBytes: parsed.VAULT_MCP_MAX_FILE_BYTES,
    allowedExtensions: new Set(
      parsed.VAULT_MCP_ALLOWED_EXTENSIONS.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean),
    ),
    rateLimit: parsed.VAULT_MCP_RATE_LIMIT,
    rateWindowMs: parsed.VAULT_MCP_RATE_WINDOW_MS,
    trustProxyHops: parsed.VAULT_MCP_TRUST_PROXY_HOPS,
    ...(parsed.GITHUB_TOKEN ? { githubToken: parsed.GITHUB_TOKEN } : {}),
    ...(hasAllAppValues
      ? {
          githubApp: {
            appId: parsed.GITHUB_APP_ID!,
            installationId: parsed.GITHUB_APP_INSTALLATION_ID!,
            privateKeyFile: path.resolve(parsed.GITHUB_APP_PRIVATE_KEY_FILE!),
          },
        }
      : {}),
  };
}
