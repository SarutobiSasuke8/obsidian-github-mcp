# Disposable GitHub proposal/review proof

Roadmap item md-0288119a98 needs one real proposal on GitHub and a real human
review. The local substitute in `test/e2e/` proves request behaviour, not live
GitHub permissions or review. `scripts/disposable-github-proof.mjs` runs the
proof and appends evidence to `QA/PROOF_LOG.md`.

## Dry run (no network)

```bash
npm run build
node scripts/disposable-github-proof.mjs propose --dry-run
```

The built server runs with the local GitHub substitute. A real MCP client
authenticates as `example-writer` and creates one `review-first` proposal on
`agent/example-writer`. No GitHub call leaves the process. CI covers this in
`test/e2e/disposable-proof.test.mjs`.

## Live run (owner only)

What the owner supplies:

1. A throwaway repository you can delete afterwards, with a `main` branch and a
   branch named `agent/example-writer`.
2. A fine-grained token scoped to that repository only, with Contents read and
   write and Pull requests read. Put it in `GITHUB_TOKEN` in your shell. It is
   never printed, logged or written to disk.

Then:

```bash
node scripts/disposable-github-proof.mjs propose --owner <you> --repo <throwaway> --confirm-disposable <you>/<throwaway>
```

Open a pull request from `agent/example-writer` into `main` and review it as a
human: approve, request changes or comment. Then:

```bash
node scripts/disposable-github-proof.mjs verify --owner <you> --repo <throwaway> --confirm-disposable <you>/<throwaway>
```

`verify` records the pull request, its state and the human reviews. The item
is done when the log shows a live `propose` with a commit and a `verify` with
`humanReviewed: true`.

## Guards

- With no repository named, the script always dry-runs.
- A live run needs `--owner`, `--repo` and `--confirm-disposable` repeating
  `<owner>/<repo>` exactly, plus `GITHUB_TOKEN`. `--dry-run` with a repository
  is refused.
- The script never merges, approves, deletes or closes anything.
- The log holds paths, hashes, commit ids and review states only: no tokens and
  no note bodies.
