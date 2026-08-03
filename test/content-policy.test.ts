import assert from "node:assert/strict";
import test from "node:test";

import {
  appendContent,
  validateContent,
  validateReplacement,
} from "../src/content-policy.js";

const options = {
  allowedExtensions: new Set([".md", ".json", ".base"]),
  maxFileBytes: 10_000,
};

test("requires public-safe disclosure in Shared", () => {
  const rules = [{ path: "Workspace/Shared/**", requiredFrontmatter: { disclosure: "public-safe" } }];
  assert.throws(() => validateContent("Workspace/Shared/Handoff.md", "# Missing", options, rules));
  const valid = `---\ndisclosure: public-safe\nmutability: living\n---\n# Handoff`;
  assert.equal(validateContent("Workspace/Shared/Handoff.md", valid, options, rules).mutability, "living");
});

test("rejects secret-shaped content and executable extensions", () => {
  assert.throws(() =>
    validateContent("Workspace/Alpha/Secrets.md", "api_key = abcdefghijklmnopqrstuvwxyz", options),
  );
  assert.throws(() => validateContent("Workspace/Alpha/run.ps1", "Write-Host hello", options));
});

test("enforces immutable and append-only replacement rules", () => {
  const immutable = `---\nmutability: immutable\n---\nOriginal`;
  assert.throws(() => validateReplacement(immutable, `${immutable}\nChange`));

  const appendOnly = `---\nmutability: append-only\n---\nOriginal`;
  assert.throws(() => validateReplacement(appendOnly, `${appendOnly.replace("Original", "Changed")}`));
  const appended = appendContent(appendOnly, "## 2026-08-03\nNew entry");
  assert.doesNotThrow(() => validateReplacement(appendOnly, appended));
});

test("marks review-first content for operator review", () => {
  const content = `---\nmutability: review-first\n---\nDraft`;
  assert.equal(validateContent("Workspace/Alpha/Draft.md", content, options).reviewRequired, true);
});
