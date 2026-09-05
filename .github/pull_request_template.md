<!--
The PR title must be a Conventional Commit — on a squash merge it becomes the commit subject
that drives semantic-release (version, tag, CHANGELOG, GitHub Release).
Examples: feat(session): cap challenge length server-side · fix(program): settle by CPI
-->

## Summary

<!-- What changed and why. Link the issue if there is one. -->

## Scope

- [ ] `programs/` — the vault. **Touches custody of user funds.**
- [ ] `shared/game` — economics, secret matching, session state
- [ ] `server/` — Nitro API
- [ ] `app/` — Nuxt pages, components, renderer
- [ ] `supabase/migrations` — schema or RLS
- [ ] Tooling / CI / docs (releases nothing on its own)

## Test plan

| Check   | Command                                        | Result |
| ------- | ---------------------------------------------- | ------ |
| Lint    | `bun run lint`                                 |        |
| Types   | `bun run typecheck`                            |        |
| Tests   | `bun run test`                                 |        |
| Program | `cd programs && cargo test && cargo build-sbf` |        |
| Build   | `bun run build`                                |        |

## Money paths

<!-- Delete this section only if the change cannot touch funds. -->

- [ ] No change to ticket payment, settlement, payout share or death accounting
- [ ] Changed — and the arithmetic is covered by a test that fails without the change
- [ ] The vault PDA's authority boundary is unchanged

## Checklist

- [ ] Targets `dev` (the promote path is `feature/* → dev → stg → main`)
- [ ] Conventional Commit title
- [ ] No secrets, `.env` values or keypairs committed
- [ ] `CHANGELOG.md` and `version` fields untouched — semantic-release owns them
