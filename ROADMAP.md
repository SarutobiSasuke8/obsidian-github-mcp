# Roadmap

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
- [ ] Dry-run policy explanation tool for operators
- [ ] Atomic multi-file proposal commits
- [ ] Optional pull-request creation without merge authority
- [ ] Signed release artifacts and container provenance
