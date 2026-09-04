# Architecture

## The one-sentence version

The chain is the ledger; Postgres is the index; the browser drives the wallet directly.

## Layers

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  Nuxt 4 · Pinia · Three.js · Web Speech · Phantom        │
└───────────────┬──────────────────────┬──────────────────┘
                │                      │
    signs & sends transactions    fetch /api/*
                │                      │
                ▼                      ▼
┌───────────────────────┐  ┌──────────────────────────────┐
│  Solana               │  │  Nitro (Bun)                 │
│  kwami_vault program  │  │  auth · sessions · secrets   │
│  • pots (escrow)      │  │  · brain · on-ramp · builder │
│  • sessions           │  └──────────┬───────────────────┘
│  • settlement         │             │
└───────────────────────┘             ▼
                          ┌──────────────────────────────┐
                          │  Supabase (Postgres)         │
                          │  auth · index · transcripts  │
                          │  · encrypted secrets         │
                          └──────────────────────────────┘
```

## What lives where, and why

### `shared/` — the rules

Pure TypeScript with no framework imports. Game economics, secret matching, the session state machine, Solana address derivation and instruction encoding.

It is `shared/` rather than `server/` because the same rules have to run in three places: the client (so the UI can quote a payout before anything is signed), the server (which is authoritative), and the tests (which are the only place the rules are actually pinned down). Anything that would have to be implemented twice belongs here.

Nothing in `shared/` reads a clock or a network. `resolveSession` takes `now` as an argument, which is what makes every transition deterministic and testable.

### `programs/` — the money

The Anchor program. Every rule that decides who gets paid is duplicated here in Rust, deliberately: the TypeScript is the interface, the Rust is the authority. When they disagree, the Rust is right and the TypeScript is a bug.

### `server/` — the things a chain must not see

Plaintext secrets, transcripts, personas, and the model calls that make a Kwami talk. Also every operation requiring a key: signing MoonPay URLs, signing win attestations, decrypting secrets.

Nitro routes are thin. Business rules are imported from `shared/`; the routes handle authentication, validation and persistence.

### `app/` — the interface

Pages, components, Pinia stores, the Three.js renderer, and the Phantom binding.

The wallet layer talks to `window.phantom.solana` directly rather than through `@solana/wallet-adapter` — see [the Phantom section](/docs/auth#phantom) for why that is worth the extra code.

## The data flow that matters: a challenge

1. **Client** builds `start_session_sol` and hands it to Phantom, which simulates it and shows a decoded preview.
2. **Chain** moves the ticket into the vault, splits the fee, creates the `Session` account and stamps `started_at` from the on-chain clock.
3. **Client** posts the signature to `/api/session/start`.
4. **Server** fetches that transaction from the cluster, confirms it actually opened *this* session PDA, and only then writes a session row. The countdown uses the chain's `started_at`, not the server's wall clock, so the timer and settlement cannot disagree.
5. **Client** streams speech to `/api/session/[id]/transcript`.
6. **Server** decrypts the secret, runs `matchSecret`, and on a hit returns the claim material — the pre-image, or an oracle signature.
7. **Client** builds the claim transaction and sends it through Phantom.
8. **Chain** verifies the proof itself and moves the money.

Note what step 8 does *not* depend on: by the time the client holds the claim material, the win is claimable from the transaction alone. If the server went down at that moment, the player would still get paid.

## Eventual consistency, on purpose

The `kwamis` table mirrors on-chain state — balances, counters, lifecycle. It is an index, and it is allowed to be stale.

What is never allowed is for a stale row to authorise anything. Every payout is decided by the program reading its own accounts. The index makes the arena fast to load; it does not make decisions.

## Demo mode

With no Supabase credentials, read routes serve a seeded dataset and every mutating route returns a 503 naming the missing variable. It exists so the first `bun run dev` on a clone produces a working, explorable app rather than a wall of errors — and so nobody can mistake a demo for a real mint, since writes are refused outright rather than faked.

## Why Bun

The Nitro `bun` preset, `bun install`, and Vitest under Bun. The practical win is install and cold-start time on a project that carries Solana's dependency tree; the practical cost is that a small number of Node-shaped packages need `vite.optimizeDeps` hints, which `nuxt.config.ts` provides.
