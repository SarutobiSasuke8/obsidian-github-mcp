# Per-agent permissions

## Two independent controls

`config/policy.yaml` is the authority for paths and branches. `config/tokens.yaml` only binds an MCP credential to an existing identity and broker; it cannot grant access by itself.

A write succeeds only when:

```text
token is known, enabled, and unexpired
  AND identity exists in policy.yaml
  AND broker exists in policy.yaml
  AND path matches agent.write
  AND path matches git_broker.allow
  AND path matches no agent or global deny
  AND broker targets neither main nor master
  AND content policy passes
```

Policies and token bindings are re-read for every request. Invalid configuration fails closed.

## Provision an identity

1. Add an identity with explicit read, write, and deny patterns.
2. Add a broker with a dedicated proposal branch and narrow publication allowlist.
3. Create that branch from reviewed default-branch content.
4. Run `npm run token:new`.
5. Store only the printed hash:

```yaml
version: 1
agents:
  - agent_id: example-writer
    broker: example-writer
    enabled: true
    token_sha256: <64 lowercase hexadecimal characters>
    expires_at: 2027-01-01T00:00:00Z
```

6. Deliver the raw token through a secret channel to one MCP client.
7. Test identity, allowed read/write, nearby sibling denials, and a forbidden root path.

An identity without a broker may still be represented in the vault policy, but it cannot write through this server.

## Pattern rules

- Paths are repository-relative and case-sensitive.
- `/`, drive prefixes, backslashes, empty segments, `.` and `..` are rejected.
- `deny` wins over every grant.
- The server always denies `.git/**`, `.github/**`, `.obsidian/**`, environment files, private-key extensions, and credential-named files.
- Add vault-specific sensitive paths to `never_versioned`.
- Directory listings omit children the identity cannot read.

## Protected surfaces

Use `surface_rules` when a path requires frontmatter metadata:

```yaml
surface_rules:
  - path: Workspace/Shared/**
    required_frontmatter:
      disclosure: public-safe
      mutability: living
```

All required values must match exactly before a write is sent to GitHub.

## Mutability

- `living`: create and update normally.
- `review-first`: writes are allowed to the proposal branch and the tool result flags operator review.
- `append-only`: replacements must preserve the entire existing byte sequence as a prefix.
- `immutable`: updates are rejected; create a linked successor instead.

## Revoke or rotate

- Set `enabled: false` for immediate revocation.
- Remove a binding when it is no longer needed.
- Generate a new token, replace the stored hash, and update the client to rotate.
- Set short expirations appropriate to the deployment.
- Never reuse a raw token between identities.
