// Test-only transport substitute loaded into the installed server process.
// No real GitHub calls, credentials or repository mutations are permitted.
import { readFile, writeFile } from 'node:fs/promises';

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://api.github.com' || !url.pathname.startsWith('/repos/example/vault/contents/')) {
    throw new Error('Unexpected outbound request in packaged proof');
  }
  const state = JSON.parse(await readFile(process.env.PROOF_STATE, 'utf8'));
  const filePath = decodeURIComponent(url.pathname.split('/contents/')[1]);
  const body = init.body ? JSON.parse(init.body) : undefined;
  const branch = body?.branch ?? url.searchParams.get('ref');
  if (branch !== 'agent/example-writer') throw new Error('Proposal escaped its fixed branch');
  state.requests.push({ method: init.method ?? 'GET', path: filePath, branch });
  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json' },
  });
  let response;
  if (init.method === 'PUT') {
    const existing = state.files[filePath];
    if ((existing && body.sha !== existing.sha) || filePath.endsWith('/Conflict.md')) {
      response = json({ message: 'sha does not match' }, 409);
    } else {
      const sha = `sha-${state.requests.length}`;
      state.files[filePath] = { sha, content: Buffer.from(body.content, 'base64').toString('utf8') };
      response = json({ content: { sha }, commit: { sha: `commit-${sha}` } }, 201);
    }
  } else {
    const file = state.files[filePath];
    response = file ? json({ type: 'file', sha: file.sha, content: Buffer.from(file.content).toString('base64') })
      : json({ message: 'Not Found' }, 404);
  }
  await writeFile(process.env.PROOF_STATE, JSON.stringify(state));
  return response;
};
