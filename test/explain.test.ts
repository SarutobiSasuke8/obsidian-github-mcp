import assert from "node:assert/strict";
import test from "node:test";

import { explainAccess } from "../src/explain.js";
import { canListDirectory, canRead, canWrite } from "../src/path-policy.js";
import { parseFleetPolicy } from "../src/policy.js";
import { policyFixture } from "./fixtures.js";

import type { ExplainOperation } from "../src/explain.js";
import type { AgentIdentity } from "../src/types.js";

function identityFor(agentId: string, brokerName: string): AgentIdentity {
  const policy = parseFleetPolicy(policyFixture);
  const agent = policy.agents.get(agentId);
  const broker = policy.brokers.get(brokerName);
  assert.ok(agent, `fixture is missing agent '${agentId}'`);
  assert.ok(broker, `fixture is missing broker '${brokerName}'`);
  return { agent, broker };
}

const policy = parseFleetPolicy(policyFixture);

test("a hard deny is reported as the deciding rule", () => {
  const identity = identityFor("alpha-writer", "alpha");
  const result = explainAccess(policy, identity, ".env", "read");
  assert.equal(result.allowed, false);
  assert.equal(result.decidingRule?.source, "hard-deny");
  assert.match(result.reason, /Deny always beats a grant/u);
});

test("a never_versioned entry is distinguished from an agent deny", () => {
  const identity = identityFor("alpha-writer", "alpha");

  const neverVersioned = explainAccess(policy, identity, "Private/Notes.md", "read");
  assert.equal(neverVersioned.allowed, false);
  assert.equal(neverVersioned.decidingRule?.source, "never-versioned");

  // Beta is denied by this agent's own deny list, not by the global manifest.
  const agentDeny = explainAccess(policy, identity, "Workspace/Beta/Plan.md", "read");
  assert.equal(agentDeny.allowed, false);
  assert.equal(agentDeny.decidingRule?.source, "agent-deny");
  assert.equal(agentDeny.decidingRule?.pattern, "Workspace/Beta/**");
});

test("deny beats a read grant that also matches", () => {
  // README.md is in entry_reads AND in deny. Deny must win, and the
  // explanation must name the deny rule rather than the read grant.
  const identity = identityFor("alpha-writer", "alpha");
  const result = explainAccess(policy, identity, "README.md", "read");
  assert.equal(result.allowed, false);
  assert.equal(result.decidingRule?.source, "agent-deny");
  assert.equal(canRead(policy, identity, "README.md"), false);
});

test("an allowed write names both the agent grant and the broker grant", () => {
  const identity = identityFor("alpha-writer", "alpha");
  const result = explainAccess(policy, identity, "Workspace/Alpha/Tasks.md", "write");
  assert.equal(result.allowed, true);
  assert.equal(result.branch, "agent/alpha");

  const sources = result.matchedRules.map((rule) => rule.source);
  assert.deepEqual(sources, ["agent-write", "broker-allow"]);
  assert.match(result.reason, /branch 'agent\/alpha'/u);
});

test("a write blocked only by the broker says so specifically", () => {
  // alpha-writer has write: Workspace/Research/**, but broker alpha does not
  // allow it. The operator needs to know which of the two grants is missing.
  const identity = identityFor("alpha-writer", "alpha");
  const result = explainAccess(policy, identity, "Workspace/Research/Report.md", "write");
  assert.equal(result.allowed, false);
  assert.match(result.reason, /broker 'alpha' does not allow this path/u);
  assert.deepEqual(
    result.matchedRules.map((rule) => rule.source),
    ["agent-write"],
  );
});

test("a write blocked only by the agent grant says so specifically", () => {
  const identity = identityFor("research-writer", "research");
  const result = explainAccess(policy, identity, "Workspace/Alpha/Tasks.md", "write");
  assert.equal(result.allowed, false);
  assert.match(result.reason, /has no write grant covering this path/u);
});

test("a parent directory is listable because a grant lies beneath it", () => {
  // research-writer can read Workspace/Research/** but has no grant naming
  // "Workspace" itself. It must still be listable to reach the grant.
  const identity = identityFor("research-writer", "research");
  const result = explainAccess(policy, identity, "Workspace", "list");
  assert.equal(result.allowed, true);
  assert.match(result.reason, /Allowed as a parent directory/u);
  assert.equal(explainAccess(policy, identity, "Workspace", "read").allowed, false);
});

test("absent grants are explained as deny-by-default", () => {
  const identity = identityFor("research-writer", "research");
  const result = explainAccess(policy, identity, "Knowledge/Concepts.md", "read");
  assert.equal(result.allowed, false);
  assert.equal(result.decidingRule, null);
  assert.deepEqual(result.matchedRules, []);
  assert.match(result.reason, /deny-by-default/u);
});

test("explanations agree with the enforcement path on every fixture case", () => {
  // This is the test that matters. explainAccess duplicates the precedence
  // logic in path-policy.ts for reporting purposes, so it can silently drift
  // and start telling operators the opposite of what the server enforces.
  const paths = [
    "README.md",
    ".env",
    ".git/config",
    ".obsidian/workspace.json",
    "Private/Notes.md",
    "Knowledge/Concepts.md",
    "Workspace",
    "Workspace/Alpha",
    "Workspace/Alpha/Tasks.md",
    "Workspace/Beta/Plan.md",
    "Workspace/Shared/Brief.md",
    "Workspace/Research/Report.md",
    "Unmapped/Thing.md",
  ];
  const operations: ExplainOperation[] = ["read", "list", "write"];
  const enforcers = {
    read: canRead,
    list: canListDirectory,
    write: canWrite,
  } as const;

  for (const [agentId, brokerName] of [
    ["alpha-writer", "alpha"],
    ["research-writer", "research"],
  ] as const) {
    const identity = identityFor(agentId, brokerName);
    for (const repoPath of paths) {
      for (const operation of operations) {
        const explained = explainAccess(policy, identity, repoPath, operation).allowed;
        const enforced = enforcers[operation](policy, identity, repoPath);
        assert.equal(
          explained,
          enforced,
          `${agentId}/${brokerName} ${operation} '${repoPath}': explain said ${explained}, enforcement said ${enforced}`,
        );
      }
    }
  }
});
