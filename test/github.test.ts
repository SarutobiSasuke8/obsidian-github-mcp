import assert from "node:assert/strict";
import test from "node:test";

import { GitHubRepositoryClient, StaticTokenProvider } from "../src/github.js";

test("writes only to the caller-supplied fixed proposal branch", async () => {
  let capturedBody = "";
  let capturedAuth = "";
  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    capturedAuth = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(
      JSON.stringify({ content: { sha: "content-sha" }, commit: { sha: "commit-sha" } }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const client = new GitHubRepositoryClient(
    "owner",
    "repo",
    new StaticTokenProvider("server-secret"),
    mockFetch,
  );
  const result = await client.putFile(
    "Workspace/Alpha/Test.md",
    "agent/alpha",
    "hello",
    "[alpha-writer] create Test.md",
  );
  assert.equal(JSON.parse(capturedBody).branch, "agent/alpha");
  assert.equal(capturedAuth, "Bearer server-secret");
  assert.equal(result.commitSha, "commit-sha");
});
