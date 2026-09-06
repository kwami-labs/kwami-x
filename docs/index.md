# Kwami v3

Kwami is a Solana NFT collection where each token owns a pot of money and guards a secret phrase.

Anyone can buy a ticket to talk to someone else's Kwami for three minutes. If they say the phrase it is hiding before the clock runs out, **80% of the pot is transferred to them**. If they don't, the ticket stays in the pot and the next challenger is playing for more.

A Kwami that loses 99% of its peak value — or falls under a dollar — **dies**, permanently.

---

## The shape of it

```
mint ──▶ commit a secret ──▶ publish ──▶ challengers pay ──▶ pot grows
                                              │
                              says the phrase ─┴─ runs out of time
                                    │                    │
                              takes 80%            ticket stays
                                    │                    │
                                    └──── pot shrinks ───┴──▶ death at −99%
```

Everything that decides who gets paid happens on chain. The conversation happens off chain, but **settlement never trusts the conversation** — see [Protocol](/docs/protocol) for how a win is actually proven.

## What is in this repository

| Path                    | What it is                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `app/`                  | The Nuxt 4 application — pages, components, stores, the 3D renderer                                |
| `server/`               | Nitro API routes: auth, Kwami CRUD, sessions, the on-ramp, the program builder                     |
| `shared/`               | Pure domain logic shared by client, server and tests: game rules, secret matching, Solana encoding |
| `programs/kwami-vault/` | The Anchor program. The ledger, the escrow and the settlement rules                                |
| `supabase/migrations/`  | Schema, row level security, read models                                                            |
| `tests/`                | Vitest — unit tests over the domain, integration tests over the app                                |
| `docs/`                 | This documentation. Also served at `/docs`                                                         |

## Start here

- **[Setup](/docs/setup)** — running it locally, with and without infrastructure
- **[Protocol](/docs/protocol)** — the on-chain program, its accounts and its instructions
- **[Economics](/docs/economics)** — ticket splits, payouts, the death rules
- **[Energy](/docs/energy)** — what it costs a Kwami to speak, and what happens when it cannot
- **[Architecture](/docs/architecture)** — how the pieces fit and what trusts what
- **[Authentication](/docs/auth)** — six sign-in methods converging on one account
- **[Embedding](/docs/embed)** — putting a Kwami on someone else's site
- **[Program builder](/docs/builder)** — authoring custom on-chain game logic
- **[HTTP API](/docs/api)** — every route
- **[Security](/docs/security)** — the trust boundaries, stated plainly
- **[Testing](/docs/testing)** — what is covered and how to run it

## Stack

Nuxt 4 · Bun · Vitest · Supabase · Solana (Anchor) · Three.js · Phantom · MoonPay
