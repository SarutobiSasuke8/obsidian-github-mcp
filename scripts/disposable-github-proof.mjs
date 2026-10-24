#!/usr/bin/env node
// Disposable GitHub proposal/review proof (roadmap md-0288119a98).
//
//   node scripts/disposable-github-proof.mjs propose --dry-run [--log <file>]
//   node scripts/disposable-github-proof.mjs propose --owner <o> --repo <r> --confirm-disposable <o>/<r> [--log <file>]
//   node scripts/disposable-github-proof.mjs verify  --owner <o> --repo <r> --confirm-disposable <o>/<r> [--log <file>]
//
// propose starts the built server (dist/), connects a real MCP client and has
// the example-writer agent create one proposal file on its fixed branch. With
// --dry-run (the default when no repository is named) every GitHub call goes to
// the local substitute in test/e2e/github-fixture.mjs and no network is used.
// verify (live only) reads the pull request from that branch and records the
// human review. Evidence goes to QA/PROOF_LOG.md unless --log says otherwise.
//
// Safety: a real repository is touched only when --owner, --repo and a matching
// --confirm-disposable are all given. GITHUB_TOKEN is read from the environment
// only and is never printed or written. The script never merges, deletes or
// approves anything.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const root = fileURLToPath(new URL('../', import.meta.url));
const AGENT = 'example-writer';
const BRANCH = 'agent/example-writer';
const PREFIX = 'Workspace/Example Writer/';

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, dryRun: false, log: path.join(root, 'QA/PROOF_LOG.md') };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = () => {
      const next = rest[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${flag} needs a value`);
      index += 1;
      return next;
    };
    if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--owner') options.owner = value();
    else if (flag === '--repo') options.repo = value();
    else if (flag === '--confirm-disposable') options.confirm = value();
    else if (flag === '--log') options.log = path.resolve(value());
    else throw new Error(`Unknown option ${flag}`);
  }
  if (command !== 'propose' && command !== 'verify') throw new Error('Command must be propose or verify');
  const live = Boolean(options.owner || options.repo || options.confirm);
  if (!live) options.dryRun = true;
  if (options.dryRun && live) throw new Error('--dry-run cannot be combined with a real repository');
  if (options.dryRun && command === 'verify') throw new Error('verify reads a real pull request; there is nothing to verify in a dry run');
  if (!options.dryRun) {
    if (!options.owner || !options.repo) throw new Error('A live run needs --owner and --repo');
    if (options.confirm !== `${options.owner}/${options.repo}`) {
      throw new Error('--confirm-disposable must repeat <owner>/<repo> exactly');
    }
    if (!process.env.GITHUB_TOKEN) throw new Error('Set GITHUB_TOKEN (a fine-grained token for the disposable repository only)');
  }
  return options;
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function github(pathname, token) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub ${pathname.split('?')[0]} returned ${response.status}`);
  return response.json();
}

export async function propose(options) {
  const owner = options.dryRun ? 'example' : options.owner;
  const repo = options.dryRun ? 'vault' : options.repo;
  const serverEntry = path.join(root, 'dist/src/index.js');
  await readFile(serverEntry).catch(() => { throw new Error('Build first: npm run build'); });
  if (!options.dryRun) await github(`/repos/${owner}/${repo}/branches/${encodeURIComponent(BRANCH)}`, process.env.GITHUB_TOKEN)
    .catch(() => { throw new Error(`Create the branch ${BRANCH} in ${owner}/${repo} first`); });

  const work = await mkdtemp(path.join(os.tmpdir(), 'vault-mcp-disposable-'));
  let child;
  let client;
  try {
    const clientToken = randomBytes(32).toString('hex');
    const policyFile = path.join(work, 'policy.yaml');
    const tokenFile = path.join(work, 'tokens.yaml');
    const stateFile = path.join(work, 'github-state.json');
    await copyFile(path.join(root, 'config/policy.example.yaml'), policyFile);
    await writeFile(tokenFile, `version: 1\nagents:\n  - agent_id: ${AGENT}\n    broker: ${AGENT}\n    enabled: true\n    token_sha256: ${createHash('sha256').update(clientToken).digest('hex')}\n    expires_at: 2099-01-01T00:00:00Z\n`);
    await writeFile(stateFile, JSON.stringify({ requests: [], files: {} }));
    const port = await freePort();
    const args = options.dryRun
      ? ['--import', pathToFileURL(path.join(root, 'test/e2e/github-fixture.mjs')).href, serverEntry]
      : [serverEntry];
    child = spawn(process.execPath, args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, GITHUB_APP_ID: '', GITHUB_APP_INSTALLATION_ID: '', GITHUB_APP_PRIVATE_KEY_FILE: '',
      GITHUB_TOKEN: options.dryRun ? 'dry-run-placeholder-token' : process.env.GITHUB_TOKEN,
      VAULT_MCP_HOST: '127.0.0.1', VAULT_MCP_PORT: String(port),
      VAULT_MCP_POLICY_FILE: policyFile, VAULT_MCP_TOKEN_FILE: tokenFile,
      VAULT_MCP_AUDIT_LOG: path.join(work, 'audit.jsonl'),
      VAULT_MCP_GITHUB_OWNER: owner, VAULT_MCP_GITHUB_REPO: repo, PROOF_STATE: stateFile,
    } });
    const endpoint = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let attempt = 0; attempt < 100 && !healthy && child.exitCode === null; attempt += 1) {
      try { healthy = (await fetch(`${endpoint}/healthz`)).ok; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    if (!healthy) throw new Error('The server did not start');
    client = new Client({ name: 'disposable-github-proof', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${clientToken}` } },
    }));
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const repoPath = `${PREFIX}disposable-proof-${runId}.md`;
    const content = `---\nmutability: review-first\n---\nDisposable proposal/review proof ${runId}. Safe to close without merging.\n`;
    const result = await client.callTool({ name: 'vault_create_file', arguments: { path: repoPath, content } });
    if (result.isError) throw new Error('vault_create_file was refused');
    const created = result.structuredContent ?? {};
    const evidence = {
      mode: options.dryRun ? 'dry run (local substitute)' : 'live',
      repository: `${owner}/${repo}`,
      branch: BRANCH,
      path: repoPath,
      contentSha256: createHash('sha256').update(content).digest('hex'),
      commit: created.commitSha ?? null,
      commitUrl: created.commitUrl ?? null,
      reviewRequired: created.review_required ?? null,
      githubRequests: options.dryRun ? JSON.parse(await readFile(stateFile, 'utf8')).requests.length : null,
      next: options.dryRun
        ? 'none: dry run, no human review'
        : `open a pull request from ${BRANCH}, have a human review it, then run verify`,
    };
    await appendEvidence(options.log, 'propose', evidence);
    return evidence;
  } finally {
    await client?.close().catch(() => {});
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await rm(work, { recursive: true, force: true, maxRetries: 3 });
  }
}

export async function verify(options) {
  const token = process.env.GITHUB_TOKEN;
  const pulls = await github(`/repos/${options.owner}/${options.repo}/pulls?state=all&head=${encodeURIComponent(`${options.owner}:${BRANCH}`)}&per_page=5`, token);
  const pull = pulls[0];
  if (!pull) throw new Error(`No pull request from ${BRANCH} yet`);
  const reviews = await github(`/repos/${options.owner}/${options.repo}/pulls/${pull.number}/reviews?per_page=100`, token);
  const human = reviews.filter((review) => review.user?.type === 'User' && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review.state));
  const evidence = {
    mode: 'live',
    repository: `${options.owner}/${options.repo}`,
    pullRequest: pull.html_url,
    pullState: pull.merged_at ? 'merged' : pull.state,
    reviews: human.map((review) => ({ reviewer: review.user.login, state: review.state, submittedAt: review.submitted_at })),
    humanReviewed: human.length > 0,
  };
  await appendEvidence(options.log, 'verify', evidence);
  return evidence;
}

async function appendEvidence(log, step, evidence) {
  await mkdir(path.dirname(log), { recursive: true });
  const header = await readFile(log, 'utf8').then(() => '', () => '# Proof log\n\nAppend-only evidence from scripts/disposable-github-proof.mjs. No tokens or note bodies.\n');
  await appendFile(log, `${header}\n## ${new Date().toISOString()} ${step}\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const evidence = options.command === 'propose' ? await propose(options) : await verify(options);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\nEvidence appended to ${options.log}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Proof failed'}\n`);
    process.exitCode = 1;
  }
}
