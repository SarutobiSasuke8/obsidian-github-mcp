import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

const baseEnv: NodeJS.ProcessEnv = {
  VAULT_MCP_POLICY_FILE: "./config/policy.yaml",
  VAULT_MCP_TOKEN_FILE: "./config/tokens.yaml",
  VAULT_MCP_GITHUB_OWNER: "example-owner",
  VAULT_MCP_GITHUB_REPO: "example-vault",
  GITHUB_TOKEN: "test-only-placeholder",
};

test("loads safe local defaults and explicit repository identity", () => {
  const config = loadConfig(baseEnv);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.githubOwner, "example-owner");
  assert.equal(config.githubRepo, "example-vault");
  assert.equal(config.trustProxyHops, 0);
  assert.equal(config.rateLimit, 120);
});

test("requires a repository and complete GitHub authentication", () => {
  assert.throws(() => loadConfig({ ...baseEnv, VAULT_MCP_GITHUB_REPO: undefined }));
  assert.throws(() =>
    loadConfig({
      ...baseEnv,
      GITHUB_TOKEN: undefined,
      GITHUB_APP_ID: "123",
    }),
  );
});

test("bounds proxy trust and rate-limit configuration", () => {
  assert.throws(() => loadConfig({ ...baseEnv, VAULT_MCP_TRUST_PROXY_HOPS: "99" }));
  assert.throws(() => loadConfig({ ...baseEnv, VAULT_MCP_RATE_LIMIT: "0" }));
});
