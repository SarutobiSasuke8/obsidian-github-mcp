import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArgs, propose } from '../../scripts/disposable-github-proof.mjs';

test('disposable proof refuses a real repository without explicit confirmation', () => {
  const saved = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-only-not-a-token';
  try {
    assert.equal(parseArgs(['propose']).dryRun, true, 'no repository named means dry run');
    assert.throws(() => parseArgs(['propose', '--owner', 'me', '--repo', 'vault']), /confirm-disposable/);
    assert.throws(() => parseArgs(['propose', '--owner', 'me', '--repo', 'vault', '--confirm-disposable', 'me/other']), /confirm-disposable/);
    assert.throws(() => parseArgs(['propose', '--dry-run', '--owner', 'me', '--repo', 'vault', '--confirm-disposable', 'me/vault']), /cannot be combined/);
    assert.throws(() => parseArgs(['verify']), /nothing to verify/);
    assert.equal(parseArgs(['propose', '--owner', 'me', '--repo', 'vault', '--confirm-disposable', 'me/vault']).dryRun, false);
    delete process.env.GITHUB_TOKEN;
    assert.throws(() => parseArgs(['propose', '--owner', 'me', '--repo', 'vault', '--confirm-disposable', 'me/vault']), /GITHUB_TOKEN/);
  } finally {
    if (saved === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = saved;
  }
});

test('dry run proposes through MCP against the local substitute and logs evidence', { timeout: 120_000 }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'vault-mcp-disposable-test-'));
  t.after(() => rm(temp, { recursive: true, force: true, maxRetries: 3 }));
  const log = path.join(temp, 'PROOF_LOG.md');
  const evidence = await propose(parseArgs(['propose', '--dry-run', '--log', log]));
  assert.equal(evidence.mode, 'dry run (local substitute)');
  assert.equal(evidence.repository, 'example/vault');
  assert.equal(evidence.branch, 'agent/example-writer');
  assert.match(evidence.path, /^Workspace\/Example Writer\/disposable-proof-.+\.md$/);
  assert.match(evidence.commit, /^commit-sha-/);
  assert.equal(evidence.reviewRequired, true);
  assert.ok(evidence.githubRequests >= 1);
  const written = await readFile(log, 'utf8');
  assert.match(written, /^# Proof log/);
  assert.ok(written.includes(evidence.path));
  assert.ok(!written.includes('dry-run-placeholder-token'), 'no token in the log');
  assert.ok(!written.includes('Safe to close without merging'), 'no note body in the log');
});
