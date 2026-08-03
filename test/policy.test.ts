import assert from "node:assert/strict";
import test from "node:test";

import {
  canListDirectory,
  canRead,
  canWrite,
  normalizeRepoPath,
} from "../src/path-policy.js";
import { parseFleetPolicy } from "../src/policy.js";
import { policyFixture } from "./fixtures.js";

test("parses the YAML policy and resolves broker branches", () => {
  const policy = parseFleetPolicy(policyFixture);
  assert.equal(policy.version, 1);
  assert.equal(policy.agents.get("alpha-writer")?.name, "Alpha Writer");
  assert.equal(policy.brokers.get("research")?.branch, "agent/research");
  assert.equal(policy.surfaceRules[0]?.requiredFrontmatter.disclosure, "public-safe");
});

test("write permission requires both agent and broker scopes", () => {
  const policy = parseFleetPolicy(policyFixture);
  const agent = policy.agents.get("alpha-writer")!;
  const broker = policy.brokers.get("alpha")!;
  const identity = { agent, broker };
  assert.equal(canWrite(policy, identity, "Workspace/Alpha/Tasks.md"), true);
  assert.equal(canWrite(policy, identity, "Workspace/Research/Report.md"), false);
});

test("deny overrides a broad read grant", () => {
  const policy = parseFleetPolicy(policyFixture);
  const identity = {
    agent: policy.agents.get("alpha-writer")!,
    broker: policy.brokers.get("alpha")!,
  };
  assert.equal(canRead(policy, identity, "Workspace/Shared/Handoff.md"), true);
  assert.equal(canRead(policy, identity, "Workspace/Beta/Private.md"), false);
  assert.equal(canRead(policy, identity, "Private/Person.md"), false);
  assert.equal(canListDirectory(policy, identity, "Workspace"), true);
});

test("normalizes safe paths and rejects traversal or Windows paths", () => {
  assert.equal(normalizeRepoPath("Workspace/Alpha/Tasks.md"), "Workspace/Alpha/Tasks.md");
  for (const invalid of ["../README.md", "Workspace/../README.md", "/Workspace/x.md", "C:/x.md", "a\\b.md", "a//b.md"]) {
    assert.throws(() => normalizeRepoPath(invalid));
  }
});

test("main is forbidden as a broker branch", () => {
  assert.throws(() => parseFleetPolicy(policyFixture.replace("branch: agent/alpha", "branch: main")));
});
