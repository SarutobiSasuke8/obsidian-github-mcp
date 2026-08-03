# Contributing

Contributions are welcome, especially tests for permission edge cases, documentation improvements, and narrowly scoped security hardening.

## Development

```bash
npm ci
npm run check
```

Keep pull requests focused. Authorization changes must include tests for both the intended grant and an adjacent denial. Do not use real vault names, identities, repository URLs, credentials, tokens, or private filesystem paths in fixtures.

Security vulnerabilities should follow [SECURITY.md](SECURITY.md), not the public issue tracker.
