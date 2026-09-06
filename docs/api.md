# HTTP API

All routes are under `/api`. Authenticated routes take a Supabase JWT as `Authorization: Bearer <token>` or the `sb-access-token` cookie.

Every mutating route returns **503** with a message naming the missing environment variable when the app is in demo mode.

## Auth

### `POST /api/auth/nonce`

Issue a single-use sign-in nonce. Unauthenticated by design — this is the first step of logging in.

```json
→ { "address": "optional, binds the nonce to one wallet" }
← { "nonce": "…", "expiresInSeconds": 300 }
```

### `POST /api/auth/verify-solana`

```json
→ { "message": "<the exact SIWS text the wallet displayed>",
    "signature": "<base58>",
    "address": "<base58>" }
← { "user": {…}, "session": { "access_token": "…", "refresh_token": "…" } }
```

Also sets `sb-access-token` and `sb-refresh-token` as httpOnly cookies, so an SSR render picks the session up on the next request rather than flashing a signed-out shell.

### `POST /api/auth/verify-ethereum`

Same shape, EIP-4361 message and a `0x`-prefixed 65-byte signature.

## Kwamis

### `GET /api/kwami`

| Query    | Default | Values                                            |
| -------- | ------- | ------------------------------------------------- |
| `state`  | `live`  | `live` `paused` `starving` `cracked` `dead` `all` |
| `sort`   | `pot`   | `pot` `new` `contested`                           |
| `limit`  | 24      | 1–60                                              |
| `offset` | 0       |                                                   |
| `owner`  | —       | filter by owner wallet                            |

```json
← { "demo": false, "kwamis": [...], "totals": { "pot": 0, "live": 0, "sessions": 0 } }
```

Totals are computed over _all_ live Kwamis, not the returned page, so they stay put while someone scrolls.

### `GET /api/kwami/:mint`

Returns the Kwami plus its twelve most recent session **outcomes** — never transcripts. Showing how previous challengers probed a Kwami would hand every later player a free map of what has been tried.

### `POST /api/kwami/draft` — auth

Step 1 of minting. Validates the secret, generates a 32-byte salt, computes the commitment hash, stores the secret encrypted.

```json
→ { "name", "tagline", "persona", "renderer", "secret", "hints",
    "ticketPriceLamports", "ticketPriceUsdc", "sessionDuration",
    "payoutBps", "resolutionMode", "authorWallet" }
← { "draftId": "uuid", "secretHash": "<64 hex>" }
```

The salt is generated server-side. A client-chosen salt would let a malicious author commit to a hash they could later claim was over a different phrase.

### `POST /api/kwami/confirm` — auth

Step 2. Verifies the mint transaction against the cluster — that it succeeded, that it involves this mint, and that it called the Kwami program — before binding the draft to the mint address.

### `GET /api/kwami/:mint/metadata`

The NFT's off-chain metadata document, in Metaplex's standard schema. This is the URI written on chain at mint, so it is what Phantom, Magic Eden and Tensor read.

`animation_url` points at `/embed/<mint>`, so what a wallet renders is the live 3D Kwami rather than a static file. Cached for 30 seconds — long enough to protect the database, short enough that the pot a marketplace shows is roughly current.

### `GET /api/kwami/:mint/image.svg`

The static thumbnail, generated per request. Draws the current pot and a vitality ring using the same mint-derived palette and square-root scale as the app. SVG because it has to say something current, and because every NFT client renders it without an image pipeline behind it.

## Sessions

### `POST /api/session/start` — auth

Registers a session **after** the ticket has been paid on chain. Fetches the transaction, derives the expected session PDA and requires it to appear in the transaction's accounts.

```json
→ { "mint", "signature", "nonce", "asset" }
← { "session": { "id", "account", "nonce", "startedAt", "expiresAt", "room", "durationSecs" } }
```

`startedAt` comes from the chain's `blockTime`, not the server's clock.

### `GET /api/session/:id` — auth, player only

Session state plus its full transcript. Used to rehydrate after a reload — someone whose tab crashed at 1:40 should come back to the same clock and the same conversation, not a lost ticket.

### `POST /api/session/:id/transcript` — auth, player only

Records a spoken turn and decides whether it won.

```json
→ { "role": "player", "text": "…", "at": 45000, "confidence": 0.92 }
← { "won": true, "score": 0.97, "matchedText": "…", "nonce": 3,
    "claim": { "mode": "commit-reveal", "preimage": "…" } }
```

The utterance timestamp decides, not arrival time: a phrase spoken at 2:59.4 wins even if the event lands after the clock ran out. Network latency is not something a player should lose to.

A win is the **only** circumstance under which claim material leaves the server.

### `POST /api/session/:id/reply` — auth, player only

Asks the Kwami to answer. Runs server-side because the persona prompt contains the secret — the model needs it to steer _around_ it.

### `POST /api/session/:id/voice-token` — auth, player only

Issues a LiveKit token scoped to this session's room, expiring in five minutes.

```json
← { "transport": "livekit", "url": "wss://…", "room": "kwami-…", "token": "…" }
← { "transport": "browser" }   // when LiveKit is not configured
```

Reports `transport: "browser"` rather than failing when LiveKit is absent, so the client falls back to the Web Speech path instead of the session dying. The token never grants room admin — a player must not be able to evict the agent from the room they are trying to beat.

### `POST /api/session/:id/claimed` — auth, player only

Bookkeeping. Records the settlement signature after verifying it succeeded. Nothing here authorises a payout; the money already moved.

## On-ramp

### `POST /api/moonpay/sign` — auth

Returns an HMAC-signed MoonPay widget URL. Signing happens server-side because the signature covers the whole query string — that is what stops a page from rewriting `walletAddress` and redirecting someone else's purchase.

## Builder

### `POST /api/builder/generate` — auth, author only

Generates an Anchor extension from a brief. Requires the Kwami to be in `minted` state.

## Energy

### `GET /api/kwami/:mint/energy` — auth, author only

Balance, derived state and the last twenty ledger rows. Author-only including the ledger: how
heavily a Kwami is being talked to is competitive information.

```json
← { "balance": "38000", "state": "full", "kwamiState": "live",
    "energyPerSol": 20000, "ledger": [...] }
```

Balances are strings. They are `bigint` everywhere else and JSON has no such thing; a number would
round past 2^53, and this is the one figure on the page that has to be exact.

### `POST /api/kwami/:mint/energy/topup` — auth

Credits energy against an already-confirmed payment.

```json
→ { "signature": "<base58>" }
← { "balance": "58000", "state": "full", "kwamiState": "live" }
```

The signature is fetched from the cluster and the **treasury's own balance delta** is what gets
credited — a client asserting "I paid" is worth nothing when the reward for lying is free inference.
Idempotent on the signature, so a retry after a lost response cannot double it.

Not author-gated. Anyone may fuel anyone's Kwami; there is no way to abuse paying for someone else's
running costs.

## Studio

### `GET /api/studio/energy`

The account's pre-mint trial allowance, granted on first read. Answers for a signed-out or demo
caller too, with the full allowance — the meter is on screen before anything is spent, and a dash
there reads as broken rather than as "not yet".

### `POST /api/studio/preview`

Talk to a Kwami that has not been minted. Takes the unsaved draft, spends the Kwami's own energy
once it exists and the account's trial before that, and returns the reply.

```json
→ { "persona", "gameId", "guardStrength", "traits", "secret", "history", "utterance", "mint?" }
← { "text": "…", "source": "trial", "cost": "1000", "balance": "39000" }
```

It calls the same `respond()` the live game calls — including the redaction pass — rather than a
preview-only imitation. A test drive that exercised different code from the real thing would be
worse than none: it would build confidence in behaviour that was never going to happen.

Returns **402** when the balance cannot cover a reply. That is an outcome, not a failure: the
creator has not done anything wrong, they have used the thing up, and the page offers them fuel.

This is the one mutating-ish route that does **not** refuse in demo mode. Mutating routes return 503
there because they would have to pretend to have written something; this one writes nothing, and the
scripted brain needs no API key. A fresh clone should be able to hear a Kwami talk.

## Docs

### `GET /api/docs/:slug`

Renders `docs/<slug>.md` to HTML. Path-traversal guarded.
