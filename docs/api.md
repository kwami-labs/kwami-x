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

| Query    | Default | Values                                 |
| -------- | ------- | -------------------------------------- |
| `state`  | `live`  | `live` `paused` `cracked` `dead` `all` |
| `sort`   | `pot`   | `pot` `new` `contested`                |
| `limit`  | 24      | 1–60                                   |
| `offset` | 0       |                                        |
| `owner`  | —       | filter by owner wallet                 |

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

## Docs

### `GET /api/docs/:slug`

Renders `docs/<slug>.md` to HTML. Path-traversal guarded.
