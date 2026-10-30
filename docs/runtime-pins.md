# Runtime pins

This file lists every floating runtime or supply-chain reference in this repository and the exact value each one would be pinned to. It is produced by `scripts/pin-check.mjs`, which runs as the `pin-check` job in CI.

Resolved on 2026-10-16. Nothing in this file has been applied yet: the Dockerfile, `engines.node` and the existing `uses:` lines are unchanged.

## Status

- **Node version and Docker base image:** pending gate d48fb4c7. Do not change them until that gate is approved.
- **Action tags:** proposed. The SHAs below are what the tags point to today.
- **Git dependencies:** none floating. `@sarutobi-sasuke/mcp-eval-harness` is already pinned to commit `c33df1c081ec871a7fbc294af87052bfeabb6b24`.

## Floating references and proposed pins

| Kind | Location | Current | Proposed pin | Status |
| --- | --- | --- | --- | --- |
| Dockerfile FROM | `Dockerfile:1` (build stage) | `node:22-alpine` | `node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402` | pending gate d48fb4c7 |
| Dockerfile FROM | `Dockerfile:10` (runtime stage) | `node:22-alpine` | `node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402` | pending gate d48fb4c7 |
| engines.node | `package.json` | `>=22` | `22.23.3` (current Node 22 LTS, "Jod", released 2026-09-23) | pending gate d48fb4c7 |
| Action uses | `.github/workflows/ci.yml:19` | `actions/checkout@v7` | `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` | proposed |
| Action uses | `.github/workflows/ci.yml:20` | `actions/setup-node@v7` | `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0` | proposed |
| Action uses | `.github/workflows/mcp-eval.yml:15` | `actions/checkout@v7` | `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` | proposed |
| Action uses | `.github/workflows/mcp-eval.yml:16` | `actions/setup-node@v7` | `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0` | proposed |
| Action uses | `.github/workflows/release.yml:16` | `actions/checkout@v7` | `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` | proposed |
| Action uses | `.github/workflows/release.yml:17` | `actions/setup-node@v7` | `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0` | proposed |

## How the values were resolved

- **Action SHAs:** `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, dereferencing annotated tags through `git/tags/<sha>`. `actions/checkout` `v7` and `v7.0.1` both resolve to commit `3d3c42e5aac5ba805825da76410c181273ba90b1`. `actions/setup-node` `v7` and `v7.1.0` both resolve to commit `949feb2413d6458794dcd2491c4babbbce0c15c1`. Both tags are lightweight tags that point straight at the commit.
- **Docker digest:** `docker buildx imagetools inspect node:22-alpine`, cross-checked with the Docker Hub registry API (`HEAD /v2/library/node/manifests/22-alpine`). The value is the multi-platform image index digest. `node:22.23.3-alpine` resolves to the same index digest today, so pinning the exact version tag plus the digest keeps the Dockerfile readable.
- **Node version:** the newest `v22.*` entry in <https://nodejs.org/dist/index.json> is `v22.23.3` (LTS "Jod", 2026-09-23).

## Notes

- Digests for floating tags such as `node:22-alpine` change with every upstream rebuild. Re-resolve them on the day the pin is applied and update this file.
- `engines.node` is a published compatibility range for npm users as well as a runtime pin. When gate d48fb4c7 is decided, pin the runtime in the Dockerfile and CI, and decide separately whether the published range should stay a range.
- The CI matrix `node-version` values (`22`, `24`) also float to the newest patch release. The pin-check script does not report them; they are part of the same gate.
- The `pin-check` job's own checkout step is pinned to a SHA, so it adds no new floating reference.

## Turning the check into a gate

`node scripts/pin-check.mjs` reports and exits 0. `node scripts/pin-check.mjs --strict` (or `PIN_CHECK_STRICT=1`) emits errors and exits 1 when any floating reference remains. Switch the CI step to `--strict` once the pins above are applied.

## Refresh, 27 October 2026

Merged current `main` into the existing proposal without rewriting history. The reporter matches the report-only implementation in agent-handoff-mcp PR #49 at `85ca456a219582b27b7cecd929caa01324cae5c6` (ignoring line endings). It exits 0 with 12 floating references (9 action tags, 2 Docker bases and `engines.node >=22`). The job remains outside the required check aggregate; runtime pins, dependencies and permission logic are unchanged by this proposal.

The pin suggestions above are historical observations from 16 October, not freshly resolved pins. Re-resolve tags and image digests when gate `d48fb4c7` is decided. Marking this report-only proposal ready for review does not approve that gate or apply any pins.

Current main also contains 3 floating action references in `.github/workflows/codeql.yml`: `actions/checkout@v7`, `github/codeql-action/init@v4` and `github/codeql-action/analyze@v4`. These account for the increase from 9 to 12 findings. Resolve their full commit SHAs when applying pins; this refresh does not change them.
