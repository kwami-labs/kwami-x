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

241 tests across 18 files. Coverage of the logic layers sits at **93% lines / 95% branches**.

## What is covered

The suite concentrates on `shared/`, because that is where the rules live and where a mistake costs money.

**`economy.test.ts`** — basis-point arithmetic, ticket conservation, payout proportionality, both death rules, terminal-state handling. Includes the boundary cases that matter: a Kwami sitting exactly on the 1% line survives; `applyBps` rounds down so a winner can never take more than exists; a never-funded Kwami is not dust-dead.

**`secret.test.ts`** — normalisation across case, punctuation, accents and non-Latin scripts; Levenshtein and similarity; the fuzzy matcher against genuine wins, near-misses, and people _talking about_ the secret without saying it; commitment hashing and separator injection resistance.

The matcher tests are where the design is actually pinned down. It has to accept `"THE MÖON, REMEMBERS!"` and `"the moon rememebers"` while rejecting `"the moon forgets"` and `"is your secret about the moon?"` — that gap is the whole game, and it is easy to widen it accidentally.

**`session.test.ts`** — the clock, expiry on the exact boundary, and `resolveSession`. Including: a win spoken at 179.4s counts even if it arrives late, a win spoken at 180.001s does not, and the Kwami saying its own secret never wins the game for the player.

**`instructions.test.ts` and `borsh.test.ts`** — the wire format. Account order, signer and writable flags, little-endian integers, `Vec<u8>` length prefixes, discriminator derivation, and the fact that Anchor encodes an absent optional account as the _program id_ rather than by omitting the slot. Every one of these is a silent on-chain failure if it drifts from the Rust.

**`attest.test.ts`** — the oracle message layout, field by field, and the three bindings that stop replay: session, player, deadline.

**`crypto.test.ts`** — envelope encryption, including that tampering is detected and that two Kwamis with the same phrase do not produce identical rows.

**`eth.test.ts`** — signature recovery against a real signing round trip, including a message with non-ASCII characters, which recovers the wrong address if the EIP-191 length is measured in characters instead of bytes.

**`demo.test.ts`** — the seeded arena, checked against the real game rules rather than eyeballed. It has already caught one Kwami tagged `live` whose numbers put it below the death threshold.

## Writing tests here

Nothing in `shared/` reads a clock or a network. `resolveSession` takes `now`; `createSession` takes `startedAt`. Every test passes explicit values and no test mocks a timer.

`#shared/*` resolves in tests through the alias in `vitest.config.ts`, matching Nuxt's own resolution.

## Coverage thresholds

```
lines 80 · functions 80 · branches 75 · statements 80
```

Scoped to `shared/`, `server/utils/` and `app/utils/` — the logic layers. Components are not counted, because a coverage number over a `.vue` file measures whether it rendered, not whether it is right.

A short exclusion list in `vitest.config.ts` drops type-only declarations (they compile to nothing), the thin adapters over Supabase, Nitro storage and the RPC endpoint (their behaviour lives on the other side of the call), and the WebGL and WebAudio modules (happy-dom implements neither). The bar for adding to that list is that a test could only exercise a stub — not that writing one is inconvenient.

Where a module was hard to test for a structural reason, the structure changed rather than the list growing: `attest.ts` now separates building the oracle message from looking up the key, so the byte layout is testable without a keypair.

## The on-chain program

`programs/` has its own test path via `anchor test`, which requires the Anchor toolchain and a local validator. The Rust rules mirror the TypeScript ones in `shared/game/`, and the TypeScript suite is what pins the _semantics_ — the numbers, boundaries and rounding directions the Rust must also produce.
