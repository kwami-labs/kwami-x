# Releases

Every version, tag, `CHANGELOG.md` entry and GitHub Release is derived from the commit history
by [semantic-release](https://semantic-release.gitbook.io/). Nothing is bumped by hand — the
`version` fields and the changelog are outputs, not inputs.

Kwami v3 is an **application**, not a package. Nothing is published to npm. A release is the tag,
the changelog and the GitHub Release that a deploy is cut from.

- Config: [`.releaserc.cjs`](../.releaserc.cjs)
- Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)
- Pipeline: [`docs/ci-cd.md`](./ci-cd.md)

## Channels

| Branch | Version shape                  | GitHub Release |
| ------ | ------------------------------ | -------------- |
| `dev`  | `3.1.0-dev.1`, `3.1.0-dev.2` … | Pre-release    |
| `stg`  | `3.1.0-rc.1`, `3.1.0-rc.2` …   | Pre-release    |
| `main` | `3.1.0`                        | Release        |

The prerelease counter resets when the base version changes: once `main` cuts `3.1.0`, the next
`dev` release is `3.2.0-dev.1`, not `3.1.0-dev.9`.

## What a commit does

| Commit                                          | Bump          |
| ----------------------------------------------- | ------------- |
| `feat: …`                                       | minor         |
| `fix: …`, `perf: …`, `refactor: …`, `revert: …` | patch         |
| `build(deps): …`                                | patch         |
| **any type with scope `program`**               | patch, always |
| any type with a `BREAKING CHANGE:` footer       | **major**     |
| `docs:`, `test:`, `ci:`, `chore:`, `style:`     | none          |

Two of those deserve explanation.

**`scope: program` always releases.** A change to `programs/kwami-vault` changes the code that
custodies every Kwami's pot. Even a `chore(program): bump anchor-lang` produces a different
deployed program, and a deployed program that no released version names is a program nobody can
account for.

**Rule order is load-bearing.** `releaseRules` are evaluated first-match-wins, and a matched
commit skips the preset's own defaults. `{ breaking: true, release: 'major' }` therefore has to
come _before_ `{ scope: 'program' }` — with the two the other way round, a `feat(program)!`
carrying a `BREAKING CHANGE:` footer cut a **patch**. There is a check for exactly this in
`docs/testing.md`.

## The pipeline

1. A PR lands on a channel. `ci` runs the full matrix on the push — including `cargo test`,
   `cargo clippy` and `cargo build-sbf` for the vault.
2. `release.yml` fires on `workflow_run: [ci] completed`, only for a **success** on a **push**,
   so no version is cut from a red commit.
3. It refuses to run if the branch tip has drifted ahead of the commit `ci` tested.
4. `release:baseline` tags the current version if no `v*` tag exists, so the first automated
   run bumps _over_ v3.0.0 instead of restarting at 1.0.0.
5. semantic-release works out the next version, regenerates `CHANGELOG.md`, bumps
   `package.json` **and** `programs/kwami-vault/Cargo.toml`
   ([`sync-program-version.mjs`](../scripts/release/sync-program-version.mjs)), tags, and cuts
   the GitHub Release.
6. On `main` only, [`sync-branches.mjs`](../scripts/release/sync-branches.mjs) back-merges
   `main` into `stg` and `dev`.

### Why the back-merge

A release commit only lands on the branch that produced it. Once `main` publishes `3.1.0`, `stg`
and `dev` still carry the `-rc` / `-dev` baseline: they would keep cutting prereleases of a
version that already shipped, and the next promote PR would conflict on exactly the files
semantic-release wrote. The back-merge resolves those — and only those — the only way they can
be: keep the branch's own `package.json` contents but adopt `main`'s version, and take `main`'s
changelog wholesale. Anything else conflicting is a real conflict, and the script stops.

## Running it locally

```bash
bun run release:dry-run   # analyse commits, print the next version, change nothing
```

## Deploying a release

The release does not deploy. It produces a tag and a GitHub Release; the deploy is a separate,
deliberate step that names a tag — which is the point, because a Kwami holding real SOL and USDC
should not change program or settlement behaviour because a merge happened.

Before deploying a release that touches `programs/`:

1. Confirm the program ID in `programs/Anchor.toml` matches the cluster you are deploying to.
2. `anchor build` and compare the on-chain hash with the artifact from the release's `ci` run.
3. Remember that an upgrade changes the code holding live pots. There is no rollback for a
   settlement that has already executed.
