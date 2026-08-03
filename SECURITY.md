# Security policy

## Supported versions

Security fixes are applied to the current release line. Keep dependencies pinned through the lockfile and run the included audit workflow.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature when available. Do not open a public issue containing tokens, private repository information, exploit payloads, or detailed reproduction steps for an unpatched vulnerability.

Revoke exposed credentials before investigating. Preserve audit logs and review all affected proposal-branch commits.

## Security boundary

This service is a narrow proposal gateway, not a general GitHub proxy:

- GitHub credentials remain server-side.
- One MCP token maps to one identity and one broker.
- Effective writes require both identity and broker permission.
- Denials override grants.
- Brokers cannot target `main` or `master`.
- No delete, merge, force-push, branch, workflow, admin, or arbitrary HTTP tools exist.
- Content is size- and extension-bounded, scanned for credential shapes, and checked for frontmatter and mutability rules.
- Audit logs do not contain raw bearer tokens, GitHub credentials, or file bodies.

## Deployment requirements

- Use TLS or a private network for remote clients.
- Install the GitHub App only on the target vault repository.
- Keep `.env`, token bindings, the App private key, and audit logs outside agent-visible mounts.
- Give each identity a unique expiring token.
- Set allowed hosts and proxy trust explicitly.
- Review proposal branches before merging.
- Run `npm run check` and `npm audit --audit-level=high` before deployment.

The GitHub credential can write repository contents. The application constrains it to proposal branches, but a compromised server host could bypass application logic. Host isolation, least-privilege App installation, key protection, and repository-side rules where available are important defense in depth.
