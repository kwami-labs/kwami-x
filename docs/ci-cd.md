# CI/CD

How a change gets from a feature branch to a deployable Kwami v3 release.

- Pipeline: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- Releases: [`.github/workflows/release.yml`](../.github/workflows/release.yml) · [`docs/releases.md`](./releases.md)
- Promotion gate: [`.github/workflows/branch-promotion.yml`](../.github/workflows/branch-promotion.yml)

## Overview

```text
feature/*  ──PR──▶  dev  ──PR──▶  stg  ──PR──▶  main
                     │             │             │
                  ci gates      ci gates      ci gates
                     │             │             │
                3.1.0-dev.N   3.1.0-rc.N      3.1.0
```

`dev` is where work lands, `stg` is the release candidate, `main` is what a production deploy is
cut from. Every channel releases automatically on a green push.

## Branch model

| Branch               | Accepts                          | Releases      |
| -------------------- | -------------------------------- | ------------- |
| `feature/*`, `fix/*` | —                                | nothing       |
| `dev`                | any branch, forks included       | `x.y.z-dev.N` |
| `stg`                | this repo's current tip of `dev` | `x.y.z-rc.N`  |
| `main`               | this repo's current tip of `stg` | `x.y.z`       |

The direction is enforced, not merely documented.
[`assert-promotion-path.mjs`](../scripts/ci/assert-promotion-path.mjs) fails a PR — with a
comment explaining why — when it does not come from the channel below, when the head is not that
branch's **current tip**, when the head is a **fork** (a synced fork shares the tip SHA, so name
and SHA matching alone would let an outside repository promote into production), or when someone
opens a back-merge PR that `release.yml` should have pushed.

The rules are pure functions with their own tests
([`assert-promotion-path.test.mjs`](../scripts/ci/assert-promotion-path.test.mjs), 15 cases), so
a change to the gate is itself gated.

## Pipeline

```text
              ┌─ commits (PR only)
checkout ──▶  ├─ verify ──┬─ test ───┐
              │           └─ build ──┤
              └─ program ────────────┴──▶ gate
```

### `commits` — commitlint (pull requests only)

Lints every first-parent commit in the PR range. First-parent only: a promote PR absorbs history
from the channel below it, and re-litigating already-shipped subjects would fail every promotion.

### `verify` — lint · format · typecheck

`bun run lint`, `bun run format:check`, `bun run typecheck` (`nuxt typecheck`, which runs
`vue-tsc` over the app, server and shared layers).

### `test` — vitest + node:test

`bun run test:coverage` runs the suite with the ratchet in
[`vitest.config.ts`](../vitest.config.ts), and `bun run test:ci-scripts` runs the CI scripts'
own `node --test` suite.

### `program` — the Anchor vault

`cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, then `cargo build-sbf` behind the
Solana toolchain install. This job exists because the vault holds every Kwami's pot: it must
compile, lint clean and pass its own tests before anything that talks to it ships.

It runs independently of `verify`, so a Rust failure is visible even when the TypeScript side is
red.

### `build` — the Nuxt app

`bun run build`, then an assertion that `.output/server/index.mjs` exists and is non-empty — a
build that emits no server entry is a broken deploy that neither Nitro nor `tsc` necessarily
complains about.

### `gate` — one required check

Aggregates every job into a single status. `skipped` counts as passing (`commits` is skipped on
push); `failure` and `cancelled` never do. Protect the branches with **`ci gate`** alone rather
than five checks that must be re-added by name whenever a job is renamed.

## Repository settings

Declared as code in [`apply-branch-rules.mjs`](../scripts/ci/apply-branch-rules.mjs):

```bash
gh auth login
bun run rules:apply --dry-run   # print the rulesets, change nothing
bun run rules:apply             # create or update them, idempotently
```

- `main` / `stg`: PR required, 1 approval, Code Owner review on `main`, required checks
  **`ci gate`** and **`enforce promotion path`**, branches up to date, no force pushes, merge
  commits only (so individual subjects survive into the higher channel's changelog).
- `dev`: PR required, `ci gate` required, no approval count, squash merges (the PR title becomes
  the released commit subject).
- `github-actions[bot]` bypasses the pull-request rule everywhere — `release.yml` pushes the
  release commit, the tag and the back-merges directly. It does **not** bypass status checks.

## Loop safety

The release commit is pushed with `GITHUB_TOKEN`, and GitHub deliberately does not trigger
workflows for pushes made with it — the version bump cannot re-run CI or release itself.
`[skip actions]` in the message is the belt to that braces.

## Local gates

| Hook                                        | Runs                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| [`.husky/commit-msg`](../.husky/commit-msg) | `commitlint` on the message                                    |
| [`.husky/pre-commit`](../.husky/pre-commit) | `lint-staged` — ESLint, Prettier, `rustfmt` on staged files    |
| [`.husky/pre-push`](../.husky/pre-push)     | blocks direct pushes to channels; `typecheck` + the test suite |
