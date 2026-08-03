import path from "node:path";

import { minimatch } from "minimatch";

import type { AgentIdentity, FleetPolicy } from "./types.js";

const HARD_DENY = [
  ".git/**",
  ".github/**",
  ".obsidian/**",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*credentials*",
];

export function normalizeRepoPath(input: string): string {
  const value = input.trim().normalize("NFC");
  if (!value) throw new Error("A non-empty repository-relative path is required.");
  if (value.includes("\\") || value.includes("\0") || /[\u0000-\u001f]/u.test(value)) {
    throw new Error("The path contains a forbidden character.");
  }
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value) || value.endsWith("/")) {
    throw new Error("Use a repository-relative path without a trailing slash.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Empty and dot path segments are forbidden.");
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value) throw new Error("The path is not canonical.");
  return normalized;
}

function patternMatches(repoPath: string, pattern: string): boolean {
  const cleanPattern = pattern.trim().replaceAll("\\", "/");
  if (!cleanPattern) return false;
  if (cleanPattern.endsWith("/**") && repoPath === cleanPattern.slice(0, -3)) return true;
  return minimatch(repoPath, cleanPattern, { dot: true, nocase: false });
}

function matchesAny(repoPath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => patternMatches(repoPath, pattern));
}

function globalDenyPatterns(policy: FleetPolicy): string[] {
  const manifestPaths = policy.neverVersioned.filter(
    (entry) => entry.includes("/") || entry.includes("*") || entry.startsWith("."),
  );
  return [...HARD_DENY, ...manifestPaths];
}

export function isDenied(policy: FleetPolicy, identity: AgentIdentity, repoPath: string): boolean {
  return matchesAny(repoPath, [...globalDenyPatterns(policy), ...identity.agent.deny]);
}

export function canRead(policy: FleetPolicy, identity: AgentIdentity, repoPath: string): boolean {
  if (isDenied(policy, identity, repoPath)) return false;
  return matchesAny(repoPath, [...identity.agent.entryReads, ...identity.agent.read]);
}

export function canListDirectory(
  policy: FleetPolicy,
  identity: AgentIdentity,
  repoPath: string,
): boolean {
  if (isDenied(policy, identity, repoPath)) return false;
  if (canRead(policy, identity, repoPath)) return true;
  const prefix = `${repoPath}/`;
  return [...identity.agent.entryReads, ...identity.agent.read].some((pattern) =>
    pattern.replaceAll("\\", "/").startsWith(prefix),
  );
}

export function canWrite(policy: FleetPolicy, identity: AgentIdentity, repoPath: string): boolean {
  if (isDenied(policy, identity, repoPath)) return false;
  return matchesAny(repoPath, identity.agent.write) && matchesAny(repoPath, identity.broker.allow);
}

export function assertReadable(
  policy: FleetPolicy,
  identity: AgentIdentity,
  repoPath: string,
): void {
  if (!canRead(policy, identity, repoPath)) {
    throw new Error(`Identity '${identity.agent.id}' may not read '${repoPath}'.`);
  }
}

export function assertListable(
  policy: FleetPolicy,
  identity: AgentIdentity,
  repoPath: string,
): void {
  if (!canListDirectory(policy, identity, repoPath)) {
    throw new Error(`Identity '${identity.agent.id}' may not list '${repoPath}'.`);
  }
}

export function assertWritable(
  policy: FleetPolicy,
  identity: AgentIdentity,
  repoPath: string,
): void {
  if (!canWrite(policy, identity, repoPath)) {
    throw new Error(`Identity '${identity.agent.id}' may not write '${repoPath}'.`);
  }
}
