# Testing

```bash
bun run test           # everything
bun run test:watch     # watch mode
bun run test:coverage  # with thresholds
```

## Two projects

`vitest.config.ts` defines two, deliberately split:

- **`unit`** — the pure domain modules, in plain Node with no Nuxt involvement. Fast enough to leave in watch mode while editing game rules.
- **`integration`** — anything touching components, composables or auto-imports, in `happy-dom`.

## What is covered

The suite concentrates on `shared/`, because that is where the rules live and where a mistake costs money.

**`economy.test.ts`** — basis-point arithmetic, ticket conservation, payout proportionality, both death rules, terminal-state handling. Includes the boundary cases that matter: a Kwami sitting exactly on the 1% line survives; `applyBps` rounds down so a winner can never take more than exists; a never-funded Kwami is not dust-dead.

**`secret.test.ts`** — normalisation across case, punctuation, accents and non-Latin scripts; Levenshtein and similarity; the fuzzy matcher against genuine wins, near-misses, and people *talking about* the secret without saying it; commitment hashing and separator injection resistance.

The matcher tests are where the design is actually pinned down. It has to accept `"THE MÖON, REMEMBERS!"` and `"the moon rememebers"` while rejecting `"the moon forgets"` and `"is your secret about the moon?"` — that gap is the whole game, and it is easy to widen it accidentally.

**`session.test.ts`** — the clock, expiry on the exact boundary, and `resolveSession`. Including: a win spoken at 179.4s counts even if it arrives late, a win spoken at 180.001s does not, and the Kwami saying its own secret never wins the game for the player.

## Writing tests here

Nothing in `shared/` reads a clock or a network. `resolveSession` takes `now`; `createSession` takes `startedAt`. Every test passes explicit values and no test mocks a timer.

`#shared/*` resolves in tests through the alias in `vitest.config.ts`, matching Nuxt's own resolution.

## Coverage thresholds

```
lines 80 · functions 80 · branches 75 · statements 80
```

Scoped to `shared/`, `server/utils/` and `app/utils/` — the logic layers. Components are not counted, because a coverage number over a `.vue` file measures whether it rendered, not whether it is right.

## The on-chain program

`programs/` has its own test path via `anchor test`, which requires the Anchor toolchain and a local validator. The Rust rules mirror the TypeScript ones in `shared/game/`, and the TypeScript suite is what pins the *semantics* — the numbers, boundaries and rounding directions the Rust must also produce.
