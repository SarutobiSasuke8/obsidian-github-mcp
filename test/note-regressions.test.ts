import assert from "node:assert/strict";
import test from "node:test";

import { appendContent, validateContent, validateReplacement } from "../src/content-policy.js";
import { GitHubRepositoryClient, StaticTokenProvider } from "../src/github.js";
import { normalizeRepoPath } from "../src/path-policy.js";

const options = { allowedExtensions: new Set([".md"]), maxFileBytes: 1_024 };
const rules = [{ path: "Workspace/Shared/**", requiredFrontmatter: { disclosure: "public-safe" } }];

test("CRLF frontmatter and quoted metadata retain review-first status", () => {
  const note = '---\r\ndisclosure: "public-safe"\r\nmutability: review-first\r\n---\r\n# Draft';
  assert.deepEqual(validateContent("Workspace/Shared/Draft.md", note, options, rules), {
    mutability: "review-first", reviewRequired: true,
  });
});

test("a YAML document in the body cannot satisfy required frontmatter", () => {
  assert.throws(() => validateContent("Workspace/Shared/Draft.md", "# Draft\n---\ndisclosure: public-safe\n---", options, rules), /must declare/u);
});

test("list frontmatter cannot satisfy required metadata", () => {
  assert.throws(() => validateContent("Workspace/Shared/Draft.md", "---\n- disclosure: public-safe\n---\nDraft", options, rules), /must declare/u);
});

test("invalid and duplicate YAML fields fail instead of silently approving a note", () => {
  for (const yaml of ["disclosure: [", "disclosure: public-safe\ndisclosure: internal"]) {
    assert.throws(() => validateContent("Workspace/Shared/Draft.md", `---\n${yaml}\n---\nDraft`, options, rules));
  }
});

test("size limit counts UTF-8 bytes rather than JavaScript character count", () => {
  assert.doesNotThrow(() => validateContent("Notes/Unicode.md", "é".repeat(512), options));
  assert.throws(() => validateContent("Notes/Unicode.md", "é".repeat(513), options), /byte limit/u);
});

test("appending preserves the original CRLF bytes and handles a missing terminal newline", () => {
  const original = "---\r\nmutability: append-only\r\n---\r\nOriginal";
  const result = appendContent(original, "Next entry");
  assert.equal(result, `${original}\nNext entry`);
  assert.doesNotThrow(() => validateReplacement(original, result));
  assert.throws(() => validateReplacement(original, result.replaceAll("\r\n", "\n")), /byte-for-byte/u);
  assert.throws(() => appendContent(original, " \n\t"), /empty/u);
});

test("paths normalise Unicode before use and reject hidden traversal/control segments", () => {
  assert.equal(normalizeRepoPath("  Notes/Cafe\u0301 plan #1.md  "), "Notes/Café plan #1.md");
  for (const value of ["Notes/./Draft.md", "Notes/../Draft.md", "Notes/Draft.md/", "Notes/\u0000Draft.md", "Notes/\nDraft.md", "Notes//Draft.md"]) {
    assert.throws(() => normalizeRepoPath(value));
  }
});

test("GitHub reads encode each path segment and branch, preserving note bytes", async () => {
  const note = "---\r\nmutability: living\r\n---\r\n# Café\r\n[[Other note]]\r\n";
  const encoded = Buffer.from(note).toString("base64");
  let url = "";
  const fetchFn: typeof fetch = async input => {
    url = String(input);
    return Response.json({ type: "file", sha: "note-sha", content: `${encoded.slice(0, 20)}\n${encoded.slice(20)}` });
  };
  const client = new GitHubRepositoryClient("example-owner", "example-vault", new StaticTokenProvider("test-only"), fetchFn);
  const repoPath = normalizeRepoPath("Notes/Cafe\u0301 plan #1.md");
  const file = await client.getFile(repoPath, "agent/review notes");
  assert.equal(url, "https://api.github.com/repos/example-owner/example-vault/contents/Notes/Caf%C3%A9%20plan%20%231.md?ref=agent%2Freview%20notes");
  assert.equal(file.content, note);
  assert.equal(file.path, "Notes/Café plan #1.md");
  assert.equal(file.sha, "note-sha");
});

test("a directory response is refused as a note", async () => {
  const client = new GitHubRepositoryClient("example-owner", "example-vault", new StaticTokenProvider("test-only"), async () => Response.json([{ type: "dir" }]));
  await assert.rejects(client.getFile("Notes", "agent/review"), /not a regular file/u);
});

test("GitHub errors preserve status and request id without making a retry", async () => {
  let calls = 0;
  const client = new GitHubRepositoryClient("example-owner", "example-vault", new StaticTokenProvider("test-only"), async () => {
    calls += 1;
    return Response.json({ message: "Not Found" }, { status: 404, headers: { "x-github-request-id": "fixture-request" } });
  });
  await assert.rejects(client.getFile("Notes/Missing.md", "agent/review"), /404 Not Found.*fixture-request/u);
  assert.equal(calls, 1);
});

test("directory entries must retain their typed path and size fields", async () => {
  const valid = { path: "Notes/Café.md", name: "Café.md", sha: "note-sha", size: 17, type: "file" };
  const client = new GitHubRepositoryClient("example-owner", "example-vault", new StaticTokenProvider("test-only"), async () => Response.json([valid]));
  assert.deepEqual(await client.listDirectory("Notes", "agent/review"), [valid]);
  const malformed = new GitHubRepositoryClient("example-owner", "example-vault", new StaticTokenProvider("test-only"), async () => Response.json([{ ...valid, size: "17" }]));
  await assert.rejects(malformed.listDirectory("Notes", "agent/review"), /invalid directory entry/u);
});
