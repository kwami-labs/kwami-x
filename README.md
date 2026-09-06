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

Talking costs money — the model calls, the speech. That comes out of the Kwami's **energy**, never
out of its pot, and a Kwami that runs dry goes quiet and leaves the arena until its owner tops it
up. Nothing is lost; it comes straight back.

---

## Run it

```bash
bun install
bun run dev
```

That is all of it. With no configuration the app runs in **demo mode** — a seeded arena, full 3D, full navigation — so a fresh clone is explorable before any infrastructure exists. Mutating routes return a 503 naming the variable they need, rather than pretending to work.

See **[docs/setup.md](docs/setup.md)** to add Supabase, Solana, voice and the on-ramp, one piece at a time.

## What is here

| Path                    |                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `app/`                  | Nuxt 4 app — pages, components, Pinia stores, the Three.js renderer, the Phantom binding         |
| `server/`               | Nitro API — auth, Kwami CRUD, sessions, secrets, the Kwami's brain, MoonPay, the program builder |
| `shared/`               | Pure domain logic: game economics, secret matching, session state, Solana encoding               |
| `programs/kwami-vault/` | The Anchor program — escrow, sessions, settlement                                                |
| `supabase/migrations/`  | Schema, row level security, read models                                                          |
| `tests/`                | 487 Vitest tests over the domain and utility layers                                              |
| `docs/`                 | Full documentation, also served at `/docs`                                                       |

## The interesting parts

**Settlement never trusts the conversation.** The voice session is off chain; the payout is not. A Kwami commits to `sha256(secret ‖ salt)` at mint, and a winner either reveals the pre-image for the program to hash itself (trustless — and the Kwami retires, since the phrase is now public), or claims with an oracle-signed ed25519 attestation the program verifies through the instructions sysvar (private phrase, replayable Kwami, oracle trust). Owners choose per Kwami; challengers see which before they pay. → [docs/protocol.md](docs/protocol.md)

**A hand-written Phantom binding, not wallet-adapter.** `signAndSendTransaction` gives the user Phantom's decoded transaction preview instead of an unlabelled blob; `signIn` collapses connect-then-sign into one prompt; `accountChanged` matters when there is money in escrow. → [docs/auth.md](docs/auth.md)

**Six sign-in methods, one account.** Email, phone, Google, GitHub, Phantom (SIWS), MetaMask (SIWE) — all converging on the same `auth.users` row, so nothing downstream cares which door someone came through. The first screen is a glass panel over a live field of drifting Kwamis rather than a form on a blank page: what the product _is_ should be visible before the toll to enter it. Connecting a wallet afterwards binds it to that account by signature, never by assertion — a browser claiming an address is worth nothing when the reward for lying is someone else's payout.

**Every Kwami is designed, not hashed.** A creator picks its palette, its body, its voice and the _kind_ of contest it runs — an interrogation, a riddle, a negotiation, a confession, a trial — and those choices are minted with it. The game mode is not flavour text: it reaches the Kwami's system prompt and governs what it may do with the phrase, and a challenger reads it on the profile before paying. Selling three minutes against a stonewaller to someone who was promised a riddle is how a game gets a reputation for being unwinnable. → `shared/kwami/`

**Fuzzy matching that has to be exactly as forgiving as it is strict.** Speech-to-text is lossy. `"THE MÖON, REMEMBERS!"` and `"the moon rememebers"` must win; `"the moon forgets"` and `"is your secret about the moon?"` must not. That gap is the game. → `shared/game/secret.ts`

**An AI program builder with a real boundary.** A Kwami owner describes a financial game in plain language and gets an Anchor sub-program the vault calls at lifecycle moments. The extension has no authority over the vault PDA, so a bad one can break the owner's game but cannot drain it — which is what makes it safe to let a model write. → [docs/builder.md](docs/builder.md)

**A Kwami owns money and also spends it, and the two are kept apart.** The pot is escrow — the
program has no instruction that spends it on anything but a payout, and an owner cannot touch it
while a challenger still has time on the clock. So the inference that makes a Kwami _answer_ is paid
for from a separate prepaid balance, its energy, bought with an ordinary SOL transfer the server
verifies against the cluster. Run out and the Kwami is `starving`: unlisted, selling nothing, pot
untouched, and one payment away from being back. It is the only transition in this system that
reverses. → [docs/energy.md](docs/energy.md)

**You can talk to a Kwami before you mint it.** Everything a creator chooses — the character, the
contest, how hard it defends the phrase — is written to the chain once and never again, and until
recently it was written by someone who had never heard the thing speak. The studio at `/mint` runs
the real brain against an unsaved draft, redaction pass included, so the object being minted is the
object that was rehearsed with. → `app/pages/mint.vue`

**Embeddable anywhere — including wallets you never integrate with.** Any Kwami drops onto any site as an iframe or a 2KB loader script. Its NFT metadata also points `animation_url` at that embed, so Phantom, Magic Eden and Tensor render the _live_ Kwami — real pot, real vitality — for free. The thumbnail is generated SVG for the same reason: a file pinned at mint would advertise a $0 pot forever. → [docs/embed.md](docs/embed.md)

## Commands

```bash
bun run dev            # development server
bun run build          # production build (Bun preset)
bun run test           # 487 tests
bun run test:coverage  # with thresholds
bun run typecheck      # vue-tsc over the project
bun run lint           # ESLint
bun run anchor:build   # build the Solana program
bun run db:push        # apply Supabase migrations
```

## Documentation

- [Overview](docs/index.md) · [Setup](docs/setup.md) · [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md) · [Economics](docs/economics.md) · [Energy](docs/energy.md) · [Security](docs/security.md)
- [Authentication](docs/auth.md) · [Embedding](docs/embed.md) · [Program builder](docs/builder.md)
- [HTTP API](docs/api.md) · [Testing](docs/testing.md)

## Status

The application, the domain layer and the documentation are complete and tested: 487 tests, 96.1% line coverage of the logic layers, clean typecheck and lint, and a production build that serves every route.

Two things are deliberately not finished, and neither is hidden:

- **The Anchor program has never been compiled.** There is no Rust toolchain in this environment. It is written and reviewed by reading — a pass that caught three real defects, including a lamport debit the Solana runtime would reject outright — and the TypeScript suite pins the semantics it must reproduce. But reading is not compiling. Build it before trusting it, and do not put real money behind it.
- **The LiveKit voice agent is a separate service.** This repo mints the room tokens; the worker that joins the room and speaks as the Kwami runs elsewhere. The game is fully playable in the meantime on the browser Web Speech path, which needs no infrastructure at all.

See [docs/security.md](docs/security.md#not-yet-done) for the rest of the honest list.

## License

Apache-2.0
