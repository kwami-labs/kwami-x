# Kwami v3

**Solana companions that guard a secret and a pot.**

Each Kwami is an NFT that owns money. Anyone can buy a ticket to talk to someone else's Kwami for three minutes. Say the phrase it is hiding before the clock runs out and **80% of its pot is transferred to you**. Miss, and your ticket stays in the pot — so the next challenger is playing for more than you were.

A Kwami that loses 99% of its peak value, or falls under a dollar, **dies**.

```
mint ──▶ commit a secret ──▶ publish ──▶ challengers pay ──▶ pot grows
                                              │
                              says the phrase ─┴─ runs out of time
                                    │                    │
                              takes 80%            ticket stays
                                    │                    │
                                    └──── pot shrinks ───┴──▶ death at −99%
```

---

## Run it

```bash
bun install
bun run dev
```

That is all of it. With no configuration the app runs in **demo mode** — a seeded arena, full 3D, full navigation — so a fresh clone is explorable before any infrastructure exists. Mutating routes return a 503 naming the variable they need, rather than pretending to work.

See **[docs/setup.md](docs/setup.md)** to add Supabase, Solana, voice and the on-ramp, one piece at a time.

## What is here

| Path | |
|---|---|
| `app/` | Nuxt 4 app — pages, components, Pinia stores, the Three.js renderer, the Phantom binding |
| `server/` | Nitro API — auth, Kwami CRUD, sessions, secrets, the Kwami's brain, MoonPay, the program builder |
| `shared/` | Pure domain logic: game economics, secret matching, session state, Solana encoding |
| `programs/kwami-vault/` | The Anchor program — escrow, sessions, settlement |
| `supabase/migrations/` | Schema, row level security, read models |
| `tests/` | 241 Vitest tests over the domain and utility layers |
| `docs/` | Full documentation, also served at `/docs` |

## The interesting parts

**Settlement never trusts the conversation.** The voice session is off chain; the payout is not. A Kwami commits to `sha256(secret ‖ salt)` at mint, and a winner either reveals the pre-image for the program to hash itself (trustless — and the Kwami retires, since the phrase is now public), or claims with an oracle-signed ed25519 attestation the program verifies through the instructions sysvar (private phrase, replayable Kwami, oracle trust). Owners choose per Kwami; challengers see which before they pay. → [docs/protocol.md](docs/protocol.md)

**A hand-written Phantom binding, not wallet-adapter.** `signAndSendTransaction` gives the user Phantom's decoded transaction preview instead of an unlabelled blob; `signIn` collapses connect-then-sign into one prompt; `accountChanged` matters when there is money in escrow. → [docs/auth.md](docs/auth.md)

**Six sign-in methods, one account.** Email, phone, Google, GitHub, Phantom (SIWS), MetaMask (SIWE) — all converging on the same `auth.users` row, so nothing downstream cares which door someone came through.

**Fuzzy matching that has to be exactly as forgiving as it is strict.** Speech-to-text is lossy. `"THE MÖON, REMEMBERS!"` and `"the moon rememebers"` must win; `"the moon forgets"` and `"is your secret about the moon?"` must not. That gap is the game. → `shared/game/secret.ts`

**An AI program builder with a real boundary.** A Kwami owner describes a financial game in plain language and gets an Anchor sub-program the vault calls at lifecycle moments. The extension has no authority over the vault PDA, so a bad one can break the owner's game but cannot drain it — which is what makes it safe to let a model write. → [docs/builder.md](docs/builder.md)

**Embeddable anywhere.** Any Kwami drops onto any site as an iframe or a 2KB loader script, still connected to its live pot. → [docs/embed.md](docs/embed.md)

## Commands

```bash
bun run dev            # development server
bun run build          # production build (Bun preset)
bun run test           # 241 tests
bun run test:coverage  # with thresholds
bun run typecheck      # vue-tsc over the project
bun run lint           # ESLint
bun run anchor:build   # build the Solana program
bun run db:push        # apply Supabase migrations
```

## Documentation

- [Overview](docs/index.md) · [Setup](docs/setup.md) · [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md) · [Economics](docs/economics.md) · [Security](docs/security.md)
- [Authentication](docs/auth.md) · [Embedding](docs/embed.md) · [Program builder](docs/builder.md)
- [HTTP API](docs/api.md) · [Testing](docs/testing.md)

## Status

The application, the domain layer and the documentation are complete and tested. The Anchor program is written and reviewed but **has not been audited or deployed** — see [docs/security.md](docs/security.md#not-yet-done) for the honest list of what is not finished.

## License

Apache-2.0
