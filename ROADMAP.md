# Roadmap

## First-release proof, 2026-10-01

- [x] Reject unknown policy/token keys, unsupported policy versions and authority modes. Regression tests reproduced the previous fail-open typos before the fix.
- [x] Prove a clean tarball over real MCP HTTP with a test-only GitHub backend: proposal branch, denied writes, mutability, stale SHA conflict, invalid policy reload, revocation and audit privacy.
- [x] Require the packaged proof in Windows/Linux Node 22/24 CI and the release workflow.
- [x] Refresh locked dependencies within existing constraints; npm audit reports 0 vulnerabilities.
- [ ] Complete a disposable real GitHub proposal/review workflow with actual client applications. The local substitute proves request behaviour, not live GitHub permissions or human review.
- [ ] Configure/verify npm trusted publishing, publish the reviewed version and cold-install the public artifact. Record checksum and hosted release evidence before promoting the listing.

See [dated evidence](docs/RELEASE_EVIDENCE_2026-10-01.md). No package publication or maturity promotion is included in this sweep.

## Shipped in the initial release

- [x] Stateless MCP Streamable HTTP transport
- [x] Per-identity expiring bearer tokens
- [x] Generic YAML permission and broker policy
- [x] Scoped list/read/create/update/append tools
- [x] Deny precedence and proposal-branch isolation
- [x] Frontmatter surface rules and note mutability
- [x] Secret, traversal, extension, and size checks
- [x] GitHub App and fine-grained PAT support
- [x] Content-free audit records
- [x] Rate limiting, security headers, generic errors, and HTTP timeouts
- [x] Docker, CI, tests, and deployment documentation

## Candidate improvements

- [ ] OAuth authorization-server integration for clients that cannot set static headers
- [ ] Optional Redis-backed distributed rate limiting
- [x] Dry-run policy explanation tool for operators (`vault_explain_access`)
- [ ] Atomic multi-file proposal commits
- [ ] Optional pull-request creation without merge authority
- [ ] Signed release artifacts and container provenance
