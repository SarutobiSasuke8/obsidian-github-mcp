# Deployment

## Recommended topology

Run the service on an operator-controlled host behind TLS or a private overlay network. Agents connect over Streamable HTTP with individual bearer tokens. Keep GitHub credentials and token bindings outside every agent-visible mount.

```text
agent -> TLS/private network -> MCP server -> GitHub API -> proposal branch
                              |          |
                              |          + short-lived installation token
                              + read-only policy and token hashes
```

## GitHub App

Create a GitHub App with:

- Repository access: only the target vault repository
- Repository permission: `Contents: Read and write`
- No organization permissions
- No webhook requirement

Store the private key outside the repository. The service signs a short-lived App JWT, requests an installation token limited to the configured repository and `contents: write`, and caches it until shortly before expiry.

## Native Node

```bash
npm ci
npm run check
cp .env.example .env
cp config/policy.example.yaml config/policy.yaml
cp config/tokens.example.yaml config/tokens.yaml
npm start
```

Run under a dedicated OS account. Restrict `.env`, `config/tokens.yaml`, the GitHub App key, and `var/audit.jsonl` to the service account and operator.

## Container

Review `.env`, create the two runtime YAML files, then run:

```bash
docker compose up --build -d
```

The compose definition runs non-root, mounts policy/token files read-only, uses a read-only root filesystem, writes only the audit volume and temporary memory filesystem, and disables privilege escalation.

## Reverse proxies

- Bind to loopback when a same-host proxy terminates TLS.
- Set `VAULT_MCP_ALLOWED_HOSTS` to exact externally accepted hostnames.
- Set `VAULT_MCP_ALLOWED_ORIGINS` only for browser-based clients that require CORS.
- Set `VAULT_MCP_TRUST_PROXY_HOPS` to the exact number of trusted proxy hops; keep `0` otherwise.
- Never use wildcard host or origin settings.
- Ensure the edge request-size limit is no greater than the application limit.

The built-in limiter is process-local. Multi-instance deployments should enforce distributed rate limits at the gateway or replace it with a shared store.

## MCP client

Client syntax differs, but the essential values are:

```json
{
  "url": "https://vault-mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer vault_REDACTED"
  }
}
```

Store the token in the client's secret manager, never in prompts, vault notes, or repositories.

## Operations

- Health: `GET /healthz`
- Audit: JSON Lines at `VAULT_MCP_AUDIT_LOG`; content is represented only by size and SHA-256.
- Policy reload: policy and token bindings are read for every request.
- Rotation: replace a token hash, update the client secret, then revoke the old token.
- Review: every agent branch remains a proposal until a human reviews and merges it.

Audit logs reveal filenames and agent activity even though they contain no file bodies or raw credentials. Rotate, protect, and back them up appropriately.
