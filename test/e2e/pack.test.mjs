import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const root = fileURLToPath(new URL('../../', import.meta.url));
const npm = (args, cwd) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000,
});

test('clean tarball enforces proposal, content and revocation boundaries through MCP HTTP', { timeout: 300_000 }, async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'vault-mcp-proof-'));
  let child;
  let client;
  t.after(async () => {
    await client?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('vault-mcp-proof-'));
    await rm(temp, { recursive: true, force: true, maxRetries: 3 });
  });
  npm(['pack', '--ignore-scripts', '--pack-destination', temp], root);
  const tarball = (await readdir(temp)).find(name => name.endsWith('.tgz'));
  assert.ok(tarball);
  const operator = path.join(temp, 'operator');
  await mkdir(operator);
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, tarball)], operator);
  const installed = path.join(operator, 'node_modules/@sarutobi-sasuke/obsidian-github-mcp');
  const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.bin['obsidian-github-mcp'], 'dist/src/index.js');
  await assert.rejects(() => readFile(path.join(installed, 'config/tokens.yaml')));
  await assert.rejects(() => readFile(path.join(installed, 'test/e2e/github-fixture.mjs')));
  const policyFile = path.join(operator, 'policy.yaml');
  const tokenFile = path.join(operator, 'tokens.yaml');
  const stateFile = path.join(operator, 'github-state.json');
  const auditFile = path.join(operator, 'audit.jsonl');
  const policy = await readFile(path.join(installed, 'config/policy.example.yaml'), 'utf8');
  await writeFile(policyFile, policy);
  const token = 'test-only-disposable-client-token';
  const tokenYaml = `version: 1\nagents:\n  - agent_id: example-writer\n    broker: example-writer\n    enabled: true\n    token_sha256: ${createHash('sha256').update(token).digest('hex')}\n    expires_at: 2099-01-01T00:00:00Z\n`;
  await writeFile(tokenFile, tokenYaml);
  const prefix = 'Workspace/Example Writer/';
  const immutable = '---\nmutability: immutable\n---\nOriginal immutable proof';
  const appendOnly = '---\nmutability: append-only\n---\nOriginal append proof';
  await writeFile(stateFile, JSON.stringify({ requests: [], files: {
    [`${prefix}Immutable.md`]: { sha: 'immutable', content: immutable },
    [`${prefix}Log.md`]: { sha: 'append', content: appendOnly },
    [`${prefix}Conflict.md`]: { sha: 'outdated', content: 'Existing content' },
  } }));
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  child = spawn(process.execPath, [
    '--import', pathToFileURL(path.join(root, 'test/e2e/github-fixture.mjs')).href,
    path.join(installed, 'dist/src/index.js'),
  ], { cwd: operator, env: {
    ...process.env, GITHUB_TOKEN: 'test-only-upstream-token', GITHUB_APP_ID: '',
    GITHUB_APP_INSTALLATION_ID: '', GITHUB_APP_PRIVATE_KEY_FILE: '',
    VAULT_MCP_HOST: '127.0.0.1', VAULT_MCP_PORT: String(port),
    VAULT_MCP_POLICY_FILE: policyFile, VAULT_MCP_TOKEN_FILE: tokenFile,
    VAULT_MCP_AUDIT_LOG: auditFile, VAULT_MCP_GITHUB_OWNER: 'example',
    VAULT_MCP_GITHUB_REPO: 'vault', PROOF_STATE: stateFile,
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const endpoint = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { healthy = (await fetch(`${endpoint}/healthz`)).ok; } catch { /* startup */ }
    if (healthy) break;
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(healthy, output);
  assert.equal((await fetch(`${endpoint}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  client = new Client({ name: 'packaged-proof', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const state = async () => JSON.parse(await readFile(stateFile, 'utf8'));
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(tools.includes('vault_create_file'));
  assert.ok(tools.every(name => !/merge|delete|execute/.test(name)));
  const content = '---\nmutability: review-first\n---\nUnique proposal body canary';
  const created = await call('vault_create_file', { path: `${prefix}Draft.md`, content, branch: 'main' });
  assert.notEqual(created.isError, true);
  assert.equal(created.structuredContent.review_required, true);
  assert.equal((await state()).files[`${prefix}Draft.md`].content, content);
  assert.notEqual((await call('vault_read_file', { path: `${prefix}Draft.md` })).isError, true);
  const beforeDenied = (await state()).requests.length;
  for (const args of [
    { path: '../README.md', content: 'blocked' },
    { path: 'Private/Hidden.md', content: 'blocked' },
    { path: `${prefix}run.ps1`, content: 'blocked' },
    { path: 'Workspace/Shared/NoFrontmatter.md', content: 'blocked' },
    { path: `${prefix}Secret.md`, content: 'api_key = abcdefghijklmnopqrstuvwxyz' },
  ]) assert.equal((await call('vault_create_file', args)).isError, true);
  assert.equal((await state()).requests.length, beforeDenied, 'denied writes never reach GitHub');
  assert.equal((await call('vault_update_file', { path: `${prefix}Immutable.md`, content: 'overwrite' })).isError, true);
  assert.equal((await call('vault_update_file', { path: `${prefix}Log.md`, content: 'overwrite' })).isError, true);
  assert.notEqual((await call('vault_append_file', { path: `${prefix}Log.md`, content: 'Approved suffix' })).isError, true);
  assert.equal((await state()).files[`${prefix}Log.md`].content, `${appendOnly}\nApproved suffix`);
  assert.equal((await call('vault_update_file', { path: `${prefix}Conflict.md`, content: 'replacement' })).isError, true);
  assert.equal((await state()).files[`${prefix}Conflict.md`].content, 'Existing content');
  await writeFile(policyFile, policy.replace('    read:', '    readd:'));
  assert.equal((await call('vault_whoami')).isError, true, 'invalid policy reload fails closed');
  await writeFile(policyFile, policy);
  await writeFile(tokenFile, tokenYaml.replace('enabled: true', 'enabled: false'));
  await assert.rejects(() => call('vault_whoami'), /401|disabled|invalid/i);
  const audit = await readFile(auditFile, 'utf8');
  for (const secret of [token, 'test-only-upstream-token', 'Unique proposal body canary', 'abcdefghijklmnopqrstuvwxyz']) {
    assert.ok(!audit.includes(secret), 'audit contains no token or submitted body');
  }
  assert.ok(audit.includes('content_sha256'));
  assert.ok((await state()).requests.every(request => request.branch === 'agent/example-writer'));
});
