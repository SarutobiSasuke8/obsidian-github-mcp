# Public artifact evidence for 0.1.0, 2026-11-13

Maintainer check of the published package on Windows 11, Node 22.22.1, npm 11.19.0. This is not an independent audit. It closes the "publish and cold-install the public artifact" item in the roadmap. It does not cover the disposable real GitHub and actual-client workflow, which is still open.

## What was published

| Fact | Value |
|---|---|
| Package | `@sarutobi-sasuke/obsidian-github-mcp@0.1.0` |
| Registry tarball | `https://registry.npmjs.org/@sarutobi-sasuke/obsidian-github-mcp/-/obsidian-github-mcp-0.1.0.tgz` |
| `dist.integrity` | `sha512-bSLAwpI71BZETsNaCRyrZUSvFOOsUu8claUqhMMBUp6Thw/nIpmdz4vSqvUg232owkCMHfWm3jmL0V0Kl6OBvw==` |
| `dist.shasum` | `e2bcd426c4e45ad559b908fc9e8699bfae66c81f` |
| Provenance | SLSA v1 attestation present (`https://slsa.dev/provenance/v1`) |
| Registry `gitHead` | `e82b557104d0daf3dde8901ebeb315392b7ea541` |
| Tag `v0.1.0` commit | `e82b557104d0daf3dde8901ebeb315392b7ea541` (matches) |
| Publish run | [Publish npm package, run 40108045013](https://github.com/SarutobiSasuke8/obsidian-github-mcp/actions/runs/40108045013), success, 2026-10-24, same commit |
| GitHub release | [v0.1.0](https://github.com/SarutobiSasuke8/obsidian-github-mcp/releases/tag/v0.1.0), published 2026-10-24, no attached assets |

The package was published from the release workflow, not from a workstation. The provenance attestation and the matching commit are the evidence for trusted publishing.

## Cold install

In a new empty directory with no lockfile and no local checkout:

```
npm init -y
npm install @sarutobi-sasuke/obsidian-github-mcp@0.1.0 --ignore-scripts
npm audit signatures
```

- Install succeeded. The `obsidian-github-mcp` bin was linked.
- `npm audit signatures`: 82 packages with verified registry signatures, 15 with verified attestations, none invalid.
- Starting the bin with no environment fails closed: it exits with code 1 on a configuration error naming `VAULT_MCP_POLICY_FILE` and the other required variables. No server starts without a policy file.

Not checked here: a full MCP session against the installed copy with a real policy and a real GitHub token. The packaged proof in CI covers the same entry point with a test-only GitHub backend.

## Finding: 0.1.0 installs with 3 moderate advisories

`npm audit` in the cold-install directory reports 3 moderate findings on 2026-11-13. The 2026-10-01 sweep reported 0, so these were disclosed or pulled in after that.

| Dependency as installed | Advisory | Path |
|---|---|---|
| `minimatch@10.2.6` | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), denial of service through glob part amplification | direct dependency, pinned in 0.1.0 |
| `@hono/node-server@1.19.19` | [GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f), `serveStatic` decodes the path twice | through `@modelcontextprotocol/node@2.1.1` |

The third finding is the package itself, flagged because it depends on the affected `minimatch`.

`main` already carries the fixes: `minimatch` 11.0.4 (#34), `@modelcontextprotocol/node` 2.1.2 and an override of `@hono/node-server` to 2.0.12. They are not in any published version. Whether either advisory is reachable in this server has not been assessed. Policy path patterns are operator-written, not caller-written, and the server does not use `serveStatic` directly, but neither point was tested.

Recommended next step, for the maintainer to decide: publish 0.1.1 from `main` through the same release workflow, then repeat this cold install and expect a clean `npm audit`.
