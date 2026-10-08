// Starts the real Streamable HTTP server (dist/src/index.js) for the mcp-eval contract suite.
//
//   node eval/contract.mjs [mcp-eval args]   start the server, run eval/mcp.suite.yaml, stop it,
//                                            exit with the mcp-eval exit code (0, 1 or 2)
//   node eval/contract.mjs --serve           start the server and keep it running (CI starts it
//                                            in the background, then runs the composite action)
//
// Offline and secret-free: synthetic policy and token files from eval/fixtures/config, a fake
// GITHUB_TOKEN, a throwaway audit log in the OS temp directory, and eval/github-stub.mjs
// preloaded so no request can reach the real GitHub API.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const evalDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(evalDir);
// Must match target.url in eval/mcp.suite.yaml.
const PORT = 3297;
const HEALTH_URL = `http://127.0.0.1:${PORT}/healthz`;

const args = process.argv.slice(2);
const serveOnly = args[0] === "--serve";
const auditDir = mkdtempSync(path.join(os.tmpdir(), "obsidian-github-mcp-eval-"));

const server = spawn(
  process.execPath,
  [
    "--import",
    pathToFileURL(path.join(evalDir, "github-stub.mjs")).href,
    path.join(root, "dist/src/index.js"),
  ],
  {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      PATH: process.env.PATH ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      VAULT_MCP_HOST: "127.0.0.1",
      VAULT_MCP_PORT: String(PORT),
      VAULT_MCP_POLICY_FILE: path.join(evalDir, "fixtures/config/policy.yaml"),
      VAULT_MCP_TOKEN_FILE: path.join(evalDir, "fixtures/config/tokens.yaml"),
      VAULT_MCP_AUDIT_LOG: path.join(auditDir, "audit.jsonl"),
      VAULT_MCP_GITHUB_OWNER: "example",
      VAULT_MCP_GITHUB_REPO: "vault",
      VAULT_MCP_RATE_LIMIT: "1000",
      GITHUB_TOKEN: "eval-synthetic-upstream-token",
    },
  },
);

let stopping = false;
function stop() {
  stopping = true;
  if (server.exitCode === null && server.signalCode === null) server.kill();
  rmSync(auditDir, { recursive: true, force: true });
}

server.on("exit", (code, signal) => {
  if (stopping) return;
  process.stderr.write(`obsidian-github-mcp exited early (code ${code}, signal ${signal}).\n`);
  rmSync(auditDir, { recursive: true, force: true });
  process.exit(2);
});
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(143);
});

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become healthy at ${HEALTH_URL} within ${timeoutMs} ms.`);
}

try {
  await waitForHealth(30_000);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  stop();
  process.exit(2);
}

if (serveOnly) {
  process.stdout.write(`mcp-eval target ready at http://127.0.0.1:${PORT}/mcp\n`);
} else {
  // The package exports only its library entry (dist/src/index.js); the mcp-eval bin sits beside it.
  const harnessEntry = fileURLToPath(import.meta.resolve("@sarutobi-sasuke/mcp-eval-harness"));
  const cli = path.join(path.dirname(harnessEntry), "cli.js");
  const run = spawn(process.execPath, [cli, path.join("eval", "mcp.suite.yaml"), ...args], {
    cwd: root,
    stdio: "inherit",
  });
  run.on("exit", (code) => {
    stop();
    process.exit(code ?? 2);
  });
}
