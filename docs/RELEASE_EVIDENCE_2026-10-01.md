# First-release evidence, 2026-10-01

Baseline: `b8336f8`; candidate includes the packaged-boundary-proof changes. Maintainer validation on Windows, Node 22.22.1, npm 11.19.0. This is not an independent audit.

## Changes and checks

Unknown policy/token fields previously disappeared during parsing. A misspelt `enabled` could leave the default true, while a misspelt deny field could remove its restrictions. Two new regression tests failed on the previous implementation and passed after strict parsing. All policy levels and token records now reject unknown keys; the supported policy version and authority are explicit. Existing valid examples continue to work.

`npm run check` passed with 26 unit tests. `npm run test:e2e` packed the candidate, installed it into an empty operator directory, launched the installed entry point and connected a real MCP SDK HTTP client. The proof covers:

- Unauthenticated rejection and tool discovery without merge/delete/execute authority.
- Create/read on the fixed proposal branch even when a caller supplies another branch.
- Traversal, denied paths, executable extensions, missing required frontmatter and secret-shaped content rejected before any GitHub request.
- Immutable replacement denied; append-only replacement denied and genuine append allowed.
- A simulated stale SHA conflict returns failure without overwriting content.
- Invalid policy reload and live token disabling fail closed.
- Audit records contain content hashes, not submitted bodies or client/upstream tokens.
- Private configuration and test hooks are absent from the published tarball.

The GitHub transport is replaced only inside the test process. It uses temporary example data and sends nothing to GitHub. This does not prove real repository permissions, branch provisioning, human merge review or actual Claude/Codex sessions. The test fixture is excluded from the package. No new production endpoint override or bypass was introduced for testing.

The lockfile refresh clears the dependency advisories found during the sweep; npm audit reports 0 vulnerabilities. CI now covers Windows/Linux with Node 22/24, including the packaged proof. The release workflow also runs it before publishing.

## Remaining gates

Review the candidate; correct any unsupported configuration keys in existing deployments. Complete a disposable real GitHub and actual-client workflow, verify npm trusted publishing, publish the matching release tag and cold-install that public artifact. Capture hosted run links and the artifact checksum. A successful local proof does not promote the server or close every possible security concern.
