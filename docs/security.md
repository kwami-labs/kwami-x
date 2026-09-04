# Security

The honest version of what trusts what.

## What is trustless

**Settlement.** Every payout is decided by the Anchor program reading its own accounts. No API response, database row or model output can move money.

**Commit–reveal wins.** The program hashes the submitted pre-image and compares it to a commitment written at mint. Nothing off chain can deny a real win or fabricate a fake one.

**Ticket escrow.** The vault is a system-owned PDA. Its lamport balance *is* the pot. Owner withdrawals are refused while a Kwami is live, so a pot cannot be drained mid-session.

**Scarcity.** `create_kwami` runs in the same transaction that revokes the NFT's mint authority. Without that, an author could mint a second copy of the same Kwami at any time and the scarcity claim would be worthless.

## What you are trusting

**The secret store.** A plaintext secret must exist somewhere off chain — the voice agent cannot tell when a challenger has won without it. It is encrypted with AES-256-GCM under a key held only in the process environment, in a table with RLS enabled and **zero policies**, which denies everything that is not service role. A database dump alone is inert. Someone with both the dump and the process environment has every secret.

**The match decision.** `matchSecret` runs server-side. A compromised server could refuse to acknowledge a genuine win. It could not *steal* the pot — it has no key that can claim — but it could stall.

**The oracle, in attested mode.** A registered ed25519 key signs win certificates. A compromised oracle can forge wins on attested Kwamis. It has no authority to move funds directly, so the blast radius is forged wins, not a drained treasury. Commit–reveal Kwamis are unaffected. Owners choose per Kwami, at mint, and challengers can see which mode they are playing before paying.

**The valuation oracle.** `record_valuation` prices a mixed SOL/USDC vault. It can only raise the high-water mark or declare death. A faulty oracle can kill a Kwami; it cannot steal from one.

## Specific defences

### Ed25519 read-back

Solana has no syscall to verify an ed25519 signature inside a program, so the runtime verifies a native `Ed25519Program` instruction and the program reads it back through the instructions sysvar. **Skipping that read-back is the classic hole** — the runtime would happily verify a signature over an attacker-chosen message.

`attestation.rs` checks the program id, requires exactly one signature, and compares the signer key and the full message bytes. It also requires the instruction to sit immediately before the claim, so a matching verification cannot be buried elsewhere in a large transaction and counted twice.

### Nonce replay

Sign-in nonces are single-use and consumed *before* signature verification, so retries with one nonce cannot be used to grind at it. They live in Nitro storage, not process memory, because a serverless deployment must reject a replay on every instance, not just the one that issued it.

### Domain binding

SIWS and SIWE messages carry the domain the wallet displayed. A signature farmed on another site carries that other domain and is rejected.

### Session concurrency

`start_session_*` requires `nonce == kwami.sessions_played`. One player cannot hold two sessions against the same Kwami at once, which forecloses parallel brute-forcing.

### Transaction verification

Both `/api/kwami/confirm` and `/api/session/start` fetch the referenced transaction from the cluster and check what it actually did. Without that, a caller could POST any successful signature and have the index believe a claim the chain would disagree with. The chain would still be right — but the arena would show the lie, which is enough to run a convincing scam.

### Transcript privacy

RLS restricts transcripts to the player. A Kwami's author never sees how challengers probed it — otherwise a popular Kwami's owner could farm the attempts and pre-empt every future line of attack.

### The secret cannot be spoken by the Kwami

`redactSecret` runs over every generated reply before it is returned. A model told "never reveal the secret" will still leak it to a sufficiently clever challenger — that is the game — but it must not leak it by accident, and no prompt is reliable enough to make that impossible. So the check happens in code, after generation, where it cannot be talked around.

### Framing

`server/middleware/security-headers.ts` sets `frame-ancestors 'none'` and `X-Frame-Options: DENY` on every route except `/embed/**` and `/embed.js`, which set `frame-ancestors *` because being framed by strangers is their entire purpose.

That split matters: a framed mint or claim page is a clickjacking primitive for transactions worth real money. `X-Frame-Options` has no allow-list form, so the embed routes omit it and rely on CSP.

The middleware also sets `Permissions-Policy` allowing only the microphone — the whole game — and denying camera, geolocation and the rest.

### Path traversal

`/api/docs/:slug` accepts only `^[a-z0-9][a-z0-9-]{0,63}$` — a path segment, not a path. It also reads through Nitro's server-asset storage rather than the filesystem, so there is no `join` to get wrong. The slug comes from a URL, and `../../.env` is one careless path concatenation away from being served as documentation.

## Not yet done

- The program has not been audited. Do not deploy it to mainnet with real money.
- `record_valuation` is a single-signer push. A production deployment should use a price feed with staleness and confidence bounds.
- There is no rate limiting on `/api/auth/nonce`. It is cheap, but it is unbounded.
- Extension CPI dispatch is specified and registered but not yet wired into the vault's lifecycle instructions.
