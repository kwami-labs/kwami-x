# Authentication

Six ways in. All six produce the same `auth.users` row shape, so nothing downstream has to care which door someone came through.

| Method           | Provider       | Can hold a Kwami?               |
| ---------------- | -------------- | ------------------------------- |
| Email + password | Supabase       | Only with a Solana wallet bound |
| Phone (SMS OTP)  | Supabase       | Only with a Solana wallet bound |
| Google           | Supabase OAuth | Only with a Solana wallet bound |
| GitHub           | Supabase OAuth | Only with a Solana wallet bound |
| **Phantom**      | Custom (SIWS)  | **Yes**                         |
| MetaMask         | Custom (SIWE)  | No — identity only              |

## The gate

Signing in happens in a glass panel over a live field of drifting Kwamis, not on a page of its
own. The Kwamis are the product; the form is the toll. Rendering it as an overlay also means
there is no navigation to undo afterwards — dismissing the panel reveals the arena that was
already loading behind it.

The panel is dismissible on the pages that only _show_ things (`/`, `/kwami/…`,
`/leaderboard`), so a shared link to a specific Kwami is readable before anyone is asked for an
account. It is not dismissible on the pages that move money or write state, which have nothing
to show a visitor who cannot do either. `/docs`, `/embed` and `/auth/callback` are never gated:
the first is documentation, the second renders on other people's sites, and gating the third
would deadlock the flow that produces the session.

With no Supabase project configured the gate does not appear at all. Demo mode makes every
sign-in method fail by design, and a locked door with no key is worse than an open one — the
check is `isConfigured` from `shared/config/`, the _same_ placeholder-aware test the server uses
to decide demo mode, because the two disagreeing produced exactly that locked door.

## Binding a wallet to an account {#binding}

Signing in with Phantom proves an address as a side effect. The other five methods do not, so
connecting a wallet afterwards posts a fresh SIWS signature to `/api/me/wallet`, which verifies
it through the same `verifySignedSiws` the sign-in route uses and writes `wallet_identities`.

Two things follow from that shared verifier. A browser can never bind an address it cannot sign
for — the claim is worth nothing on its own when the reward for lying is another user's payouts
landing in your wallet. And an address already bound elsewhere is **refused**, not moved:
silently re-pointing it would let anyone holding the private key take over the payout
destination of an account they do not otherwise control.

The already-bound check runs first and costs one GET, because the alternative is a wallet popup
on every page load for someone who bound the same address last week — and a prompt with nothing
to approve is how users learn to click through prompts without reading them.

### Nitro cannot see the browser's session

Supabase keeps the session in local storage, which is what lets it refresh tokens without a
round trip — and means nothing is sent automatically. Every route behind `requireUser` answers
401 to a plain `$fetch`.

The wallet path sets a cookie, which is why it appeared to work while the other four did not:
email, phone, Google and GitHub could sign in perfectly and then fail at the first thing the
account was for. `app/utils/api.ts` attaches the bearer token to same-origin `/api/` requests,
and `useApi()` is what every authenticated call site uses. It is scoped to same-origin paths on
purpose: a token is a bearer credential, and must never ride along to a third-party host because
a URL happened to be passed in.

## Wallet sign-in

Supabase has no wallet provider, so Phantom and MetaMask go through `/api/auth/*`, which verifies a signature and mints a real Supabase session.

```
POST /api/auth/nonce          → { nonce }
   wallet signs a SIWS/SIWE message containing that nonce
POST /api/auth/verify-solana  → { session }
```

The nonce is single-use and stored in Nitro's storage layer rather than a module-level `Map`, because a serverless deployment spreads requests across instances: a nonce issued by one worker has to be redeemable by another, and a replayed nonce has to be rejected by all of them. `consumeNonce` deletes as it reads, whether or not the nonce turned out to be valid.

### Order of checks

In `verify-solana.post.ts` the order is deliberate:

1. Parse the message. Malformed input is rejected before anything expensive.
2. Confirm the address in the _signed message_ matches the claimed one. Trusting the request body here would let a caller claim someone else's signature belongs to their wallet.
3. Consume the nonce — **before** verifying the signature, so a burst of retries with one nonce cannot be used to grind at it.
4. Validate domain, version, timestamps.
5. Only now, verify the signature.

The domain check is the one that stops replay: the wallet showed the user a specific domain, and a signature farmed on another site carries that other domain in its body.

### Turning a signature into a Supabase session

`server/utils/wallet-session.ts`:

1. Look the wallet up in `wallet_identities`.
2. On first sight, create an auth user with a synthetic, non-routable email (`solana-<addr>@wallet.kwami.invalid`).
3. Generate a magic link with the admin API and immediately redeem it server-side with `verifyOtp`.

The link is never emailed. This is the supported way to issue a session for an identity the application has already authenticated itself, and the payoff is that a wallet user is an _ordinary_ Supabase user — same JWT, same RLS policies, and the option to later attach an email or a Google account to the same row rather than maintaining a parallel identity system forever.

## Phantom {#phantom}

The Phantom binding is hand-written (`app/utils/phantom.ts`) rather than `@solana/wallet-adapter`. Three behaviours justify the extra code:

**`signAndSendTransaction`.** Phantom simulates server-side and shows a decoded preview of what the transaction does. Going through `signTransaction` and broadcasting ourselves skips that, and an unlabelled "unknown transaction" prompt is exactly what a first-time buyer bounces off. It also puts retries and preflight in Phantom's hands, which is more reliable than a browser tab racing a flaky public RPC.

**`signIn` (SIWS).** One prompt that both connects and authenticates, rendered as structured fields rather than a wall of text. The generic path is connect, then a second `signMessage` prompt — which reads as two separate asks and loses people at the second one.

**`accountChanged`.** Phantom lets a user switch accounts without disconnecting. A game with money in escrow has to follow that immediately rather than keep signing as the wrong wallet.

There is a `signMessage` fallback for wallets that do not implement SIWS. It constructs the byte-identical message so the server verifies both paths the same way.

### Mobile

Mobile browsers cannot host the extension. `phantomDeeplink()` builds a universal link that reopens the current page inside Phantom's in-app browser, where the provider _is_ injected.

### Detection

`waitForPhantom()` polls and listens for `phantom#initialized` for up to three seconds. Phantom does not inject synchronously on every browser — Firefox in particular can land the provider after `DOMContentLoaded` — and showing "install Phantom" to somebody who already has it is worse than a short wait.

## MetaMask

MetaMask signs a standard EIP-4361 message. Recovery is done with `@noble/curves` rather than viem or ethers: the only Ethereum operation Kwami performs is recovering an address from a `personal_sign` signature, and a full client library is several hundred kilobytes of transitive dependency for one elliptic-curve call.

An Ethereum account is **identity only** — it cannot hold a Kwami or receive a payout. The sign-in screen says so at the point of connection, because someone who discovers it later cannot understand why they have no balance.

The EIP-191 prefix length is the message's **byte** length, not its character count. Measuring with `String.length` recovers the wrong address for any message containing non-ASCII.
