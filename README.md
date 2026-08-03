# Obsidian GitHub MCP

A white-label Model Context Protocol server that gives selected AI agents bounded, auditable access to propose changes to an Obsidian vault stored in GitHub.

Each agent receives its own expiring MCP bearer token. The GitHub credential remains server-side. Read and write paths, denials, protected surfaces, proposal branches, and token revocation are controlled by operator-owned YAML files.

> This is an independent open-source project. It is not affiliated with or endorsed by Obsidian or GitHub.

## Why use it?

Giving an agent a general GitHub token is difficult to constrain and easy to misuse. This server creates a narrower boundary:

```text
AI agent + individual MCP token
        |
        v
identity + fixed broker
        |
        v
agent write scope AND broker publication scope
        |
        v
deny, path, frontmatter, mutability, size, and secret checks
        |
        v
server-side GitHub App token
        |
        v
proposal branch for human review
```

The service has no tools for deleting files, merging branches, pushing to `main` or `master`, changing repository settings, editing workflows, or exposing credentials.

## Features

- Stateless MCP Streamable HTTP transport
- Unique, expiring bearer tokens stored as SHA-256 bindings
- Per-agent read, write, and deny path globs
- Separate Git broker allowlists and fixed proposal branches
- Configurable frontmatter requirements for shared or sensitive surfaces
- `living`, `review-first`, `append-only`, and `immutable` note handling
- Path-traversal prevention and file-extension/size allowlists
- Credential-shaped-content detection
- Repository-restricted GitHub App tokens with PAT fallback for local testing
- Content-free JSONL audit records
- Host/origin validation, security headers, rate limiting, and HTTP timeouts
- Docker, CI, tests, and deployment documentation

## MCP tools

| Tool | Purpose |
|---|---|
| `vault_whoami` | Show the authenticated identity, broker, branch, and policy scopes. |
| `vault_list_allowed_paths` | Explain effective read/write/deny boundaries. |
| `vault_list_files` | List an authorized directory while filtering denied children. |
| `vault_read_file` | Read an authorized UTF-8 vault file. |
| `vault_create_file` | Create a file on the identity's fixed proposal branch. |
| `vault_update_file` | Update a permitted file while respecting mutability. |
| `vault_append_file` | Append while preserving all existing bytes. |

## Requirements

- Node.js 22+
- An Obsidian vault in a GitHub repository
- A dedicated non-default proposal branch for each broker
- A GitHub App installed only on the vault repository with `Contents: read and write`, or a fine-grained PAT for local testing

## Quick start

```bash
git clone https://github.com/YOUR_ACCOUNT/obsidian-github-mcp.git
cd obsidian-github-mcp
npm ci
cp .env.example .env
cp config/policy.example.yaml config/policy.yaml
cp config/tokens.example.yaml config/tokens.yaml
npm run token:new
npm run check
npm start
```

Configure `.env`, replace the sample policy, and put only the generated token's SHA-256 in `config/tokens.yaml`. Give the raw bearer token to exactly one MCP client.

The default endpoints are:

```text
GET  http://127.0.0.1:3210/healthz
POST http://127.0.0.1:3210/mcp
```

MCP clients must send:

```text
Authorization: Bearer vault_<generated-token>
```

## Permission model

The effective write scope is the intersection of the agent grant and its broker:

```yaml
policy_version: 1
authority: operator-only

agents:
  - id: example-writer
    name: Example Writer
    role: bounded knowledge worker
    disclosure_ceiling: internal
    entry_reads: [README.md]
    read: [Knowledge/**, Workspace/**]
    write: [Workspace/Shared/**, Workspace/Example Writer/**]
    deny: [Private/**, People/**, .obsidian/**]

git_brokers:
  - broker: example-writer
    branch: agent/example-writer
    allow: [Workspace/Shared/**, Workspace/Example Writer/**]

never_versioned: [Private/**, People/**, .obsidian/**, secrets/**]

surface_rules:
  - path: Workspace/Shared/**
    required_frontmatter:
      disclosure: public-safe
```

An auth binding then maps one token hash to that identity and broker. The binding cannot grant paths that the policy does not grant.

See [docs/PERMISSIONS.md](docs/PERMISSIONS.md) for provisioning and revocation.

## GitHub authentication

Production deployments should use a GitHub App installed only on the vault repository. Configure:

```dotenv
GITHUB_APP_ID=123456
GITHUB_APP_INSTALLATION_ID=12345678
GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/vault-mcp.pem
```

The server creates short-lived installation tokens restricted again to the configured repository and `contents: write`. A repository-scoped `GITHUB_TOKEN` is supported as a local-development fallback.

## Deployment

The included container runs as a non-root user with a read-only root filesystem. Put TLS, a private overlay network, or an authenticated gateway in front of the service before making it remotely reachable.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Verification

```bash
npm run check
npm audit --audit-level=high
```

Tests cover policy parsing, write-scope intersection, deny precedence, traversal attempts, frontmatter rules, mutability, secret detection, token bindings, and fixed-branch GitHub writes.

## Security

Read [SECURITY.md](SECURITY.md) before deployment. Report suspected vulnerabilities privately rather than opening a public issue with exploit details.

## License

Apache-2.0. See [LICENSE](LICENSE).
