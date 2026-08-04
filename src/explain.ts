import {
  firstMatch,
  hardDenyPatterns,
  neverVersionedPatterns,
} from "./path-policy.js";

import type { AgentIdentity, FleetPolicy } from "./types.js";

export type ExplainOperation = "read" | "list" | "write";

/** Where a deciding pattern came from, so an operator knows which file to edit. */
export type RuleSource =
  | "hard-deny"
  | "never-versioned"
  | "agent-deny"
  | "agent-entry-reads"
  | "agent-read"
  | "agent-write"
  | "broker-allow";

export interface MatchedRule {
  source: RuleSource;
  pattern: string;
}

export interface AccessExplanation {
  path: string;
  operation: ExplainOperation;
  agentId: string;
  broker: string;
  branch: string;
  allowed: boolean;
  /** One sentence an operator can act on. */
  reason: string;
  /** The rule that produced the outcome, if a specific pattern decided it. */
  decidingRule: MatchedRule | null;
  /** Every rule consulted that matched, in precedence order. */
  matchedRules: MatchedRule[];
}

function denyRule(
  policy: FleetPolicy,
  identity: AgentIdentity,
  repoPath: string,
): MatchedRule | null {
  const hard = firstMatch(repoPath, [...hardDenyPatterns()]);
  if (hard) return { source: "hard-deny", pattern: hard };

  const neverVersioned = firstMatch(repoPath, neverVersionedPatterns(policy));
  if (neverVersioned) return { source: "never-versioned", pattern: neverVersioned };

  const agentDeny = firstMatch(repoPath, identity.agent.deny);
  if (agentDeny) return { source: "agent-deny", pattern: agentDeny };

  return null;
}

function readRule(identity: AgentIdentity, repoPath: string): MatchedRule | null {
  const entry = firstMatch(repoPath, identity.agent.entryReads);
  if (entry) return { source: "agent-entry-reads", pattern: entry };

  const read = firstMatch(repoPath, identity.agent.read);
  if (read) return { source: "agent-read", pattern: read };

  return null;
}

/**
 * Answer "would this identity be allowed to do this, and which rule decides?"
 * without performing the operation or touching GitHub.
 *
 * This deliberately mirrors the precedence in path-policy.ts: deny wins over
 * every grant, and a write needs both an agent grant and a broker grant. If the
 * two ever diverge, the tests in explain.test.ts fail.
 */
export function explainAccess(
  policy: FleetPolicy,
  identity: AgentIdentity,
  repoPath: string,
  operation: ExplainOperation,
): AccessExplanation {
  const base = {
    path: repoPath,
    operation,
    agentId: identity.agent.id,
    broker: identity.broker.name,
    branch: identity.broker.branch,
  };

  const deny = denyRule(policy, identity, repoPath);
  if (deny) {
    return {
      ...base,
      allowed: false,
      reason: `Denied by the ${deny.source} rule '${deny.pattern}'. Deny always beats a grant.`,
      decidingRule: deny,
      matchedRules: [deny],
    };
  }

  if (operation === "write") {
    const agentWrite = firstMatch(repoPath, identity.agent.write);
    const brokerAllow = firstMatch(repoPath, identity.broker.allow);
    const matched: MatchedRule[] = [];
    if (agentWrite) matched.push({ source: "agent-write", pattern: agentWrite });
    if (brokerAllow) matched.push({ source: "broker-allow", pattern: brokerAllow });

    if (agentWrite && brokerAllow) {
      return {
        ...base,
        allowed: true,
        reason:
          `Allowed. The agent grant '${agentWrite}' and the broker grant ` +
          `'${brokerAllow}' both cover this path, and no deny rule matches. ` +
          `The write would land on branch '${identity.broker.branch}'.`,
        decidingRule: { source: "agent-write", pattern: agentWrite },
        matchedRules: matched,
      };
    }

    const missing = !agentWrite
      ? `identity '${identity.agent.id}' has no write grant covering this path`
      : `broker '${identity.broker.name}' does not allow this path`;
    return {
      ...base,
      allowed: false,
      reason: `Denied. A write needs both an agent grant and a broker grant, and ${missing}.`,
      decidingRule: null,
      matchedRules: matched,
    };
  }

  const read = readRule(identity, repoPath);
  if (read) {
    return {
      ...base,
      allowed: true,
      reason: `Allowed by the ${read.source} rule '${read.pattern}', with no deny rule matching.`,
      decidingRule: read,
      matchedRules: [read],
    };
  }

  if (operation === "list") {
    // A directory is listable when it is a parent of something readable, even
    // if the directory path itself matches no read pattern.
    const prefix = `${repoPath}/`;
    const descendant = [...identity.agent.entryReads, ...identity.agent.read].find((pattern) =>
      pattern.replaceAll("\\", "/").startsWith(prefix),
    );
    if (descendant) {
      const rule: MatchedRule = { source: "agent-read", pattern: descendant };
      return {
        ...base,
        allowed: true,
        reason:
          `Allowed as a parent directory. No read rule names '${repoPath}' directly, ` +
          `but the grant '${descendant}' lies beneath it, so the directory must be ` +
          `listable to reach it. Listing is filtered to readable entries.`,
        decidingRule: rule,
        matchedRules: [rule],
      };
    }
  }

  return {
    ...base,
    allowed: false,
    reason:
      `Denied. No read grant for identity '${identity.agent.id}' covers this path. ` +
      `Access is deny-by-default, so an absent grant is a denial, not an oversight.`,
    decidingRule: null,
    matchedRules: [],
  };
}
