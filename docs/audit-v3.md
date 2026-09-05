# Kwami v3 — pre-release audit

Every requirement in the v3 brief was audited against the implementation by an independent
reader, and every gap it reported was handed to a second reader whose instructions were to
**refute** it by opening the cited file and its callers, and to default to refuting when
uncertain. Only findings that survived appear here, each anchored to a file and line.

**20 blockers · 31 majors · 39 minors.**

Nine blockers and two majors have since been fixed — see [Fixed](#fixed). The rest stand.

## Verdict

This is not a stable release.

Four of the nine requirements are not wired end to end: `record_valuation`, the only code
path that can kill a Kwami, has no caller; the vault never invokes a builder extension;
publishing never marks a Kwami live, so no honest ticket can be bought; and there is no NFT
collection. Several confirmed defects let a challenger, an owner or a seller take funds that
are not theirs.

Underneath all of it: **`programs/` has no Rust tests.** There is no `#[cfg(test)]` module in
any of the five source files, and `Anchor.toml`'s `[scripts] test` points at a `tests/`
directory that does not exist under the Anchor workspace root. Settlement, death and
withdrawal have never been executed against a validator. The 278 TypeScript tests are real
and good, but they cover encoding and domain logic — not the on-chain behaviour that decides
who gets paid. That is why defects this severe coexisted with a green suite.

## Status by requirement

| Requirement                                                                | Status    | Blockers | Majors |
| -------------------------------------------------------------------------- | --------- | -------- | ------ |
| Solana NFT collection; immutable but transferable; buy and sell            | `partial` | 4        | 3      |
| Fully web3 app with Phantom and MoonPay ramp onboarding                    | `partial` | 1        | 4      |
| Interaction paid in SOL or USDC                                            | `partial` | 3        | 4      |
| Three minutes of voice to discover the secret                              | `partial` | 3        | 2      |
| 80% of the pot on a win; otherwise the ticket is forfeit and the pot grows | `partial` | 3        | 4      |
| Death at -99% of peak value, or under one dollar                           | `partial` | 1        | 4      |
| The 3D model integrates into any third-party app                           | `partial` | 1        | 4      |
| AI program builder generating Solana sub-programs                          | `partial` | 1        | 3      |
| Owners publish so others can interact                                      | `partial` | 3        | 3      |

## Themes

**Nothing verifies that a payment happened.** `session/start.post.ts` issues a session for
any transaction that merely lists the session PDA, and the recorded currency and amount come
from the client and the database rather than the chain.

**The USDC leg pins nothing.** `start_session_usdc` takes any `Mint` with no `address =`
constraint, so a token you minted yourself buys a real session that can pay out real SOL.
The SOL leg does pin its destinations — the pattern exists, it just is not applied here.

**Ownership is cached, not read.** Withdrawal authorises against `kwami.owner`, written at
mint and never refreshed from the token account, so a seller keeps the ability to drain the
pot after the sale.

**The oracle is trusted absolutely.** The ed25519 attestation verifier never validates the
precompile's instruction-index fields, and the same key that signs wins is the key that
declares death — held server-side.

## Blockers

Each of these loses funds, or means a stated requirement does not work at all.

### Solana NFT collection; immutable but transferable; buy and sell

**1. Freeze authority is retained by the minter forever — no code path ever revokes it**

`app/composables/useMintKwami.ts:116` — CONFIRMED

CONFIRMED, with corrected line numbers (the reporter's :119/:137 are off by three).
app/composables/useMintKwami.ts:116 is `createInitializeMint2Instruction(mint, 0, creator,
creator)`. Per node_modules/@solana/spl-token/lib/types/instructions/initializeMint2.d.ts:24 the
signature is `(mint, decimals, mintAuthority, freezeAuthority, programId?)`, so the 4th argument
`creator` is the freeze authority. The only revocation in the bundle is useMintKwami.ts:134,
`createSetAuthorityInstruction(mint, creator, AuthorityType.MintTokens, null)` — MintTokens
only. A grep for `AuthorityType|SetAuthority|setAuthority|FreezeAccount|freezeAuthority|freeze`
across app/, server/, shared/, programs/, supabase/, scripts/ and tests/ returns exactly three
hits, all in this file: lines 92, 95 and 134. Nothing in the Anchor program touches SPL
authorities either (programs/kwami-vault/src/lib.rs has no token-authority CPI). Concretely:
after selling, the author calls SPL `FreezeAccount` on the buyer's ATA; every subsequent
`Transfer` fails, the asset is delisted from every marketplace, and only the author can thaw it.
It is unfixable retroactively — `SetAuthority(FreezeAccount, None)` requires the current freeze
authority to sign, and that is the author. This directly defeats 'transferable, and can be
bought and sold'.

**2. No master edition is created, and revoking mint authority in the same tx makes it permanently uncreatable**

`app/composables/useMintKwami.ts:134` — CONFIRMED

CONFIRMED. `grep -rniE 'master.?edition|CreateMasterEdition'` over app/, server/, shared/,
programs/, supabase/, scripts/, tests/ and docs/ returns zero hits. The bundle at
app/composables/useMintKwami.ts:106-146 is exactly seven instructions: createAccount (107),
initializeMint2 (116), createATA (117), mintTo (118), createMetadataV3Ix (123),
setAuthority(MintTokens, null) (134), createKwamiIx (135). No CreateMasterEditionV3.
package.json:43-44 confirms the only Solana deps are @solana/spl-token and @solana/web3.js — no
@metaplex-foundation/* at all. Consequence: CreateMetadataAccountV3 leaves `token_standard`
unset; a 0-decimal supply-1 mint with no edition account is classified by DAS indexers and
Metaplex clients as a fungible asset, not NonFungible, which is why Tensor/Magic Eden treat it
as untradeable-as-an-NFT. Irreparable: CreateMasterEditionV3 requires the mint authority as a
signer, and line 134 sets it to null in the same transaction, so no Kwami minted by this code
can ever be upgraded.

**3. There is no Solana NFT collection anywhere in the repo — the requirement's first sentence is unimplemented**

`shared/solana/token-metadata.ts:97` — CONFIRMED

CONFIRMED. shared/solana/token-metadata.ts:97 writes `w.u8(0) // collection: Option<Collection>
— none` and :100 writes `w.u8(0) // collectionDetails: Option<CollectionDetails> — not a
collection parent`. `grep -rniE 'collection|VerifyCollection|SetAndVerify'` across app/,
server/, shared/, programs/, supabase/ and scripts/ returns only those two comment lines — no
collection mint keypair, no collection authority, no VerifyCollection/SetAndVerifyCollection
instruction, no collection column in supabase/migrations/20260904000001_init.sql:66-104.
tests/unit/token-metadata.test.ts:93 asserts the byte layout with `collection(0)`, locking the
absence in. Every Kwami is a standalone unaffiliated token: no marketplace grouping, no
collection-level verification, no collection floor or collection royalty. The requirement
literally opens 'Kwami is a Solana NFT collection'; the code ships individual tokens. The
reporter's added claim that this is _unrecoverable_ is partly right — shared/solana/token-
metadata.ts:99 writes `isMutable = false`, and mpl-token-metadata's update_metadata_accounts_v2
returns DataIsImmutable for any data change — though I could not prove from this repo that
SetAndVerifyCollection is equally blocked, since that program is not vendored here. The primary
finding (no collection exists) is fully proven.

**4. Withdrawal authority is the stale cached kwami.owner, so a seller can drain the pot after the sale**

`programs/kwami-vault/src/lib.rs:1002` — CONFIRMED

CONFIRMED — every line citation is exact. WithdrawSol (programs/kwami-vault/src/lib.rs:998-1014)
gates solely on `constraint = kwami.owner == owner.key()` at :1002; WithdrawUsdc (:1016-1030)
does the same at :1020. Neither Accounts struct contains an NFT token account, so neither
verifies current holdership. The handlers at :463 and :484 permit withdrawal in `Minted | Paused
| Dead | Cracked` (:465-468, :486-489), and pay real lamports out via pay_from_vault (:629-648)
/ transfer_checked (:492-506). `kwami.owner` moves only in sync_owner (:184-198), which is
permissionless but _nothing calls it_: shared/solana/instructions.ts:271 `syncOwnerIx` is
referenced only from tests/unit/instructions.test.ts:14 and :274 — a grep across app/, server/,
shared/ and scripts/ finds no other call site, and there is no indexer or cron to trigger it.
`pause` (:171) is gated on the same stale value via OwnerAction (:801-808, constraint at :806).
Concrete failure: Alice mints and publishes, the pot reaches 50 SOL, Bob buys the NFT on a
marketplace. On chain `kwami.owner` is still Alice. In one transaction Alice calls `pause`
(Live→Paused, allowed by :806) then `withdraw_sol(pot_lamports)` (allowed by :466 and :1002) and
keeps the whole pot. Bob owns an NFT over an empty vault. Note the app ships no withdraw
instruction builder (shared/solana/instructions.ts exports no withdrawSol/withdrawUsdc), so this
requires a hand-built transaction — which does not mitigate it, since the program is public and
the IDL is derivable.

### Fully web3 app with Phantom and MoonPay ramp onboarding

**5. No client ever sends an auth token; the on-ramp 401s for email/OAuth users and for everyone ~1h after a Phantom sign-in**

`server/utils/supabase.ts:45` — CONFIRMED

CONFIRMED. server/utils/supabase.ts:43-45 accepts a caller only via `authorization: Bearer` or
`getCookie(event, 'sb-access-token')`. Grepping app/ + server/ for
`Authorization|access_token|setCookie|onRequest` returns exactly: supabase.ts:37 (the server's
own userClient), wallet-session.ts:100/107/118, and auth.ts:120/134/187/193 (response bodies
handed to `supabase.auth.setSession`). There is no ofetch interceptor and no Nuxt plugin adding
a header (app/plugins/ contains only auth.client.ts, which just calls `auth.init()`).
app/pages/onramp.vue:18 does a bare `$fetch('/api/moonpay/sign', {method:'POST', body:{...}})`.
(a) Email/phone/Google/GitHub all go through the browser Supabase client
(app/stores/auth.ts:56-104) created by `createClient` with localStorage persistence
(app/composables/useSupabase.ts:15-22); no server route sets a cookie for them —
app/pages/auth/callback.vue is client-only and there is no /api/auth callback route (see the
full route list under server/api/) — so `requireUser` returns 401 while onramp.vue:51 has
already gated on `auth.isSignedIn` and shown them the buy form. (b) For Phantom,
`issueWalletSession` sets the cookie with `maxAge: verified.session.expires_in` (wallet-
session.ts:105, Supabase default 3600s); refresh happens only inside the browser client's
localStorage (useSupabase.ts:18), so after ~1h every `requireUser` route — moonpay/sign,
session/start, session/[id]/reply, session/[id]/voice-token, session/[id]/claimed, kwami/draft,
kwami/confirm, builder/generate — 401s while the UI still shows the user as signed in
(auth.ts:26 `isSignedIn` derives from the refreshed browser session), i.e. no in-app recovery
path. (c) `sb-refresh-token` (wallet-session.ts:107) is never read anywhere; `getRequestToken`
only reads `sb-access-token`. The comment at wallet-session.ts:98 is also wrong: package.json
lists `@supabase/supabase-js` only, no `@supabase/ssr`. This blocks paid gameplay, not just the
on-ramp.

### Interaction paid in SOL or USDC

**6. USDC mint is unpinned — any SPL/Token-2022 mint buys a real session that pays out real SOL**

`programs/kwami-vault/src/lib.rs:870` — CONFIRMED

programs/kwami-vault/src/lib.rs:870 is `pub usdc_mint: InterfaceAccount<'info, Mint>` with no
`address =` and no cross-check against any stored value. I grepped every `usdc` occurrence in
programs/ — the only uses are `ticket_price_usdc` (state.rs:77), `decimals` read off the passed
account (lib.rs:274) and the four token accounts, all constrained only by `token::mint =
usdc_mint` (lib.rs:871, 876, 880, 882). `Config` (state.rs:23-35) holds
authority/treasury/oracle/fee_bps/paused/bump and no mint; `Kwami` (state.rs:65-93) holds no
mint either. So `start_session_usdc` compares the caller's mint against nothing. The exploit
runs clean: `assert_playable` (lib.rs:542-549) passes, `require!(kwami.ticket_price_usdc > 0,
AssetNotAccepted)` (lib.rs:269) passes because that field is about the _price_, not the mint,
the nonce check (lib.rs:270) passes, and all three `transfer_checked` calls (lib.rs:276-303)
succeed because `decimals` came from the attacker's own mint (lib.rs:274). `vault_usdc` is
created by `init_if_needed` for that mint (lib.rs:873-879). A genuine `Session` is written with
`Asset::Usdc` and `ticket_amount = kwami.ticket_price_usdc` (lib.rs:305-315). The payout side
is what makes this severe rather than cosmetic: `settle_win` pays the SOL leg unconditionally —
`let payout_lamports = apply_bps(pot_lamports(vault)?, payout_bps)?; pay_from_vault(...)`
(lib.rs:706-707) — with no reference to `session.asset`. So a ticket bought with a worthless
self-minted token entitles the buyer to `payout_bps` (80% by default) of the pot's real
lamports. The only pinned USDC address in the repo, shared/solana/constants.ts:9-13, is imported
by nothing outside tests (verified by grep: only tests/unit/solana-constants.test.ts:3).

**7. Server issues a session on any transaction that merely lists the session PDA — no payment proven**

`server/api/session/start.post.ts:69` — CONFIRMED

server/api/session/start.post.ts:68-73 is the whole ticket check: `ts const keys =
tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58()) if
(!keys.includes(sessionPda.toBase58())) { throw ... } ` I read the handler end to end (119
lines). It never asserts the Kwami program was invoked, never inspects the instruction data or
discriminator, never reads `tx.meta.preBalances/postBalances` or token balances, and never
fetches the on-chain `Session`. The sibling handler proves the omission is not deliberate
design: server/api/kwami/confirm.post.ts:58-60 does exactly the missing check — `if
(!accountKeys.includes(config.public.kwamiProgramId as string)) throw ... 'That transaction did
not call the Kwami program.'` `sessionPda` is derived from `staticAccountKeys[0]` (the fee
payer, i.e. the caller) and the client-supplied `nonce` (start.post.ts:58-66), so the attacker
controls both seeds. Any transaction of theirs that lists that address satisfies the check — a
0-lamport `SystemProgram.transfer` to it is enough, since the system program returns `Ok` before
any balance work when `lamports == 0`. What that buys, all gated only on the DB row it just
created: the LiveKit room (server/api/session/[id]/voice-token.post.ts:33-37 checks only
`player_id`, `outcome`, `room`), the LLM with the secret in its prompt
(server/api/session/[id]/reply.post.ts:31-34, then `loadSecret` at :46), and on a phrase match
the commit-reveal pre-image or a signed oracle attestation
(server/api/session/[id]/transcript.post.ts:89-101). No caller-side rate limit exists: `nonce`
is free-form (`z.coerce.number().int().min(0)`, start.post.ts:13) and the only uniqueness is
`unique (kwami_mint, player_wallet, nonce)` (supabase/migrations/20260904000001_init.sql:159),
so attempts are unbounded. Interaction is not paid.

**8. Nothing sets kwamis.state = 'live', so no honest ticket in either currency can be bought**

`server/api/session/start.post.ts:45` — CONFIRMED

server/api/session/start.post.ts:45-47 hard-rejects unless the DB row says `'live'`. I grepped
every Supabase write under server/: the only `kwamis` writes are draft.post.ts:73 (`state:
'draft'`, line 87) and confirm.post.ts:67-70 (`.update({ mint, vault, state: 'minted' })`). No
other `.update(`/`.upsert(` touches that table. A repo-wide grep for `state: 'live'` / `state =
'live'` across app/, server/, shared/, scripts/, supabase/ returns only _reads_ and filters —
plus server/utils/demo.ts:59, a fixture that start.post.ts:29 (`assertNotDemo()`) explicitly
excludes. Publishing is chain-only: app/pages/kwami/[mint]/manage.vue:30 builds
`ownerActionIx('publish', ...)`, sends it (line 42-43) and calls `refresh()` (line 45) — which
re-fetches server/api/kwami/[mint].get.ts:25, a plain `from('kwamis_public').select('*')`. The
chain flips `kwami.state = KwamiState::Live` (lib.rs:165) but the row stays `'minted'`.
init.sql:90 says the cached columns are 'Cached from chain by the indexer'; I searched for
`indexer`, `defineTask`, `scheduledTasks`, `cron` across nuxt.config.ts, server/, shared/,
scripts/, supabase/ and package.json — the word appears only in four comments (init.sql:58, 90,
248; claimed.post.ts:12). supabase/ contains exactly two migration files and nothing else.
`balance_lamports`/`balance_usdc` (init.sql:91-92) are likewise never written. One nuance the
reporter missed, which does not rescue it: the RLS policy `kwamis_update_own` (init.sql:246-247)
is `for update using (auth.uid() = author_id)` with no column list, so an author _could_ hand-
write `state = 'live'` through the anon client — but no code in app/ does (grep for
`from('kwamis')` in app/ returns nothing), and doing so would decouple the DB from the chain
rather than fix it. As shipped, every SOL and USDC ticket 409s at start.post.ts:46.

### Three minutes of voice to discover the secret

**9. No server-side wall-clock enforcement on any live-session endpoint**

`server/api/session/[id]/transcript.post.ts:68` — CONFIRMED

CONFIRMED, with corrected line anchors. I opened all four session handlers and every caller. -
transcript.post.ts selects `started_at, expires_at` (line 38) and at lines 61-63 computes
`startedAt`/`expiresAt`/`deadlineMs` — but the only gate is `if (body.at > deadlineMs)` at line 68. `Date.now()` never appears in the file. The gate is purely relative to a client number. -
reply.post.ts:35 gates only on `if (session.outcome !== 'pending')`; the sole use of the real
clock is line 47, `const secondsLeft = Math.max(0, (new Date(session.expires_at).getTime() -
Date.now()) / 1000)` — and it is clamped to 0 and passed to `respond({... secondsLeft})` for the
taunt prompt only (lines 49-56). A session hours past its deadline gets `secondsLeft = 0` and a
full Kwami reply. - voice-token.post.ts selects `expires_at` at line 29 and never reads it
again; the gates are `outcome !== 'pending'` (line 36) and `!session.room` (line 37). -
index.get.ts merely echoes `expiresAt` (line 37). I also checked every place that could have
handled this elsewhere and found nothing: `server/middleware/` contains only security-headers.ts
(CSP/frame-ancestors, no session logic); `server/routes/` is empty; there is no
`server/plugins/`; nuxt.config.ts declares no Nitro tasks or scheduled handlers; the RLS
policies in supabase/migrations/20260904000001_init.sql:253-268 are SELECT-only and every
handler uses `serviceClient()` (server/utils/supabase.ts:18), which bypasses RLS entirely; and
there are no DB triggers on `game_sessions` (only handle_new_user and touch_updated_at, lines
281-315). What breaks: a repeat POST to /api/session/<id>/transcript and /reply works
indefinitely after the deadline. Combined with the fact that nothing ever writes any outcome
except 'won', the `outcome !== 'pending'` gates in reply.post.ts:35 and voice-token.post.ts:36
are the only closing condition and they never fire for time. The 3-minute limit is absent from
the API layer.

**10. The deadline check trusts a client-supplied timestamp with no upper bound**

`server/api/session/[id]/transcript.post.ts:12` — CONFIRMED

CONFIRMED exactly as reported. transcript.post.ts:12 is `at: z.number().int().min(0),` —
`.min(0)` only, no `.max()`. The value flows straight to the DB insert at line 52 (`at_ms:
body.at`) and to the sole window check at line 68 (`if (body.at > deadlineMs)`). The value is
produced entirely in the browser: app/composables/usePlaySession.ts:164, `const at = Math.max(0,
Date.now() - startedAt.value * 1000)`, then sent in the body at line 175. The client-side
`isLive` guard at usePlaySession.ts:163 is irrelevant to a curl caller. The DB column is `at_ms
integer not null` (migration line 171) with no CHECK constraint, so Postgres does not bound it
either. Sending `{"role":"player","text":"...","at":0}` passes the window test at any real-world
time. The handler comment at lines 65-67 frames this as latency tolerance for a genuine 2:59.4
utterance, but there is no bound on lateness — only on the number the client asserts.

**11. Unbounded time plus a scored-guess oracle and a returned plaintext pre-image**

`server/api/session/[id]/transcript.post.ts:100` — CONFIRMED

CONFIRMED, and I verified the on-chain half of the replay path. Oracle: transcript.post.ts:75
returns `{ won: false, outcome: 'pending', score: match.score }` on every miss. `matchSecret`
(shared/game/secret.ts:114-141) slides windows and returns `best`, a Levenshtein-derived
similarity in [0,1] (secret.ts:73-77) — a graded hill-climbing signal, not a boolean. Threshold
is 0.88 (secret.ts:103). I grepped app/, server/ and shared/ for rate limiting / throttling:
zero hits (the only match in the tree is unrelated prose). Combined with gaps 1 and 2 this is
unlimited scored guesses at unlimited real time. Pre-image: on a hit, transcript.post.ts:100
returns `preimage: secretPreimage(secret, salt)` = `normalizePhrase(secret) +  + salt`
(secret.ts:165-167) — the exact bytes the program hashes. Replay verified on chain: settle_win
refuses the stale session (`require!(now < session.expires_at, KwamiError::SessionExpired)`,
programs/kwami-vault/src/lib.rs:699). But claim_win_reveal checks only `hash(&preimage) ==
kwami.secret_hash` (lib.rs:342-343) — it never checks that a transcript, a server, or a spoken
utterance was involved. A fresh ticket calls init_session with `expires_at = now + duration`
(lib.rs:612), `nonce == kwami.sessions_played` (lib.rs:208 / 270), the Kwami is still Live so
assert_playable passes (lib.rs:542-548), and settle_win pays `apply_bps(pot_lamports(vault),
payout_bps)` plus the same bps of the USDC leg (lib.rs:706, 712) — 8000 bps / 80% by default
(shared/game/constants.ts:7, DB default at migration line 88). Cost of bypassing the 3-minute
window: one extra ticket. One nuance the reporter got right and I confirmed: in attested mode
the attestation is bound to the session PDA and the player with a 300s validity
(server/utils/attest.ts:37-48, 13), so the signature itself is not replayable to a new session —
but `won: true` still confirms the phrase, and the attacker simply speaks it inside a fresh,
legitimate 3-minute window. Also note the mitigation that exists: a successful reveal sets
`kwami.state = Cracked` (lib.rs:364-365), so the exploit is one-shot per Kwami — which is
exactly the whole pot.

### 80% of the pot on a win; otherwise the ticket is forfeit and the pot grows

**12. Ed25519 instruction-index fields never validated — oracle attestation is forgeable**

`programs/kwami-vault/src/attestation.rs:71` — CONFIRMED

CONFIRMED by reading the verifier and the precompile layout. programs/kwami-
vault/src/attestation.rs:33-36 defines only four constants (SIG_OFFSET_START=2,
PUBKEY_OFFSET_START=6, MSG_OFFSET_START=10, MSG_SIZE_START=12) and :73-76 reads exactly those. I
confirmed the real header layout in node_modules/@solana/web3.js/lib/index.cjs.js:9491 —
`struct([u8 numSignatures, u8 padding, u16 signatureOffset, u16 signatureInstructionIndex, u16
publicKeyOffset, u16 publicKeyInstructionIndex, u16 messageDataOffset, u16 messageDataSize, u16
messageInstructionIndex])` — a 16-byte header whose fields at bytes 4, 8 and 14 select WHICH
instruction's data the precompile reads key/sig/message from (index.cjs.js:9523: `0xffff // An
index of u16::MAX makes it default to the current instruction`). A grep for
`signature_instruction_index|public_key_instruction_index|message_instruction_index` across
programs/, shared/, app/, server/ and scripts/ returns nothing. So the program reads a pubkey
out of the ed25519 instruction's own data at :83 and compares it to config.oracle at :84, while
the runtime verified against whatever those three unread indices pointed at. Concrete break:
instruction 0 = any data-carrying instruction holding the attacker's own
pubkey/signature/message; instruction 1 = a hand-rolled ed25519 instruction whose data embeds
the oracle's 32 pubkey bytes at publicKeyOffset and the exact
KWAMIWIN||session||player||valid_until message at messageDataOffset (satisfying :84 and :87),
with all three index fields set to 0; instruction 2 = claim_win_attested. The precompile
verifies the attacker's own signature and passes; verify_oracle_signature returns Ok.
`load_current_index_checked` (:55) and the `current - 1` adjacency rule (:61) are satisfied. The
length guard at :65 requires only `>= MSG_SIZE_START + 2` = 14 bytes, two short of the 16-byte
header the precompile consumes — an independent confirmation that the last field was never in
the author's model. Any Kwami with ResolutionMode::Attested (state.rs:46-48) can be drained of
payout_bps by anyone holding one paid, unexpired session, with zero knowledge of the secret.

**13. Concurrent sessions plus no state check on claim lets one player take ~100% of the pot**

`programs/kwami-vault/src/lib.rs:208` — CONFIRMED

CONFIRMED; the in-code comment that denies it is factually wrong. start_session_sol requires
only `nonce == kwami.sessions_played` (programs/kwami-vault/src/lib.rs:208) and then increments
the counter (:249); start_session_usdc is identical (:270, :318). The counter is global to the
Kwami and bound to no player, so one wallet sends tx1 with nonce N (counter -> N+1) then tx2
with nonce N+1 (counter -> N+2), producing two distinct session PDAs — seeds are `[b"session",
mint, player, nonce_le]` at :832-838 — both Pending, both unexpired (session_duration up to
MAX_SESSION_DURATION 900s, state.rs:12). Nothing serialises or closes the first. Then:
`assert_playable` (defined lib.rs:542-550) is invoked at exactly two sites, :206 and :268, both
in start_session__. Neither claim_win_reveal (:335) nor claim_win_attested (:373) calls it, and
settle_win (:689-745) checks only `session.outcome == Pending` (:698) and `now <
session.expires_at` (:699) — it never reads kwami.state. So after the first claim sets
`kwami.state = KwamiState::Cracked` (:365), the second session passes every check and settle_win
pays payout_bps of the REMAINING balance, because payout is recomputed live from
`pot_lamports(vault)` (:706). Five pre-bought tickets extract 1 - 0.2^5 = 99.97%. This applies
to Attested mode too: both sessions belong to the same authenticated user, so
server/api/session/[id]/transcript.post.ts:45 lets them win both and collect two signatures. The
comment at :909-915 ('start_session__ allows only one of those to be open at a time') is the
stated justification for omitting a seeds constraint on `session` at :916-921 and is simply
false; app/composables/usePlaySession.ts:85-88 repeats the same false claim ('That is what stops
one player from opening several concurrent sessions'). No layer compensates:
supabase/migrations/20260904000001_init.sql:159 is `unique (kwami_mint, player_wallet, nonce)`,
which permits unlimited pending rows per player, and the RLS block at :220-280 adds nothing
here.

**14. Unmetered similarity oracle: score on every miss, client-supplied clock, no expiry writer, no rate limit**

`server/api/session/[id]/transcript.post.ts:72` — CONFIRMED

CONFIRMED, all three brakes verified absent. (1) server/api/session/[id]/transcript.post.ts:75
returns `{ won: false, outcome: 'pending', score: match.score }` — match.score is the best
Levenshtein-derived similarity across candidate windows (shared/game/secret.ts:133-136 via
similarity() at :73-77), i.e. a hill-climbing signal on every failed guess. (2) The only
deadline test is `if (body.at > deadlineMs)` at :68, and `at` is a client-supplied field of the
request body (Body schema :12, sent by app/composables/usePlaySession.ts:164,175) — an attacker
posts `at: 0` forever. (3) Nothing ever writes the 'expired' outcome. I grepped `outcome` across
server/, scripts/ and supabase/: the only writers are `outcome: 'pending'` at
server/api/session/start.post.ts:94 and `outcome: 'won'` at transcript.post.ts:86.
supabase/migrations/20260904000001_init.sql:135 declares the enum value, :220-320 contains the
RLS policies and the only triggers (handle_new_user, touch_updated_at) — neither touches
game_sessions. No keeper calls the on-chain settle_session either: `settleSessionIx`
(shared/solana/instructions.ts:251) is referenced only from tests/unit/instructions.test.ts:269.
So the `session.outcome !== 'pending'` guard at :57 never fires with the passage of time, and
the same holds for voice-token.post.ts:36 and reply.post.ts:35. (4) No rate limiting exists
anywhere in server/: the only middleware is server/middleware/security-headers.ts, which sets
CSP/XFO/Permissions-Policy and nothing else, and a case-insensitive grep for rate-
limit/throttle/attempt over server/ returns only an unrelated NFT trait at
server/api/kwami/[mint]/metadata.get.ts:66. One paid ticket therefore buys permanent unmetered
access to the oracle; once the secret is recovered the attacker opens a fresh session and wins
deterministically, which defeats the 'otherwise they lose the paid ticket' half of the
requirement. One correction to the report: because matchSecret returns only `best` across all
windows (secret.ts:124,134-137), a single 2000-char request yields one scalar, not ~400
independently scored candidates. The oracle is still fully usable for greedy refinement — the
severity is unchanged — but the per-request information is a maximum, not a per-candidate
vector.

### Death at -99% of peak value, or under one dollar

**15. record_valuation — the only code path that can kill a Kwami — has no caller anywhere in the repo**

`programs/kwami-vault/src/lib.rs:434` — CONFIRMED

CONFIRMED. `record_valuation` is the sole writer of `KwamiState::Dead` (programs/kwami-
vault/src/lib.rs:446) and the sole writer of `high_water_mark_cents` after mint (lib.rs:441);
`create_kwami` sets it to 0 at lib.rs:140. A repo-wide grep for
`record_valuation|recordValuation|RecordValuation` outside node_modules returns exactly six
hits: lib.rs:434, lib.rs:988, and four prose lines in docs/protocol.md:54, docs/economics.md:63,
docs/security.md:23 and docs/security.md:73. shared/solana/instructions.ts exports nine
instruction builders — `createKwamiIx` (:56), `ownerActionIx` (:87, publish/pause),
`startSessionSolIx` (:114), `startSessionUsdcIx` (:144), `claimWinRevealIx` (:197),
`claimWinAttestedIx` (:209), `settleSessionIx` (:251), `syncOwnerIx` (:271),
`registerExtensionIx` (:288) — and no valuation builder (the reporter said seven and omitted
`ownerActionIx`; the substantive point stands). nuxt.config.ts declares no `scheduledTasks` and
nitro config (lines 49-68) has no task registration; scripts/ holds only bootstrap-localnet.ts,
gen-keys.ts, _config.ts, ci/ and release/, none of which mention valuation (grep over .github
and scripts finds only attestation-oracle keygen). Consequence: on a shipped deployment
`high_water_mark_cents` stays 0 forever, `funded` at lib.rs:444 is always false, and no Kwami
can ever reach `Dead`. Nuance the reporter overstated slightly: the instruction is a public
Anchor entrypoint, so an operator holding the oracle key could hand-build the transaction — but
nothing in this codebase does, so the requirement is unenforced as shipped.

### The 3D model integrates into any third-party app

**16. Mint-derived palette is CSS Color 4 space syntax that Three.js cannot parse — every avatar renders white**

`app/utils/format.ts:82` — CONFIRMED

CONFIRMED and WIDER than reported. `app/utils/format.ts:82` returns `{ a: `hsl(${hueA} 78%
62%)`, b: `hsl(${hueB} 72% 58%)` }`. three@0.183.2's `Color.setStyle` hsl branch at
`node_modules/three/src/math/Color.js:350` requires commas:
`/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%.../`. No match → `break` → `return
this` at :407 with the value untouched. Executed against the repo's own build
(`node_modules/three/build/three.module.js`): `new Color('hsl(102 78% 62%)')` → r=1 g=1 b=1 →
`#ffffff`; the comma form → `#80ea53`. `new Color('#7c5cff').set('hsl(102 78% 62%)')` → still
`#7c5cff`, i.e. `.set()` is also a silent no-op, so the `setColors` watcher at `app/utils/kwami-
renderer.ts:366-368` cannot recover it either. Path into the renderer:
`app/pages/embed/[mint].vue:13` `paletteFromMint(mint.value)` → :17-18 used verbatim when the
host passes no `colorA`/`colorB` → :52-53 `:color-a="palette.a"` →
`app/components/KwamiAvatar.vue:27-28` → `app/utils/kwami-renderer.ts:272-273` `uColorA: {
value: new Color(options.colorA ?? '#7c5cff') }`. Both uniforms are white; the fragment shader
at :205 `mix(uColorA, uColorB, …)` and :211 `mix(uColorB, vec3(1.0), 0.35)` then produce a grey-
to-white ball with zero per-Kwami identity. The shipped bundle carries the broken string:
`grep` on `.output/public/_nuxt/CVImOd-d.js` finds `hsl(${n} 78% 62%)`. The reporter
understated the blast radius — this is not embed-only. The same function feeds
`KwamiCard.vue:23,56`, `pages/kwami/[mint].vue:10,42`, `pages/play/[mint].vue:18,108` and
`pages/mint.vue:62,323`. Every 3D avatar in the product is white except where a literal hex
default or a host-supplied `?colorA=` hex is used. The reporter's contrast with the SVG holds:
`server/api/kwami/[mint]/image.svg.get.ts:87` emits the same space-separated `hsl()` into SVG,
where the browser parses it correctly — I fetched the live SVG for the demo mint and it contains
`hsl(224 78% 62%)` used as `stop-color`. So the thumbnail is coloured and the live 3D embed
beside it is white, directly contradicting the stated intent at image.svg.get.ts:16-17 and :82.

### AI program builder generating Solana sub-programs

**17. The vault never invokes the extension — `register_extension` is inert bookkeeping**

`programs/kwami-vault/src/lib.rs:517` — CONFIRMED

Verified exhaustively. `register_extension` writes `ext.program`, `ext.hooks` and
`kwami.extension` (programs/kwami-vault/src/lib.rs:522-530) and nothing else in the program ever
reads them. `grep -rn 'on_session_start|on_win|on_expire|on_death|hook::' programs/` returns
**zero** hits outside the constant definitions themselves (state.rs:148-153). The complete CPI
inventory in lib.rs is: `invoke` system transfer (lib.rs:560),
`token_interface::transfer_checked` (lib.rs:579-591), `invoke_signed` vault payout (lib.rs:642),
and two more `transfer_checked` at lib.rs:495 and lib.rs:717 — no `Instruction{}` is ever
constructed, no discriminator is ever computed, `remaining_accounts` appears nowhere. The
accounts structs enumerated at lib.rs:750-1059 confirm it: StartSessionSol (822),
StartSessionUsdc (851), ClaimWin (891), ClaimWinAttested (965) and SettleSession (973) contain
no extension account. `start_session_sol` (lib.rs:201-250) runs ticket split → three transfers →
`init_session` → counter bump with no dispatch point at all. Off chain is the same: the only
`extension` references outside lib.rs are `findExtensionPda` (shared/solana/pda.ts:56) and
`registerExtensionIx`; no session-start or claim transaction builder adds an extension account.
Concretely: an owner who writes, deploys and registers a sub-program gets a Pubkey stored in
`Kwami::extension` and nothing else — no generated code can ever influence a ticket, a payout,
an expiry or a death. The requirement's operative clause, 'letting the owner modify the Kwami
Solana logic', is unimplemented.

### Owners publish so others can interact

**18. Publishing never reaches the index — a published Kwami stays unplayable**

`app/pages/kwami/[mint]/manage.vue:45` — CONFIRMED

CONFIRMED by reading the whole publish path. `act('publish')` builds `ownerActionIx(action,
mint, wallet.publicKey, program)` (app/pages/kwami/[mint]/manage.vue:30), sends it, and then
does nothing but `await refresh()` (manage.vue:45) — no POST to any endpoint. Grep across
server/, app/, shared/, scripts/ and supabase/ finds exactly two writes to `kwamis.state`:
`state: 'draft'` (server/api/kwami/draft.post.ts:84) and `state: 'minted'`
(server/api/kwami/confirm.post.ts:69). Nothing ever writes 'live' or `published_at` (the only
`state: 'live'` literal in the repo is the demo fixture, server/utils/demo.ts:59). There is no
indexer, cron, webhook or realtime subscriber: no
`getAccountInfo`/`getProgramAccounts`/`onLogs`/`onAccountChange` anywhere in server/ (the only
client-side account read is the treasury lookup at app/composables/usePlaySession.ts:284), and
no `.channel(`/`postgres_changes` in the repo. Every gate reads the stale mirror: arena listing
defaults to `state='live'` and filters `query.eq('state', q.state)`
(server/api/kwami/index.get.ts:6,38); the detail page gates the Challenge link on
`v-if="kwami.state === 'live'"` and otherwise renders the disabled 'Not accepting challengers'
button (app/pages/kwami/[mint].vue:104-118); `/api/session/start` hard-rejects with 409 'This
Kwami is not accepting challengers.' (server/api/session/start.post.ts:45-47). So after a
successful on-chain `publish` the Kwami is invisible in the arena and unplayable through the
product. A second, independent break from the same missing indexer: the ticket nonce is taken
from the mirror — `play.buyTicket(chosenAsset.value, kwami.value?.sessions_played ?? 0)`
(app/pages/play/[mint].vue:70) — while the program requires `nonce == kwami.sessions_played` on
chain (programs/kwami-vault/src/lib.rs:208,270), so even with the state fixed only the first
ticket could ever succeed. supabase/migrations/20260904000001_init.sql:58 and :90 attribute both
to 'the indexer', which does not exist. One nuance that does not save it: the RLS policy at
init.sql:249-250 would let an author flip `state` to 'live' with a raw PostgREST call using the
public anon key, but no product code does this and there is no UI for it.

**19. The on-chain secret commitment is never checked against the hash the server committed to**

`server/api/kwami/confirm.post.ts:34` — CONFIRMED

CONFIRMED. The server generates the salt and hash (server/api/kwami/draft.post.ts:67-68) and
returns `secretHash` to the browser (draft.post.ts:109), which passes it verbatim into
`createKwamiIx({ ..., secretHash, ... })` (app/composables/useMintKwami.ts:73-84,138) where it
is encoded as the first 32 bytes of instruction data (shared/solana/instructions.ts:64).
`confirm.post.ts` selects `secret_hash` at line 34 and never references it again — grep for
`secret_hash|secretHash` in server/ returns only draft.post.ts and that one dead select. Its
entire chain verification is `getTransaction` (confirm.post.ts:44) plus membership of the mint
and the program id in `staticAccountKeys` (confirm.post.ts:54-60): it never decodes the
`create_kwami` instruction data and never reads the `Kwami` PDA — no
`getAccountInfo`/`findKwamiPda` exists anywhere in server/. Consequence is worse than
'unclaimable'. An author running their own client substitutes `sha256(X)` for an X only they
know. `claim_win_reveal` requires only `resolution_mode == CommitReveal` and `hash(preimage) ==
kwami.secret_hash` (lib.rs:337-343), and `settle_win` only that the session is pending and
unexpired (lib.rs:698-699); the session constraints are `session.kwami == kwami` and
`session.player == player` (lib.rs:918-919). Combined with the missing owner/player check (gap
4), the author buys one ticket on their own Kwami and takes `payout_bps` of the pot other people
funded. The unclaimable-pot outcome the reporter described is the benign branch: the pre-image
handed to a genuine winner (server/api/session/[id]/transcript.post.ts:100) hashes to the DB's
value, so `require!(digest == kwami.secret_hash)` fails forever while the arena keeps
advertising the prize. draft.post.ts:39-42 explains the salt is server-side precisely to stop
this class of attack, and then the resulting commitment is never bound to the chain.

**20. Owner can drain a live pot mid-session: pause then withdraw**

`programs/kwami-vault/src/lib.rs:466` — CONFIRMED

CONFIRMED in the program source. `pause` requires only `kwami.state == KwamiState::Live`
(programs/kwami-vault/src/lib.rs:173) with the owner signature (`OwnerAction`, lib.rs:800-810) —
no open-session check, no cooldown, no timelock. `withdraw_sol` allows `matches!(kwami.state,
KwamiState::Minted | KwamiState::Paused | KwamiState::Dead | KwamiState::Cracked)`
(lib.rs:465-468) and will pay out up to `pot_lamports(&vault)` — the whole pot (lib.rs:471,
473-480); `withdraw_usdc` carries the identical allow-list (lib.rs:486-489) and pays out of
`vault_usdc` (lib.rs:494-507). Including `Paused` in that list while `pause` is unconditionally
owner-callable means Live -> pause -> withdraw_sol/withdraw_usdc -> publish empties the vault at
any moment, including while a paid session is running. That player's `settle_win` then computes
`apply_bps(pot_lamports(vault)? = 0, payout_bps) = 0` (lib.rs:706) and pays nothing, and the
USDC leg likewise (lib.rs:712). Nothing anywhere re-checks that the pot still matches the
advertised prize. The doc comment immediately above the instruction claims the opposite — 'a
live Kwami's pot belongs to the game, and letting an owner drain it mid-session would make every
ticket a scam' (lib.rs:459-462) — as does the user-facing copy at
app/pages/kwami/[mint]/manage.vue:100-105. One mitigating detail, which does not change the
verdict: no TypeScript withdraw instruction builder exists (grep for 'withdraw' in shared/ and
app/ finds only prose), so the owner has to craft the transaction themselves; the program is the
money authority and accepts it.

## Majors

Not release-blocking alone, but each is a real defect a user would hit.

### Solana NFT collection; immutable but transferable; buy and sell

**1. create_kwami accepts any pubkey as the 'mint' with zero constraints, and the server does not check either**

`programs/kwami-vault/src/lib.rs:794` — CONFIRMED

CONFIRMED. programs/kwami-vault/src/lib.rs:793-794 is `/// CHECK: the Metaplex Core asset minted
in the same transaction.` / `pub mint: UncheckedAccount<'info>` inside CreateKwami (:775-798) —
no decimals check, no supply check, no mint-authority check, no proof that `creator` holds the
token, and the account is not even required to be owned by the SPL Token program. The doc
comment at :102-106 asserts 'a Kwami account can never exist without a matching NFT'; nothing
enforces it. The server does not close the gap either: server/api/kwami/confirm.post.ts:54-60
verifies only that the mint pubkey appears in the transaction's static account keys and that the
Kwami program was invoked — it never fetches the mint account to check decimals or supply. Two
consequences: (a) a Kwami + vault can be created against an arbitrary 32-byte pubkey, listed in
the arena, and funded; (b) against a mint with uncapped supply, sync_owner's only holdership
test is `nft_token.amount == 1` (:185) with `nft_token.mint == kwami.mint` (:815), so multiple
token accounts can satisfy it and ownership — hence withdrawal rights under :1002 — becomes a
race. Separately confirmed: lib.rs:104, lib.rs:793 and programs/kwami-vault/src/state.rs:66 all
call the asset 'the Metaplex Core asset' while the client mints a legacy SPL token with Token
Metadata (useMintKwami.ts:116-123); the program's documented model and the actual mint flow are
different standards.

**2. kwamis.owner_wallet is written once at draft and never updated — the app's owner stays the seller forever**

`server/api/kwami/draft.post.ts:76` — CONFIRMED

CONFIRMED, with one line correction. `owner_wallet` is set at server/api/kwami/draft.post.ts:76
(`owner_wallet: body.authorWallet`) and never written again. Grepping `from('kwamis')` across
server/ and app/ gives every writer: draft.post.ts:72 (insert), draft.post.ts:105 (rollback
delete), confirm.post.ts:33 (select) and confirm.post.ts:68-69 — and :69 updates only `{ mint,
vault, state }`, not owner_wallet (the reporter cited :63; the update is at :67-70). No client-
side writer exists at all. The schema comment at supabase/migrations/20260904000001_init.sql:90
says the cached columns are refreshed 'by the indexer', but no indexer exists: `grep -rni
'indexer'` returns only four comments (init.sql:58, :90, :248 and
server/api/session/[id]/claimed.post.ts:12), and `find server -type f` lists no sync route or
scheduled task. Every owner UI keys off this column: app/pages/kwami/[mint]/manage.vue:20 and
app/pages/kwami/[mint].vue:11 both compute `isOwner` as `kwami.owner_wallet === wallet.address`,
sourced from kwamis_public (supabase/migrations/20260904000002_views.sql:43) via
server/api/kwami/[mint].get.ts:25. After a sale the buyer opening /kwami/<mint>/manage sees 'You
do not hold this Kwami.' (manage.vue:61-63) while the seller keeps the Publish and Pause
controls indefinitely.

**3. RLS grants the original author full-row UPDATE forever, so 'immutable' metadata is editable after the sale**

`supabase/migrations/20260904000001_init.sql:249` — CONFIRMED

CONFIRMED. supabase/migrations/20260904000001_init.sql:249-250 is `create policy
kwamis_update_own on public.kwamis for update using (auth.uid() = author_id) with check
(auth.uid() = author_id);` — row-level, whole-row, keyed on author_id, which never changes after
a sale (draft.post.ts:73 sets it once; confirm.post.ts:69 does not touch it). The comment at
:246-248 claiming 'only presentation columns are ever updated from the client' is unenforced:
`grep -rniE 'grant|revoke|column'` over supabase/migrations/*.sql finds no column-level GRANT,
and the only triggers (init.sql:310-315) just stamp updated_at (:302-308). The browser holds an
anon-key client with the user's own JWT (app/composables/useSupabase.ts:15). The on-chain URI is
frozen (useMintKwami.ts:128, isMutable=false at token-metadata.ts:99) but points at
server/api/kwami/[mint]/metadata.get.ts, which renders name, description, image, animation_url
and attributes live from kwamis_public at request time (lines 41-82, loader at :85-94), and
kwamis_public exposes exactly the author-writable columns (views.sql:31-46). So the author can
rename a sold Kwami, rewrite its tagline/persona/hints, change renderer, or overwrite
owner_wallet, and every wallet reading the immutable URI picks the change up within the 30s
cache (metadata.get.ts:36). This is precisely the failure the isMutable comment at token-
metadata.ts:58-61 claims to prevent.

### Fully web3 app with Phantom and MoonPay ramp onboarding

**4. MoonPay sign endpoint signs a purchase to any address the caller supplies, never the caller's own**

`server/api/moonpay/sign.post.ts:23` — CONFIRMED

CONFIRMED by reading server/api/moonpay/sign.post.ts. Line 23 is `await requireUser(event)` —
the returned AuthedUser (which carries `walletAddress`, built at server/utils/supabase.ts:65
from `user_metadata.wallet_address`) is discarded, unlike every other authed route:
session/start.post.ts:30, kwami/confirm.post.ts:24, builder/generate.post.ts:28,
session/[id]/reply.post.ts:21 all bind to `user.id` (e.g. confirm.post.ts:41 `if
(draft.author_id !== user.id) throw ... 'Not your draft.'`). Here `body.walletAddress` is
checked only for base58 shape (line 27 `isValidAddress`) and dropped into the signed query at
line 43 `walletAddress: body.walletAddress`. There is no `wallet_identities` lookup in the file
(that table is only queried in server/utils/wallet-session.ts:35-40) and no comparison to the
session address. So any authenticated account — an email signup costs nothing — POSTs an
arbitrary address and gets back an HMAC-signed widget URL (line 55) on the site's own MoonPay
key that funds that address. The docblock at lines 18-21 ('the wallet address has to come from
the authenticated session's own request rather than from a link') and the UI copy at
app/pages/onramp.vue:52 ('the destination address is signed against your session') both assert a
binding the code does not perform. Downgraded from blocker to major: the money lost is a phished
third party's card payment, not a Kwami user's escrowed funds, and it requires an account plus
MoonPay's own KYC on the buyer — but it is a real signing oracle running on Kwami's merchant
credentials.

**5. Site Permissions-Policy denies camera to all origins and does not delegate payment to MoonPay's origin**

`server/middleware/security-headers.ts:33` — CONFIRMED

CONFIRMED. server/middleware/security-headers.ts:33-37 sets `Permissions-Policy:
microphone=(self), camera=(), geolocation=(), payment=(self), interest-cohort=()`
unconditionally on every non-embed response, including /onramp — the only branch above it (lines
16-23) varies CSP/X-Frame-Options for /embed, never the permissions policy, and
nuxt.config.ts:70-73 adds no per-route headers. app/pages/onramp.vue:100 then frames MoonPay
cross-origin with `allow="accelerometer; autoplay; camera; gyroscope; payment"`. An iframe's
permissions are the intersection of the parent policy and the `allow` attribute, so `camera=()`
(empty allowlist = no origin, including self) denies getUserMedia video inside the widget, and
`payment=(self)` does not delegate to buy.moonpay.com / buy-sandbox.moonpay.com (that needs the
origin listed explicitly). MoonPay's in-widget identity verification (document + selfie capture)
and Payment Request-based Apple/Google Pay are therefore unavailable to a first-time buyer,
while the `allow` attribute reads as though they were enabled.

**6. 'It landed.' fires off a zero baseline and off any pre-existing USDC, confirming nothing about the purchase**

`app/pages/onramp/done.vue:19` — CONFIRMED

CONFIRMED. app/pages/onramp/done.vue:16 initialises `startingLamports = 0n` and line 19 re-reads
it inside the page's own `onMounted` from `wallet.lamports`. The wallet store is only populated
by `wallet.autoConnect()` in app/app.vue:11-13, which is (i) the root component, so its mounted
hook runs after the page's, and (ii) fully async (waitForPhantom ->
`p.connect({onlyIfTrusted:true})` -> `refreshBalances()`, app/stores/wallet.ts:82-98). MoonPay's
`redirectURL` (sign.post.ts:46) is a full navigation, so the Pinia store is reconstructed with
`lamports = ref(0n)` / `usdcBaseUnits = ref(0n)` (wallet.ts:32-33). The baseline is therefore 0n
in practice, and the poll condition at done.vue:23 — `wallet.lamports > startingLamports.value
|| wallet.usdcBaseUnits > 0n` — is satisfied by the user's pre-existing balance on the first
successful `refreshBalances()` (wallet.ts:216-227 sets lamports from `getBalance` and USDC from
the parsed token account). The right-hand disjunct is unconditionally true for anyone already
holding any USDC regardless of baseline. Nothing in the page references a MoonPay transaction
id, so a declined or abandoned purchase still renders 'It landed.' plus a balance
(done.vue:37-41) about six seconds after the redirect.

**7. No server-side record, webhook or correlation id for any on-ramp**

`server/api/moonpay/sign.post.ts:40` — CONFIRMED

CONFIRMED. `server/api/moonpay/` contains exactly one file, sign.post.ts — no webhook route
exists anywhere in `server/` (full route listing:
server/api/{auth,builder,docs,kwami,moonpay,session}). A case-insensitive grep for
`moonpay|onramp|on-ramp` across the repo (excluding node_modules/coverage) hits only
nuxt.config.ts, .env.example, README.md, docs/{index,architecture,api,setup}.md,
app/pages/onramp.vue, app/pages/onramp/done.vue, app/stores/wallet.ts (a comment at line 24),
app/components/WalletButton.vue and server/api/moonpay/sign.post.ts — nothing in supabase/,
shared/ or programs/. The signed params at sign.post.ts:40-49 are apiKey, currencyCode,
walletAddress, baseCurrencyCode, redirectURL, lockAmount (+ optional baseCurrencyAmount): no
`externalTransactionId` or `externalCustomerId`, so even if a callback existed a completed
purchase could not be tied back to the requesting user. The server never learns whether
onboarding funded anyone — no reconciliation row, no support trail, no way to gate play on a
pending top-up. The only 'confirmation' in the product is the client-side balance poll above.

### Interaction paid in SOL or USDC

**8. USDC protocol fee and author royalty can be redirected back to the payer**

`programs/kwami-vault/src/lib.rs:880` — CONFIRMED

programs/kwami-vault/src/lib.rs:880-883: `rust #[account(mut, token::mint = usdc_mint)] pub
treasury_usdc: InterfaceAccount<'info, TokenAccount>, #[account(mut, token::mint = usdc_mint)]
pub author_usdc: InterfaceAccount<'info, TokenAccount>, ` No `token::authority`, no
`associated_token::authority`, no ATA derivation. The asymmetry with the SOL leg is stark and in
the same file: `StartSessionSol` pins both recipients by address — `#[account(mut, address =
config.treasury)] pub treasury` (lib.rs:840-841) and `#[account(mut, address = kwami.author)]
pub author` (lib.rs:843-844). The client happens to derive the correct ATAs
(shared/solana/instructions.ts:164-169) but the program does not require it, and the client is
not the attacker's code path. So `split.to_protocol` and `split.to_author` (lib.rs:285-302) can
be routed to two token accounts the payer owns. `vault_usdc` is the one leg that is safe —
`associated_token::authority = vault` (lib.rs:877) pins it to the vault PDA — so exactly
`split.to_vault` leaves the payer's wallet. Per math.rs:30-38 the misdirected amount is
`apply_bps(ticket, config.fee_bps)`, capped by `MAX_FEE_BPS = 500` (state.rs:15), i.e. up to 5%
of every USDC ticket, split 60/40 between treasury and author (`AUTHOR_ROYALTY_BPS_OF_FEE =
4_000`, state.rs:18). Nothing on chain records the shortfall — `Session.ticket_amount`
(lib.rs:610) stores the gross price regardless.

**9. Server trusts the client's declared asset, so the recorded currency and amount can be falsified**

`server/api/session/start.post.ts:78` — CONFIRMED

`asset: z.enum(['SOL', 'USDC'])` (server/api/session/start.post.ts:14) arrives from the browser
— app/composables/usePlaySession.ts:145 posts `{ mint, signature, nonce, asset }` — and is never
reconciled with the transaction. It is the sole selector for the recorded amount: `ts const
ticketAmount =   body.asset === 'SOL' ? BigInt(kwami.ticket_price_lamports) :
BigInt(kwami.ticket_price_usdc) ` (start.post.ts:78-79), written straight into `asset` and
`ticket_amount` (start.post.ts:90-91). Since the handler never decodes the instruction at all
(see gap 2), a SOL payment declared `'USDC'` records the USDC price, and vice versa. Those two
columns are what the player's receipt reads: the `my_sessions` view selects `s.asset`
(supabase/migrations/20260904000002_views.sql:116) and `s.ticket_amount` (:117), and
server/api/kwami/[mint].get.ts:33 surfaces them on the public Kwami page. Small correction to
the report: the view is named `my_sessions` (views.sql:108), not `session_history`; the line
numbers are right.

**10. Recorded ticket amount comes from the database, never from the chain**

`server/api/session/start.post.ts:78` — CONFIRMED

Even with an honest `asset`, the figure is a DB lookup: start.post.ts:37-41 selects
`ticket_price_lamports, ticket_price_usdc` from `kwamis`, and start.post.ts:78-79 turns one of
them into `ticket_amount`. No `getAccountInfo` on the `Kwami` PDA, no balance-delta read from
`tx.meta` — the on-chain price at lib.rs:271 (`kwami.ticket_price_lamports`) / lib.rs:272
(`kwami.ticket_price_usdc`) is never consulted. Those DB prices are the author's unverified
draft payload: server/api/kwami/draft.post.ts:22-23 accepts
`ticketPriceLamports`/`ticketPriceUsdc` as `z.coerce.bigint().min(0n)` and line 87-88 inserts
them verbatim. The confirm step reads the chain but not the prices —
server/api/kwami/confirm.post.ts:44-60 fetches the transaction and checks the mint and program
are present, then :67-70 updates only `mint`, `vault`, `state`. Nothing ever compares the
advertised price to what `create_kwami` stored (lib.rs:134-135). Harm is record-integrity and
misadvertising rather than direct loss — the chain always charges its own price — but the arena,
the play page's 'Pay X and start' button (app/pages/play/[mint].vue:175-182) and every session
row can quote a number the program does not charge.

**11. USDC-only Kwamis are unpayable from the UI — the button sends a SOL instruction the program rejects**

`app/pages/play/[mint].vue:145` — CONFIRMED

The asset picker is gated on _both_ prices being non-zero: `v-if="kwami.ticket_price_lamports >
0 && kwami.ticket_price_usdc > 0"` (app/pages/play/[mint].vue:145). `chosenAsset` is
`ref<Asset>('SOL')` (play/[mint].vue:19) and I found no watcher or initialiser that adjusts it
to the Kwami's actual prices anywhere in the file. USDC-only is a first-class option on the
mint form: `ticketAsset: 'SOL' | 'USDC' | 'both'` (app/pages/mint.vue:27) and `ticketPreview`
computes `const lamports = form.ticketAsset === 'USDC' ? 0n : ...` (mint.vue:46-47), with
`canMint` satisfied by either price being > 0 (mint.vue:53-61). For such a Kwami the play page
renders the fallback button, whose label is `formatSol(kwami.ticket_price_lamports)` = `'0.00
SOL'` (app/utils/format.ts:12-16 gives 2 digits when `sol === 0`), and `onStart` calls
`play.buyTicket(chosenAsset.value, ...)` (play/[mint].vue:70) → the `asset === 'SOL'` branch →
`startSessionSolIx` (app/composables/usePlaySession.ts:107-116). The program then fails at
`require!(kwami.ticket_price_lamports > 0, KwamiError::AssetNotAccepted)` (programs/kwami-
vault/src/lib.rs:207), surfacing only as `describeWalletError(e)` (usePlaySession.ts:157). The
USDC half of 'paid in SOL or USDC' is unreachable for USDC-only Kwamis.

### Three minutes of voice to discover the secret

**12. Nothing ever expires a session, in the database or on chain**

`shared/solana/instructions.ts:251` — CONFIRMED

CONFIRMED. I grepped every write path. Database: the only UPDATEs to `game_sessions` are `{
outcome: 'won', matched_text, match_score }` (transcript.post.ts:86) and `{ tx_claim }`
(claimed.post.ts:36). The only INSERT sets `outcome: 'pending'` (start.post.ts:94). The enum has
'lost', 'expired' and 'aborted' (migration line 135); no code writes any of them. On chain:
`settle_session` is the instruction that sets `SessionOutcome::Expired` (lib.rs:412-423,
assignment at 417) and it is correctly guarded by `require!(now >= session.expires_at)` at line 416. Its client encoder `settleSessionIx` (shared/solana/instructions.ts:251) has exactly one
caller in the repo: tests/unit/instructions.test.ts:269. Nothing in app/, server/ or scripts/
calls it. No sweeper exists: no `server/plugins/`, no Nitro tasks in nuxt.config.ts, no
Supabase function or trigger, and .github/workflows contains only ci.yml, release.yml and
branch-promotion.yml with no `schedule:` block. The partial index built for exactly this query —
`create index game_sessions_open_idx on public.game_sessions (expires_at) where outcome =
'pending'` (migration line 164) — has no consumer. Consequences: every unwon session stays
'pending' forever, which holds the `outcome !== 'pending'` gates open (reply.post.ts:35, voice-
token.post.ts:36), leaves session-account rent unreclaimed on chain (the stated purpose of
settle_session, lib.rs:408-411), and makes the `outcome` column in the my_sessions view
(migration 20260904000002_views.sql:120) and any win-rate statistic derived from it wrong.

**13. LiveKit token not scoped to remaining session time; endpoint unreachable; voice stop is client-side only**

`server/api/session/[id]/voice-token.post.ts:44` — CONFIRMED

CONFIRMED on all three sub-claims (line 44, not 43). TTL: voice-token.post.ts:44-48 calls
`createLiveKitToken({ room, identity, name })` with no `ttlSeconds`, so
server/utils/livekit.ts:56 applies `exp: now + (grant.ttlSeconds ?? 300)` — a flat five minutes
from issuance regardless of `expires_at`, which the handler selected at line 29 and never used.
Re-requesting is unbounded because the handler has no clock check (gap 1). Room lifetime:
livekit.ts is 78 lines and contains only `createLiveKitToken` and `isLiveKitConfigured`; there
is no RoomService, no `max_duration`, no `empty_timeout` and no participant removal anywhere in
the repo. The file's own note at lines 30-35 says the TTL 'only has to survive long enough to
open the connection, and LiveKit keeps the session alive after that' — so nothing terminates the
room at the deadline. The agent that would enforce it is explicitly out of this repository
(livekit.ts:10-14). Dead endpoint: `grep -rn voice-token app/ server/ shared/ tests/` matches
only the handler file itself. `livekit-client` is declared at package.json:48 and imported
nowhere in app/, server/, shared/ or tests/. The only reference to the livekit util outside the
handler is tests/unit/livekit.test.ts. So the working voice path today is the browser Web
Speech API (app/composables/useSpeech.ts, wired at app/pages/play/[mint].vue:27-40), and its
only stop at the deadline is the client-side watcher at app/pages/play/[mint].vue:74-83 reacting
to `phase === 'expired'`, which is set by the local countdown at
app/composables/usePlaySession.ts:68-70. Nothing server-side stops the microphone or the turn
stream.

### 80% of the pot on a win; otherwise the ticket is forfeit and the pot grows

**14. The claim transaction must also confirm before expires_at, so a late win forfeits the whole pot**

`programs/kwami-vault/src/lib.rs:699` — CONFIRMED

CONFIRMED. settle_win enforces `require!(now < session.expires_at, KwamiError::SessionExpired)`
at programs/kwami-vault/src/lib.rs:699, and the doc comment at :684-687 states it is deliberate
('the proof establishes that the player knew the secret, not that they were still inside the
window'). But the win is decided off chain and the claim is a separate, later transaction:
app/composables/usePlaySession.ts:178-184 only sets `phase = 'won'` and stores the claim
material; the transaction is built, wallet-signed and confirmed in claimWin() at :212-280, which
is fired manually by the 'Claim the pot' button at app/pages/play/[mint].vue:240-246. There is
no auto-claim. Worse, the expiry watcher at usePlaySession.ts:68-70 only rewrites `phase` when
it is 'live', so once phase is 'won' the claim button stays enabled past the deadline and the
transaction reverts with SessionExpired — the UI at play/[mint].vue:233-238 is still showing the
player their prize figure while the claim can no longer succeed. The codebase contradicts its
own window: server/utils/attest.ts:13 sets ATTESTATION_TTL_SECS = 300, longer than
DEFAULT_SESSION_DURATION 180 (state.rs:13) and ten times MIN_SESSION_DURATION 30 (state.rs:11),
a TTL that :699 makes unreachable. transcript.post.ts:65-70 goes out of its way to honour a
late-arriving utterance and the chain then discards exactly that case. Narrow in that it only
bites near the deadline, but the loss when it bites is the entire pot.

**15. Claim reverts entirely when the winner's USDC ATA (or the vault's) does not exist**

`app/composables/usePlaySession.ts:229` — CONFIRMED

CONFIRMED on both legs. app/composables/usePlaySession.ts:221-222 sets `usdcMint` whenever
`kwami.ticket_price_usdc > 0`, and shared/solana/instructions.ts:240-242 then places
`deriveAssociatedTokenAddress(usdc, args.player)` in the player_usdc slot and
`deriveAssociatedTokenAddress(usdc, vault)` in vault_usdc — real derived addresses, never the
program-id sentinel that Anchor reads as None (the `none` fallback at instructions.ts:230 is
used only when usdcMint is undefined). Those slots are `Option<InterfaceAccount<'info,
TokenAccount>>` at programs/kwami-vault/src/lib.rs:929 and :931 with `#[account(mut)]` and no
`init_if_needed`, so a present-but-uninitialised account fails Anchor deserialization and the
whole instruction reverts — taking the SOL leg with it, since settle_win pays SOL at :706 inside
the same instruction. No ATA-creation instruction is added to the claim: grepping app/ and
shared/ for `createAssociatedTokenAccountInstruction` returns only
app/composables/useMintKwami.ts:117 (the mint path), and the claim builds `instructions` from
just the claim ix (+ ed25519) at usePlaySession.ts:224-257. The vault side is the same defect
from the other direction: vault_usdc is created lazily by `init_if_needed` only in
StartSessionUsdc (lib.rs:874-879), so on a dual-priced Kwami whose pot was funded entirely by
SOL tickets the vault ATA does not exist and every claim reverts until someone happens to buy a
USDC ticket.

**16. Owner can pause then withdraw in one transaction and empty the pot before a claim lands**

`programs/kwami-vault/src/lib.rs:466` — CONFIRMED

CONFIRMED. `pause` is owner-gated (programs/kwami-vault/src/lib.rs:171-176 taking
Context<OwnerAction>, whose constraint is `kwami.owner == owner.key()` at :806) and flips a Live
Kwami to Paused with the comment 'Sessions already running still settle normally' (:170).
withdraw_sol's allow-list at :465-468 is `matches!(kwami.state, Minted | Paused | Dead |
Cracked)` — Paused is in it — and withdraw_usdc repeats it verbatim at :486-489. The comment
immediately above at :460-462 claims withdrawals are blocked because 'letting an owner drain it
mid-session would make every ticket a scam'; the code contradicts its own comment. WithdrawSol
(:997-1012) and WithdrawUsdc (:1016-1033) are owner-signed with no session or state-transition
guard, so pause + withdraw_sol + withdraw_usdc compose in a single transaction — later
instructions observe the earlier instruction's write to kwami.state. The subsequent claim still
succeeds (settle_win never reads kwami.state) but pays payout_bps of a vault holding only the
rent floor. Directly defeats the 'the Kwami account keeps growing' half of the requirement for
every challenger who already paid in.

**17. Quoted prize is unbacked — and the real gap is far larger than the rent floor the report names**

`programs/kwami-vault/src/lib.rs:655` — CONFIRMED

CONFIRMED, and upgraded from minor because the surrounding claim ('no UI reflects it… A winner
is quoted a number the program will not pay') turns out to be much worse than the rent floor.
The floor itself is real: pot_lamports subtracts
`Rent::get()?.minimum_balance(vault.data_len())` (programs/kwami-vault/src/lib.rs:655-658) and
the vault is a data-less UncheckedAccount (:896-902), so minimum_balance(0) = (128 + 0) * 3480 *
2 = 890,880 lamports is permanently unpayable — but that is ~0.00089 SOL and defensible per the
comment at :650-654. The larger finding is what feeds the quote.
app/pages/play/[mint].vue:142-144 and server/api/kwami/[mint]/metadata.get.ts:39 both compute
the prize as `value_cents * payout_bps / 10000`, and value_cents comes from
`coalesce(v.value_cents, 0)` over the valuations table
(supabase/migrations/20260904000002_views.sql:56). Nothing in the repository ever inserts a
valuation or calls record_valuation: grepping `valuations|record_valuation|recordValuation`
across server/, scripts/, app/ and shared/ returns zero hits, so value_cents is 0 for every real
Kwami and the advertised prize is $0.00 — while record_valuation (lib.rs:437-459) is the only
thing that could set it and is likewise never invoked. The parallel figure
app/pages/kwami/[mint].vue:73 renders, prize_lamports = balance_lamports * payout_bps / 10000
(views.sql:67), is equally dead: kwamis.balance_lamports defaults to 0 at
20260904000001_init.sql:91 and has no writer outside server/utils/demo.ts. Both quoted prizes
are disconnected from `vault.lamports()`, which is the only number settle_win:706 actually pays
from.

### Death at -99% of peak value, or under one dollar

**18. No price oracle exists: the USD valuation and therefore both death rules are an unverified scalar from one key**

`programs/kwami-vault/src/lib.rs:988` — CONFIRMED

CONFIRMED, downgraded from blocker (same root cause as finding 1 — with no caller, this never
actually fires). `record_valuation(ctx, value_cents: u64)` takes the vault's dollar value as a
bare instruction argument (lib.rs:434) and the account context's only guard is
`#[account(address = config.oracle @ KwamiError::StalePrice)] pub oracle: Signer<'info>`
(lib.rs:993-994) — no price account, no staleness window, no confidence bound, no per-push
movement cap, no timestamp stored on `Kwami` (state.rs:65-93 has no valuation timestamp field).
Case-insensitive grep for `pyth|switchboard|coingecko|sol_usd|solUsd` over the repo excluding
node_modules returns only server/utils/demo.ts:43 (`const SOL_USD = 150`, a fixture used at
demo.ts:50), server/utils/solana.ts:62 `toCents(lamports, usdcBaseUnits, solUsd)` which grep
shows has zero callers, shared/game/economy.ts:78/:139 (`solUsd` parameters), and the `sol_usd`
column at supabase/migrations/20260904000001_init.sql:186 / views.sql:15. Nothing in the
codebase obtains a SOL price. Note `StalePrice` is reused as the wrong-signer error, which is
misleading — nothing checks staleness.

**19. Death is never re-evaluated on the events that move the pot: settle_win and start_session ignore the death rules**

`programs/kwami-vault/src/lib.rs:689` — CONFIRMED

CONFIRMED, downgraded from blocker (with a working oracle cadence this becomes a latency window
rather than a permanent failure; it is finding 1 that makes it permanent). `settle_win`
(lib.rs:689-746) reads the pot at lib.rs:706 (`apply_bps(pot_lamports(vault)?, payout_bps)`) and
the USDC leg at lib.rs:712, pays both out, sets `session.outcome = Won` (lib.rs:733) and
increments `sessions_won` (lib.rs:736) — it never reads `high_water_mark_cents` and never calls
`is_dust_dead`/`is_drawdown_dead` (math.rs:43-52); grep confirms those two functions are
referenced only at the `use` at lib.rs:48 and inside `record_valuation` at lib.rs:445.
Symmetrically `start_session_sol` moves `split.to_vault` into the vault at lib.rs:216-221 and
`start_session_usdc` at lib.rs:276-284, and neither raises the high-water mark.
`assert_playable` (lib.rs:542-549) only pattern-matches `kwami.state`, so a vault drained to
0.8% of its peak by successive 80% payouts (`DEFAULT_PAYOUT_BPS = 8_000`, state.rs:6) is still
`Live` and still sells tickets. The program has the balance in hand at settlement time and
chooses not to use it.

**20. Dead unlocks unrestricted owner withdrawal, and the single oracle key that can declare death is the same key held server-side**

`programs/kwami-vault/src/lib.rs:463` — CONFIRMED

CONFIRMED. `withdraw_sol` allows any amount up to `pot_lamports(&vault)` whenever
`matches!(kwami.state, Minted | Paused | Dead | Cracked)` (lib.rs:465-471), and `withdraw_usdc`
mirrors it (lib.rs:486-490); authority is only `kwami.owner == owner.key()` (lib.rs:1002). The
one field that can set `Dead` is `config.oracle` (lib.rs:993 → lib.rs:446), and the very same
`Config::oracle` is the win-attestation key checked at lib.rs:387 via `verify_oracle_signature`,
held server-side by `oracleKeypair()` at server/utils/solana.ts:30-36 reading
`config.oracleSecretKey` (nuxt.config.ts:27) and used at server/utils/attest.ts:62. Killing an
already-funded Kwami takes one oracle-signed push of a low `value_cents`; the owner can then
drain a pot built from challengers' tickets. That directly contradicts the in-code assurance at
lib.rs:430-433 ("a faulty oracle can kill a Kwami but not steal from one") and
docs/security.md:23 — the oracle cannot move funds itself, but it can unlock the owner's ability
to. Partially mitigating: shared/solana/instructions.ts ships no `withdrawSol`/`withdrawUsdc`
builder (grep for `withdraw` in app/ and shared/ returns only prose at
app/pages/kwami/[mint]/manage.vue:102), so this is reachable only by hand-built transaction, not
through the app.

**21. Off-chain death enforcement is inert: nothing writes state='dead', died_at, high_water_mark_cents, or a valuations row**

`server/api/session/start.post.ts:45` — CONFIRMED

CONFIRMED. server/api/session/start.post.ts:45 does gate on `kwami.state !== 'live'`, but the
only writes to `kwamis.state` in the whole server are server/api/kwami/draft.post.ts:84 (`state:
'draft'`) and server/api/kwami/confirm.post.ts:69 (`.update({ mint, vault, state: 'minted' })`).
`died_at` (init.sql:100) is never written — grep for `died_at` outside node_modules hits only
init.sql:100, views.sql:55 and shared/types/api.ts:43. `public.valuations` (init.sql:182-189,
commented "the death-rule audit trail" at :179) has no INSERT anywhere: grep for `valuations`
returns only the DDL, its index (:191), its RLS lines (:228, :270) and the two view definitions
(views.sql:11-18, :78). I also checked for a database-side path — the only triggers in the
migrations are `on_auth_user_created` (init.sql:298) and three `touch_updated_at` triggers
(init.sql:310-315); there is no death trigger. `balance_lamports`, `balance_usdc`,
`high_water_mark_cents`, `sessions_played`, `sessions_won` are marked "Cached from chain by the
indexer" (init.sql:90) and no indexer exists — grep for
`onLogs|getProgramAccounts|helius|webhook|indexer` finds only the prose comments at init.sql:58,
init.sql:248 and server/api/session/[id]/claimed.post.ts:12. Consequence, from views.sql:56 and
:61-64: `value_cents` is `coalesce(v.value_cents, 0)` = 0 for every real row and `vitality` is
1.0 because `high_water_mark_cents = 0`; the leaderboard's "fallen" tab
(app/pages/leaderboard.vue:12) is permanently empty outside demo mode, and a drained Kwami keeps
passing the `state !== 'live'` check.

### The 3D model integrates into any third-party app

**22. Embed injects the whole wallet/Solana/Supabase stack into the host page and polls for Phantom inside the stranger's iframe**

`app/app.vue:12` — CONFIRMED

CONFIRMED, and I reproduced the byte counts independently. `app/app.vue:9` calls
`useWalletStore()` and :11-13 `onMounted(() => { void wallet.autoConnect() })`. app.vue is the
root shell for every route including `/embed/**` (the embed only swaps the layout,
`app/layouts/embed.vue`, not the root). `app/stores/wallet.ts:82` `autoConnect()` →
`waitForPhantom()` (`app/utils/phantom.ts:89-111`), which registers a `phantom#initialized`
listener and a `setInterval(…, 100)` poll for 3 s inside the host's iframe, then calls
`p.connect({ onlyIfTrusted: true })` at wallet.ts:91. The embed has no wallet UI and never reads
a wallet value. Measured from the served page (built server on :3117, demo mint `Kw1Ora…`): 20
distinct `/_nuxt/*.js` chunks, 1,261,417 bytes raw / 361,213 bytes gzipped. `D-MSm3Pj.js`
(327,294 raw) greps positive for `isPhantom`, `autoConnect` and `supabase`; `zLAMzk7t.js`
(294,476 raw) contains 79 occurrences of `Transaction`, plus `PublicKey`, `Connection`,
`LAMPORTS_PER_SOL`, `Keypair`, `@solana` — i.e. ~600 KB raw of wallet/chain code the embed never
uses. `app/plugins/auth.client.ts` additionally runs `useAuthStore().init()` on the same route.
This directly contradicts the renderer's own stated rationale at `app/utils/kwami-
renderer.ts:6-8` ("this build also has to run inside a third-party embed, where every extra
kilobyte is someone else's page weight").

**23. "pot" means two different dollar amounts on the two surfaces a marketplace renders side by side**

`app/pages/embed/[mint].vue:61` — CONFIRMED

CONFIRMED against the running build. Embed overlay: `app/pages/embed/[mint].vue:61` `{{
formatCents(kwami.value_cents * (kwami.payout_bps / 10000)) }} pot`. NFT image:
`server/api/kwami/[mint]/image.svg.get.ts:27` `const potUsd = kwami.value_cents / 100`, rendered
at :71 as `$${potUsd.toFixed(2)} pot`. Metadata agrees with the image, not the embed:
`server/api/kwami/[mint]/metadata.get.ts:70` `{ trait_type: 'Pot (USD)', value:
Number((kwami.value_cents / 100).toFixed(2)) }`, and :47-48 uses both figures in one
description. Live for demo mint `Kw1Ora…`: metadata returned `"Pot (USD)","value":1260` and `a
pot worth $1260.00 … take 80% — currently $1008.00`; the SVG rendered `$1260.00 pot`. The embed
computes 1260 × 0.80 = $1,008.00 and labels it `pot`. The embed is the sole outlier in the
codebase: everywhere else the payout share is labelled "Prize"
(`app/components/KwamiCard.vue:73`) or "If you win" (`app/pages/kwami/[mint].vue:68`), and "pot"
consistently means the whole vault (`app/pages/play/[mint].vue:169` "{{ payout_bps/100 }}% of
the pot"). Display-only — settlement is untouched — but it is a money figure on the exact third-
party surface this requirement is about, understated by 20%.

**24. No WebGL capability probe, no try/catch, no still-image fallback anywhere in the embed path**

`app/utils/kwami-renderer.ts:248` — CONFIRMED

CONFIRMED, with two sub-claims refuted (see refuted list). `app/utils/kwami-renderer.ts:248`
constructs `new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-
performance' })` unguarded, and `app/components/KwamiAvatar.vue:22-31` calls
`mountKwami(canvas.value, …)` directly inside `onMounted` with no try/catch.
`node_modules/three/src/renderers/WebGLRenderer.js:400` throws `Error creating WebGL context.`
and :103 throws `WebGL 1 is not supported since r163.` for WebGL1-only devices. Grepping `app/
shared/ server/ public/` for `webgl|getContext|fallback|onErrorCaptured|errorHandler|prefers-
reduced-motion` returns only the renderer's own `WebGLRenderer` import (:22, :248), one
unrelated comment in `server/api/session/[id]/voice-token.post.ts:10`, and a CSS `prefers-
reduced-motion` block at `app/assets/css/main.css:322` that only zeroes CSS animation/transition
durations — it never reaches the rAF loop at kwami-renderer.ts:328-348. There is no
`app/error.vue`, no `NuxtErrorBoundary`, and the only plugin is `app/plugins/auth.client.ts`.
`server/api/kwami/[mint]/image.svg.get.ts` already produces exactly the still frame that would
serve as a poster, and nothing wires it in. Concretely: on a device or context without WebGL2,
`animation_url` (`metadata.get.ts:57`, `?chrome=off`) renders a completely empty transparent
frame — with `chrome=off` there is not even the name/pot overlay to fall back on. One
correction to the reporter's framing: the template renders before `onMounted`, so with chrome ON
the host still sees the name/pot/Challenge overlay; only the canvas is blank. And `dispose()` at
:371-380 genuinely never calls `renderer.forceContextLoss()` — a real but minor leak on unmount.

**25. No 3D model artifact is ever produced — "integration" is limited to web surfaces that can host an iframe**

`server/api/kwami/[mint]/metadata.get.ts:75` — CONFIRMED

CONFIRMED as fact, though it is an explicit design choice rather than an oversight. Grepping the
whole repo (excluding node_modules/.output/.nuxt/coverage) for `gltf|.glb|usdz|model/` matches
only two files, both of which argue _against_ emitting a model:
`server/api/kwami/[mint]/metadata.get.ts:13-17` ("pointing it at `/embed/<mint>` rather than a
`.glb` file means the Kwami shown in a wallet is the live one") and `docs/protocol.md:74`. No
encoder, exporter, or model asset exists. `metadata.get.ts:74-79` declares
`properties.category: 'html'` with exactly two files — `image/svg+xml` and `text/html` — and no
`model/gltf-binary` entry. `shared/solana/token-metadata.ts:138` documents `animation_url` as "A
live URL rather than a model file". Verified live: the metadata response for `Kw1Ora…` returns
`"category":"html"` with those two files only. `package.json:4` is `"private": true` with no
`exports` field, so `app/utils/kwami-renderer.ts` is not consumable as a package, and
`docs/embed.md:69` ("For a native app or a custom canvas, `app/utils/kwami-renderer.ts` is self-
contained") is not backed by any publish path — it is also browser-only
(`window.devicePixelRatio` at :256, `requestAnimationFrame` at :347,
`window.addEventListener('resize')` at :354). Consequence for the requirement as worded: a
Kwami's 3D model integrates into any third-party _web page_; a native app, game engine, or AR/VR
client has nothing to import.

### AI program builder generating Solana sub-programs

**26. None of the four one-click example games in the builder UI is expressible under the ABI it prompts against**

`app/pages/builder/[mint].vue:19` — CONFIRMED

Checked each against the vault. (1) 'Escalating ticket' (app/pages/builder/[mint].vue:21-25)
needs the ticket price to change; `ticket_price_lamports`/`ticket_price_usdc` are written once
at lib.rs:134-135 in `create_kwami` and read directly at lib.rs:207,210 and 269,272 — grep for
`ticket_price` over lib.rs returns no other assignment, so there is no setter and the hook is
handed `kwami (readonly)` anyway (extension-abi.ts:33). (2) 'Tenth loser jackpot — take 5% of
every losing ticket into a side pot' ([mint].vue:27-31): the ticket splits three ways inside
`start_session_sol` (lib.rs:216-233) with no hook, and EXTENSION_RULES[0] (extension-abi.ts:122)
forbids touching the vault. (3) 'Holder gate — everyone else is rejected before paying'
([mint].vue:33-37) contradicts onSessionStart's own definition, 'Fires **after** a ticket is
paid and the session account exists' (extension-abi.ts:32) — and even a failing CPI could not
reject, since no CPI is made. (4) 'Inheritance — whatever is left in its pot is split evenly'
([mint].vue:39-43) requires vault-PDA authority, explicitly forbidden by the same rule.
docs/builder.md:7 repeats all five. So the system prompt (generate.post.ts:69-80) ships 'hard
rules, all of which are non-negotiable' alongside a one-click menu of briefs that violate them,
and the model is asked to satisfy both.

**27. `code_hash` is caller-supplied and never derived from the deployed binary, contradicting the on-chain doc comment**

`programs/kwami-vault/src/lib.rs:525` — CONFIRMED

state.rs:139-141 states the field is 'SHA-256 of the deployed program binary at registration
time. Anyone can re-derive it from the ledger to prove the code was never swapped';
docs/builder.md:55 repeats it. The implementation takes it as an instruction argument — `pub fn
register_extension(ctx: Context<RegisterExtension>, code_hash: [u8; 32], hooks: u8)`
(lib.rs:517) — and assigns it straight through: `ext.code_hash = code_hash;` (lib.rs:525).
`extension_program` is an `UncheckedAccount` with the single constraint `#[account(executable)]`
(lib.rs:1053-1055); its `data` is never read, and `hash(...)` (imported at lib.rs:33) is used
only for the secret pre-image check. Any 32 bytes are accepted. The client side never computes
one either: `registerExtensionIx(mint, owner, extensionProgram, codeHash: string, hooks)` just
hex-decodes whatever it is given (shared/solana/instructions.ts:288-301), and `grep -rn
'code_hash' server/ app/` returns nothing. The published integrity guarantee is unbacked: a
third party reading `Extension::code_hash` off the ledger learns only what the registrant chose
to type. Note register_extension is a live, permissionlessly-callable instruction, so this is
reachable independent of gap 1.

**28. No rate limit, quota, cost cap or timeout on a paid-LLM endpoint**

`server/api/builder/generate.post.ts:82` — CONFIRMED

Verified by exhaustive search: `grep -rni 'rate.?limit|ratelimit|throttle|quota' server/ app/
shared/ nuxt.config.ts` returns **zero** hits. server/utils/ contains attest, crypto, demo, eth,
kwami-brain, kwami-secret, livekit, nonce, solana, supabase, wallet-session — no limiter.
server/middleware/ contains only security-headers.ts, which sets CSP/XFO/Permissions-Policy and
nothing else. nuxt.config.ts declares no security or rate-limit module (modules list at line 8).
The `$fetch` to api.anthropic.com (generate.post.ts:83-104) passes no `timeout`, and there is no
per-user or per-Kwami generation quota. Minting is permissionless, so any authenticated user
with one `state = 'minted'` Kwami can loop the endpoint at 8000 output tokens per call, with an
unbounded `brief` (2000 chars) plus an unbounded `hooks` array on input, billed to
NUXT_ANTHROPIC_API_KEY. Each attempt also inserts a `kwami_programs` row (line 55-66) with no
cleanup and no cap; nothing in supabase/migrations/20260904000001_init.sql:199-216 bounds that
table.

### Owners publish so others can interact

**29. Nothing stops an owner/author from playing and beating their own Kwami**

`programs/kwami-vault/src/lib.rs:542` — CONFIRMED

CONFIRMED at every layer. On chain, `assert_playable` inspects only lifecycle state
(lib.rs:542-549), and neither `StartSessionSol` (lib.rs:820-847) nor `StartSessionUsdc`
(lib.rs:849-888) constrains `player` against `kwami.owner` or `kwami.author` — the only `author`
constraint is `address = kwami.author` on the royalty destination (lib.rs:844). `ClaimWin`
constrains the session to the signer only (lib.rs:916-920). Off chain,
server/api/session/start.post.ts checks `requireUser` and transaction provenance but never
compares the player to the Kwami's owner/author (lines 28-73), and
server/api/session/[id]/transcript.post.ts checks only `session.player_id !== user.id` (line 45)
before signing an oracle attestation for them (line 93) or handing over the commit-reveal pre-
image (line 100). Grep for owner comparisons across server/, app/, shared/ and programs/ returns
only the four `kwami.owner == owner.key()` account constraints (lib.rs:806,1002,1020,1042) and
the two cosmetic `isOwner` computeds (app/pages/kwami/[mint].vue:11, manage.vue:20). The author
knows the phrase, so once others have funded the pot they buy one ticket and claim `payout_bps`
(default 8000 = 80%, state.rs:6) of the vault; in commit-reveal this self-cracks the Kwami
(lib.rs:364-365), in attested mode transcript.post.ts re-signs for them every session. One
overstatement to correct: `split.to_author` is not extra profit — it is 40% of the protocol fee
(`AUTHOR_ROYALTY_BPS_OF_FEE = 4_000`, state.rs:18; math.rs:30-38), carved out of the ticket the
author themselves paid, so it is a partial rebate, not a gain.

**30. A published Kwami is not immutable in the index the app actually serves**

`supabase/migrations/20260904000001_init.sql:249` — CONFIRMED

CONFIRMED. `create policy kwamis_update_own on public.kwamis for update using (auth.uid() =
author_id) with check (auth.uid() = author_id)`
(supabase/migrations/20260904000001_init.sql:249-250) grants UPDATE on every column of the row,
with no column list; grep for grant/revoke across supabase/ returns nothing, and the only
triggers on the table are `kwamis_touch -> touch_updated_at` (init.sql:310-311), which guards
nothing. The preceding comment 'Only presentation columns are ever updated from the client'
(init.sql:246-248) is aspiration, not enforcement. The Supabase URL and anon key are published
to the browser under `runtimeConfig.public` (nuxt.config.ts:36-38) and used to build a client-
side client (app/composables/useSupabase.ts:15), so an author with their own JWT can PATCH
`state`, `secret_hash`, `ticket_price_lamports`, `ticket_price_usdc`, `payout_bps`,
`session_duration`, `hints`, `balance_lamports`, `balance_usdc` and `sessions_played` on a live
row. Every read path serves those columns through `kwamis_public`
(20260904000002_views.sql:26-79), including the advertised prize `(k.balance_lamports *
k.payout_bps) / 10000` (views.sql:67-68) and the ticket price (views.sql:44-45) that
app/pages/kwami/[mint].vue:70-91 renders to a challenger before they pay — the opposite of the
guarantee printed at manage.vue:91-96. `security_invoker = true` on the view (views.sql:27)
governs reads only and does not narrow this. Note the chain still settles on its own immutable
values, so this corrupts what challengers are shown and what `/api/session/start` accepts, not
the payout arithmetic itself.

**31. Ownership transfer is never mirrored, so the seller keeps control and the buyer gets no owner UI**

`server/api/kwami/draft.post.ts:76` — CONFIRMED

CONFIRMED. `owner_wallet` is written exactly once, at draft creation, to the author's own wallet
(server/api/kwami/draft.post.ts:76); grep for `owner_wallet` across server/, app/, shared/ and
supabase/ shows every other occurrence is a read, an index or a type — nothing ever updates it.
`syncOwnerIx` exists (shared/solana/instructions.ts:270-285) but has no caller outside
tests/unit/instructions.test.ts:267-275. Both owner UIs gate on that frozen mirror: `const
isOwner = computed(() => wallet.address && kwami.value?.owner_wallet === wallet.address)`
(app/pages/kwami/[mint]/manage.vue:20 and app/pages/kwami/[mint].vue:11), so after a marketplace
sale the buyer sees 'You do not hold this Kwami' (manage.vue:61-63) and gets neither Publish nor
Pause (manage.vue:78-83). The seller keeps write access to the row forever, because the RLS
update policy keys on the immutable `author_id` (init.sql:249). Worse than reported on the chain
side: because nothing in the product ever invokes `sync_owner`, on-chain `kwami.owner` also
stays the seller (lib.rs:184-196 is permissionless but must be called by someone), and
`OwnerAction`, `WithdrawSol` and `WithdrawUsdc` all authorise against `kwami.owner` (lib.rs:806,
1002, 1020) — so until an outside party hand-crafts the sync, the seller retains publish, pause
and withdraw authority over a Kwami they have sold.

## Fixed

Nine blockers and two majors, each with the test that would have caught it.

**The session never ended** — blockers 4, 5, 6 and 20. The three-minute limit was enforced only
against a client-supplied `at`, and nothing anywhere wrote a terminal outcome, so `pending` was
permanent and every `outcome !== 'pending'` guard was dead code. Reporting `at: 0` on each turn
held a session open indefinitely: unlimited turns against the Kwami's brain, and unlimited reads
of the similarity score returned on every miss — which together give up the phrase.
`server/utils/session-window.ts` now closes the session on the server clock with a conditional
write, and the LiveKit token is scoped to what is left of the session rather than a flat five
minutes. 11 tests.

_Still open from that cluster:_ a win returns the plaintext pre-image, which is replayable on a
freshly bought ticket. That is a protocol design question, not a clock bug.

**Every avatar rendered white** — blocker 17. `paletteFromMint` emitted CSS Color 4 space
syntax; three.js's `Color.setStyle` matches only the comma form and fell through to its default.
Demonstrated directly: `hsl(200 78% 62%)` parses to `#ffffff`. One definition now lives in
`shared/game/palette.ts` instead of two copies. 5 tests, one parsing through a real
`THREE.Color` — the previous test asserted the broken string shape, which is why the bug
survived a green suite.

**The oracle attestation was forgeable** — blocker 18. The three `*_instruction_index` fields
tell the runtime which instruction to read the signature, key and message from, and
`attestation.rs` never looked at them. An attacker could put the real oracle key and the real
expected message inside the ed25519 instruction — passing every check the program made — while
pointing the indices at another instruction holding their own key, message and a genuinely
valid signature. All three must now be `u16::MAX`. Offsets are also overflow-checked and
refused if they reach back into the header.

**Any token bought a real session** — blocker 14, major 20. `start_session_usdc` took an
unconstrained `Mint`, so a token printed by the player bought a ticket whose win paid out real
SOL. The accepted mint is now `Config::usdc_mint`, pinned with `address =`. `treasury_usdc` and
`author_usdc` were constrained only by mint, so a player could pass their own accounts and take
the fee and royalty back; both are now bound to `config.treasury` and `kwami.author`.

**An owner could drain a pot mid-challenge** — blocker 9, major 30. `pause` and `withdraw` are
separate instructions and withdrawal only checked that the Kwami was not Live, so an owner could
pause and empty the pot while a challenger who had paid still had time on the clock.
`Kwami::pot_locked_until` holds the pot until the latest sold session expires, monotonically.

**A seller kept the keys after the sale** — blocker 13. Withdrawal authorised on `kwami.owner`,
a cached field refreshed only by `sync_owner`, which nothing ever called. Both handlers now
require the NFT token account itself and write the proven holder back.

**The program had no tests at all.** It has 28: the attestation verifier including every forgery
variant, the 80% arithmetic checked against the TypeScript implementation it must agree with,
ticket splits conserving every lamport, both death rules at their exact boundaries, and the
pause-mid-session drain. Removing just the three index checks fails exactly three of them, so
they are not vacuous.

## Suggested order of work

1. **Rust tests first.** Nothing below can be verified without them, and their absence is
   what allowed every program-level finding here. `cargo test` now runs in CI.
2. **The money paths**: pin the USDC mint; prove payment before issuing a session; validate
   the ed25519 instruction-index fields; read ownership from the token account instead of the
   cached field; stop pause-then-withdraw draining a live pot.
3. **The unwired requirements**: call `record_valuation`; mark a published Kwami live; invoke
   the extension, or stop claiming the builder produces one; create the collection.
4. **Everything else**, in severity order.
