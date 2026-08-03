import path from "node:path";

import YAML from "yaml";
import { minimatch } from "minimatch";

import type { SurfaceRule } from "./types.js";

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u },
  {
    label: "credential assignment",
    pattern: /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/iu,
  },
];

export interface ContentPolicyOptions {
  allowedExtensions: Set<string>;
  maxFileBytes: number;
}

function frontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match?.[1]) return {};
  const parsed: unknown = YAML.parse(match[1]);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export function validateContent(
  repoPath: string,
  content: string,
  options: ContentPolicyOptions,
  surfaceRules: SurfaceRule[] = [],
): { mutability: string; reviewRequired: boolean } {
  const extension = path.posix.extname(repoPath).toLowerCase();
  if (!options.allowedExtensions.has(extension)) {
    throw new Error(`Files with extension '${extension || "(none)"}' are not allowed.`);
  }
  if (Buffer.byteLength(content, "utf8") > options.maxFileBytes) {
    throw new Error(`Content exceeds the ${options.maxFileBytes}-byte limit.`);
  }
  for (const secret of SECRET_PATTERNS) {
    if (secret.pattern.test(content)) throw new Error(`Content resembles a ${secret.label}; write rejected.`);
  }

  const metadata = frontmatter(content);
  const mutability = typeof metadata.mutability === "string" ? metadata.mutability : "living";
  for (const rule of surfaceRules) {
    if (!minimatch(repoPath, rule.path, { dot: true })) continue;
    for (const [field, requiredValue] of Object.entries(rule.requiredFrontmatter)) {
      if (metadata[field] !== requiredValue) {
        throw new Error(`'${repoPath}' must declare '${field}: ${requiredValue}' in frontmatter.`);
      }
    }
  }
  return { mutability, reviewRequired: mutability === "review-first" };
}

export function validateReplacement(existing: string, replacement: string): void {
  const existingMetadata = frontmatter(existing);
  const mutability = typeof existingMetadata.mutability === "string" ? existingMetadata.mutability : "living";
  if (mutability === "immutable") throw new Error("Immutable files cannot be updated.");
  if (mutability === "append-only" && !replacement.startsWith(existing)) {
    throw new Error("Append-only files must preserve their existing content byte-for-byte.");
  }
}

export function appendContent(existing: string, suffix: string): string {
  if (!suffix.trim()) throw new Error("Append content may not be empty.");
  const separator = existing.endsWith("\n") ? "" : "\n";
  return `${existing}${separator}${suffix}`;
}
