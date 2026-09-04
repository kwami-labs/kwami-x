# Protocol

The `kwami_vault` Anchor program is the ledger, the escrow and the referee. Everything else in this repository is an interface to it.

Program id: `DoQubWtmNa4WZTLWxe1iptCDrwf81M8LHDrZDP7pEBbL`
Source: `programs/kwami-vault/src/lib.rs`

## Accounts

### `Config` — `["config"]`

One per deployment. Holds the treasury address, the protocol fee, the oracle key and a global pause switch.

The fee has a hard ceiling (`MAX_FEE_BPS`, 5%) enforced in `update_config`, so a compromised authority cannot quietly tax pots into nothing.

### `Kwami` — `["kwami", mint]`

One per NFT. The important property is what it *lacks*: there is no setter for the secret hash, either ticket price, the session length, the payout split, the resolution mode or the extension. Those are written once in `create_kwami` and are immutable for the life of the token.

What does change: `state`, `owner` (via `sync_owner`), the session counters, and the high-water mark.

### `vault` — `["vault", mint]`

The pot. A system-owned PDA with no data, so **its lamport balance is the SOL pot** with no separate accounting to keep in sync. It is also the authority over the Kwami's USDC associated token account.

Its rent-exempt minimum is excluded from every payout calculation — that lamport floor is not winnings.

### `Session` — `["session", mint, player, nonce_le]`

One challenge. `start_session_*` requires `nonce == kwami.sessions_played`, which means a player cannot hold two sessions against the same Kwami at once and cannot brute-force it in parallel.

### `Extension` — `["extension", mint]`

An opt-in record binding a Kwami to an owner-authored sub-program. See [Program builder](/docs/builder).

## Instructions

| Instruction | Who | What it does |
|---|---|---|
| `initialize_config` | deployer | One-time protocol setup |
| `update_config` | authority | Fee, oracle, treasury, pause |
| `create_kwami` | anyone | Creates the Kwami account and vault alongside a fresh NFT |
| `publish` / `pause` | owner | Opens or closes the Kwami to challengers |
| `sync_owner` | anyone | Points `Kwami::owner` at the current NFT holder |
| `start_session_sol` | player | Pays a SOL ticket, opens a session |
| `start_session_usdc` | player | Pays a USDC ticket, opens a session |
| `claim_win_reveal` | player | Claims a win by revealing the pre-image |
| `claim_win_attested` | player | Claims a win with an oracle signature |
| `settle_session` | anyone | Closes an expired session, returns its rent |
| `record_valuation` | oracle | Records USD value, applies the death rules |
| `withdraw_sol` / `withdraw_usdc` | owner | Only while unpublished or after death |
| `register_extension` | owner | Attaches a sub-program, before first publish |

## How a win is proven

This is the part that matters. The conversation is off chain — voice, speech recognition, a language model — and none of it can be trusted to decide who gets paid. There are two answers, chosen per Kwami at mint.

### Commit–reveal (trustless)

At mint, the Kwami commits to `sha256(normalize(secret) || 0x1f || salt)`. The hash goes on chain; the phrase does not.

When the server observes a challenger saying the phrase, it hands them the pre-image. They submit it in `claim_win_reveal`, and the program hashes it itself:

```rust
let digest = hash(&preimage).to_bytes();
require!(digest == ctx.accounts.kwami.secret_hash, KwamiError::WrongSecret);
```

Nothing off chain can deny a real win or manufacture a fake one. The cost: the pre-image is now in the ledger for anyone to replay, so the program marks the Kwami `Cracked` in the same instruction. It is spent. That retirement is precisely what keeps trustless mode honest rather than a one-shot exploit for the next person to read the block.

The `0x1f` separator matters more than it looks: without it, `("ab", "cd")` and `("abc", "d")` would produce the same digest, and an author could argue after the fact that their commitment was over a different phrase.

### Attested (oracle-witnessed)

A registered oracle signs `"KWAMIWIN" || session || player || valid_until` with ed25519. The client prepends a native `Ed25519Program` instruction; the runtime verifies the signature, and the program reads that instruction back through the instructions sysvar to confirm *what* was verified.

That read-back is the whole security of the mechanism. Solana has no syscall to check an ed25519 signature inside a program, so the runtime does it — but without inspecting the instruction afterwards, a caller could have the runtime verify a signature over an attacker-chosen message and the program would never know. `attestation.rs` checks the program id, the signature count, the signer key and the message bytes, and requires the instruction to sit *immediately* before the claim so it cannot be double-counted.

The message binds three things: the session, the player and a deadline. Drop any one of them and a captured attestation becomes replayable against another session, by another wallet, or forever.

The oracle can only witness. The program gives it no authority to move funds, so a compromise means forged wins on attested Kwamis — bad — rather than a drained treasury. That asymmetry is the reason the mode is offered at all.

## Why the payout is proportional, not converted

A winner receives `payout_bps` of **both** vault assets, separately:

```rust
payout_lamports = apply_bps(pot_lamports, payout_bps);
payout_usdc     = apply_bps(vault_usdc.amount, payout_bps);
```

The alternative — computing a dollar value and paying it out in one asset — would need a price oracle and a swap route inside settlement. A stale price would then mean someone is paid the wrong amount, and a missing swap route would mean nobody is paid at all. Proportional payout needs neither.

## Settlement re-checks its own preconditions

`settle_win` verifies the session is still pending and still inside its window, even though both claim paths already validated their proof. The proof establishes that the player *knew the secret* — not that they were still inside the clock when they proved it. Those are different claims, and conflating them is how a player wins a session they already lost.
