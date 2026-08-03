# Security best-practices review

## Executive summary

The initial public release was reviewed as a Node.js 22, TypeScript, Express 5, MCP Streamable HTTP service that writes through the GitHub Contents API. No critical, high, or medium-severity vulnerabilities were identified in the reviewed source. Typecheck, lint, 15 automated tests, the dependency audit, and the private-data/credential leakage scan all passed.

The service validates MCP inputs with Zod, uses header-based bearer authentication, restricts paths and proposal branches, limits request bodies, sets security headers, applies per-process rate limiting, bounds outbound GitHub requests, and returns generic HTTP errors. The remaining items below are documented defense-in-depth limitations rather than release blockers.

## Scope and evidence

- Runtime entrypoint and middleware: `src/index.ts`
- Authentication and token handling: `src/auth.ts`
- Policy, path, mutability, and content controls: `src/policy.ts`, `src/path-policy.ts`, `src/content-policy.ts`
- GitHub authentication and outbound requests: `src/github.ts`
- Audit behavior: `src/audit.ts`
- Container, CI, and operator documentation

## Critical findings

None.

## High findings

None.

## Medium findings

None.

## Low and residual findings

### SEC-001 — GitHub installation permission is repository-wide

- **Severity:** Low / architectural residual risk
- **Location:** `src/github.ts:47`, `src/policy.ts:63`, `SECURITY.md:36`
- **Evidence:** The installation token requests `contents: write` for one repository. Application policy rejects brokers targeting `main` or `master`, but GitHub App contents permission is not itself branch-scoped.
- **Impact:** A complete compromise of the MCP server host or private key could bypass application-level proposal-branch enforcement.
- **Fix:** Install the App only on the target vault repository, protect the private key, isolate the service account, and enable repository rulesets or branch protection where available.
- **Mitigation:** Short-lived installation tokens, fixed broker branches, no general Git tool, and mandatory human review reduce normal-operation exposure.
- **False-positive notes:** Repository-side controls are deployment-specific and cannot be verified from this source tree.

### SEC-002 — Built-in rate limiting is process-local

- **Severity:** Low
- **Location:** `src/index.ts:62`, `docs/DEPLOYMENT.md`
- **Evidence:** `express-rate-limit` uses its default in-memory store.
- **Impact:** Limits are not shared across replicas and reset when a process restarts.
- **Fix:** Enforce a distributed limit at the deployment gateway or configure a shared store before horizontal scaling.
- **Mitigation:** Single-instance deployments still receive bounded per-IP request rates, explicit body limits, and HTTP timeouts.
- **False-positive notes:** A reverse proxy or private-network gateway may already provide the distributed control.

### SEC-003 — Secret-pattern detection is defense in depth, not complete DLP

- **Severity:** Low
- **Location:** `src/content-policy.ts:8-49`
- **Evidence:** The server rejects several high-signal credential formats and credential assignments using regular expressions.
- **Impact:** A novel, encoded, or provider-specific secret format could pass the application scan if it is placed in an otherwise authorized file.
- **Fix:** Extend patterns as new providers are used and enable GitHub secret scanning or another repository-side scanner.
- **Mitigation:** Extension/path controls, dedicated proposal branches, content-free audits, and human review limit exposure before default-branch promotion.
- **False-positive notes:** No application-only pattern set can prove arbitrary content contains no secret.

## Positive controls verified

- Default-branch brokers are rejected in `src/policy.ts:63`.
- Hard-denied repository and credential paths are applied in `src/path-policy.ts:7-51`.
- Token files store hashes and comparisons use constant-time equality in `src/auth.ts:37-55`.
- Audit records store content length and SHA-256 rather than file bodies in `src/audit.ts:32`.
- Helmet, generic errors, authentication, rate limiting, and explicit timeouts are configured in `src/index.ts:53-100`.
- GitHub requests use a 15-second abort timeout in `src/github.ts:45` and `src/github.ts:119`.
- Dependency audit: zero known vulnerabilities at review time.
- Public leakage scan: no private names, paths, repository identifiers, or credential-shaped values detected.
