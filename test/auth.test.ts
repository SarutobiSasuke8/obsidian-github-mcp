import assert from "node:assert/strict";
import test from "node:test";

import { parseAuthBindings, sha256 } from "../src/auth.js";

test("parses agent-specific token bindings without storing raw tokens", () => {
  const hash = sha256("vault_example-token");
  const bindings = parseAuthBindings(`
version: 1
agents:
  - agent_id: alpha-writer
    broker: alpha
    enabled: true
    token_sha256: ${hash}
    expires_at: 2099-01-01T00:00:00Z
`);
  assert.equal(bindings[0]?.agentId, "alpha-writer");
  assert.equal(bindings[0]?.broker, "alpha");
  assert.equal(bindings[0]?.tokenSha256, hash);
});

test("rejects duplicate agent bindings", () => {
  const hashA = sha256("token-a");
  const hashB = sha256("token-b");
  assert.throws(() =>
    parseAuthBindings(`
version: 1
agents:
  - { agent_id: research-writer, broker: research, token_sha256: ${hashA}, expires_at: 2099-01-01T00:00:00Z }
  - { agent_id: research-writer, broker: research, token_sha256: ${hashB}, expires_at: 2099-01-01T00:00:00Z }
`),
  );
});

test("a misspelt disabling field cannot silently enable a token", () => {
  assert.throws(() => parseAuthBindings(`
version: 1
agents:
  - agent_id: alpha-writer
    broker: alpha
    enabld: false
    token_sha256: ${sha256("test-only")}
    expires_at: 2099-01-01T00:00:00Z
`), /Unrecognized key/u);
});
