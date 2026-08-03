# Repository agent contract

This service is a security boundary for Git-backed knowledge vaults.

- `config/policy.yaml` is the runtime permission source of truth. Do not duplicate grants in code.
- Effective writes must pass identity write, broker allow, global deny, mutability, frontmatter, extension, size, and secret checks.
- Never add tools that write default branches, merge, delete, alter history, change repository settings, or expose credentials.
- Never log raw bearer tokens, GitHub credentials, or full file contents. Audit content only by size and SHA-256.
- Every authorization change needs tests for the intended grant and a nearby denial.
- Preserve neutral examples. Never commit a user's vault content, identities, repository names, filesystem paths, or secrets to this public project.
