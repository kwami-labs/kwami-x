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

## Voice, and where it stops

Two transports, chosen at runtime by `/api/session/:id/voice-token`.

**Browser (default).** The Web Speech API for recognition and synthesis, with the Kwami's replies generated server-side by `/api/session/:id/reply`. Needs no keys, no worker and no room — which is why it is the default: a fresh clone is playable, and LiveKit becomes an upgrade rather than a prerequisite.

**LiveKit.** When credentials are configured, the token endpoint mints a JWT scoped to the session's room. That is where this repository stops. The *agent* — the worker that joins the room, runs streaming STT and TTS, and speaks as the Kwami — is a separate long-running service, because a Nitro request handler cannot hold a WebRTC session open for three minutes.

Either way, the win decision is identical and server-side: transcript turns go to `/api/session/:id/transcript`, which is the only place the secret is ever compared against anything.

## Eventual consistency, on purpose

The `kwamis` table mirrors on-chain state — balances, counters, lifecycle. It is an index, and it is allowed to be stale.

What is never allowed is for a stale row to authorise anything. Every payout is decided by the program reading its own accounts. The index makes the arena fast to load; it does not make decisions.

## Demo mode

With no Supabase credentials, read routes serve a seeded dataset and every mutating route returns a 503 naming the missing variable. It exists so the first `bun run dev` on a clone produces a working, explorable app rather than a wall of errors — and so nobody can mistake a demo for a real mint, since writes are refused outright rather than faked.

## Why Bun

The Nitro `bun` preset, `bun install`, and Vitest under Bun. The practical win is install and cold-start time on a project that carries Solana's dependency tree.

The practical cost is that a few Node-shaped packages need help. Two are worth knowing about:

**`vite.optimizeDeps`** carries hints for `@solana/web3.js`, `bs58` and `tweetnacl`, which reach for Node globals Vite does not shim by default.

**`@solana/spl-token` is imported dynamically, inside the mint function.** It depends transitively on `bigint-buffer`, whose Node build tries to load a native NAPI addon and falls back to JavaScript on failure — except that under Bun the load is a hard panic (`unsupported uv function: uv_version_string`), so the `catch` never runs and the server dies on its first page render. Neither bundler aliasing nor `nitro.externals.inline` fixes this, because Nitro externalises node_modules and copies the native build through untouched.

The fix is not a workaround. The mint transaction is built and signed entirely in the browser, so SPL Token has no business in the SSR graph at all; a dynamic import inside `useMintKwami` keeps it out, which is both correct and smaller. Track: [oven-sh/bun#18546](https://github.com/oven-sh/bun/issues/18546).

The general lesson holds for anything added later: **anything the browser alone needs should be imported dynamically at its point of use**, not at module scope in a file that SSR will evaluate.
