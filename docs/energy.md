# Energy

A Kwami's pot is not its budget.

The vault is escrow. It holds challengers' money, the Anchor program has no instruction that spends it on anything but a payout, and `Kwami::may_withdraw` deliberately locks it while anyone still has time on the clock. So the model calls, the speech synthesis and the program generation a Kwami needs in order to _be_ a Kwami cannot come out of it. Charging inference to the pot would be spending the challengers' stake on the owner's running costs — and the pot is the thing those challengers are playing for.

**Energy** is the second balance. Prepaid, owned by the Kwami, bought by its owner, and spent every time it opens its mouth.

```
        pot                              energy
   ─────────────                    ────────────────
   challengers pay in               the owner pays in
   winners take out                 answering burns it
   the program decides              the platform meters it
   losing it is death               losing it is sleep
```

## The unit

Energy is stored in integer **micro-energy**, a thousand to one displayed unit, as a `bigint` — the same discipline every lamport amount in this codebase follows, and for the same reason: a balance that decrements a few thousand times and is compared against zero cannot be a float. The divisor matches the sibling application's `MICRO_CREDITS_PER_CREDIT`, so the two do not end up with two different meanings for the user's word.

| Operation              | Cost        |
| ---------------------- | ----------- |
| One reply              | 1 energy    |
| One second of speech   | 0.05 energy |
| One program generation | 250 energy  |

A generation costs two orders of magnitude more than a reply, and honestly so: it spends most of a minute reasoning before the first line of Rust exists. Pricing it like a chat turn would let one owner's afternoon of iteration cost more than every session their Kwami has ever sold.

Speech is priced per second rather than per minute because a session is billed for the speech that actually happened, and rounding a forty-second exchange up to a whole minute would overcharge by half.

## Rounding

**Debits round up. Credits round down.**

The asymmetry always favours the ledger, which is the only direction that is safe. Rounding a debit down lets a caller split one second into ten tenths and pay nothing for any of them; rounding a credit up hands out energy nobody bought. It is the same argument `docs/economics.md` makes for rounding payouts down, pointed at a balance instead of a pot.

## Buying it

A top-up is a plain `SystemProgram.transfer` to the platform treasury — the same shape as the mint commission, and for the same reason. Phantom decodes it and shows the destination and the amount as its own line, where an opaque program call would be invisible. At mint the bundle carries two such transfers, the fee and the fuel, so the creator approves a prompt whose two lines match the two the studio quoted them.

The server does not believe any of it on the client's word. It fetches the signature from the cluster and reads **the treasury's own balance delta** — not the instruction list, because decoding would have to keep up with however the bundle happens to be assembled, whereas the balance change is what actually happened and what the payer's wallet showed them. For a mint, the advertised commission comes off that delta first; whatever the creator paid above it is what they were buying energy with.

Crediting is idempotent on the signature — `energy_ledger.tx` is unique — so a client retrying a confirmation it never saw the response to cannot double it.

`NUXT_PUBLIC_ENERGY_PER_SOL` sets the price. It is a deployment setting rather than a constant because the real cost of a reply is denominated in dollars and SOL is not, so an operator has to be able to move it without a release.

An empty `NUXT_PUBLIC_PLATFORM_TREASURY` adds no fuel instruction at all and charges nothing, exactly as it does for the commission — a fresh clone pointed at devnet still mints.

## The free trial

Every account gets a small allowance, granted the first time it opens the studio rather than at signup, so an account that never builds anything never has a balance to account for.

It exists because the alternative is asking someone to buy fuel for a character they have never heard speak. `docs/economics.md` names that pattern — discovering a charge only at the approval prompt — as the thing that makes a creator distrust every later prompt. Hearing the Kwami first is what the trial buys.

The allowance is also the rate limit. There is no separate quota on `/api/studio/preview`: an account can spend its trial and no more, which bounds what an unfunded caller can extract to a fixed number of replies.

## Running out

An empty balance makes a Kwami **`starving`**, and starving is _not_ a death.

```
live ──energy hits 0──▶ starving ──top up──▶ live
```

`dead` is terminal because a drawdown loss is real and on chain. An empty energy balance is neither: nothing was lost, the pot is untouched, and one transaction fixes it. The state moves in both directions, and `withEnergyState` is the only thing that moves it.

Terminal states stay terminal. Fuelling a dead Kwami must not undo a drawdown death, and fuelling a cracked one must not make a published phrase secret again.

A starving Kwami is not `live`, so it drops out of the arena and the leaderboard through the filters those already use — no new clause was needed anywhere. It comes back holding whatever rank its pot earns, because nothing about the pot changed while it was asleep.

## The one honest gap

A ticket is paid **on chain before the server sees it**. So the defence against selling someone three minutes with a Kwami that cannot speak has to be ordered, and only the first two layers actually protect the challenger:

1. **The arena filter.** A starving Kwami is not `live`, so it is not listed anywhere.
2. **The play page.** It will not offer a ticket for a Kwami that cannot answer.
3. **`POST /api/session/start`.** Returns 409 — _after_ the ticket has already been spent.

Layer 3 is a backstop for the narrow race where a Kwami runs out between the page loading and the transaction confirming. It cannot give the money back. It is written down here rather than glossed because a reader deserves to know which of the three is doing the work.

## Running out mid-session

Different problem, different answer. A challenger who has already paid must not lose their remaining minutes because the owner underfunded the Kwami.

So a session reply that cannot be paid for **does not fail**. The Kwami drops to its scripted deflector — the same fallback a model outage takes — and the session runs to its end. The win is decided by `matchSecret` against what the _player_ says, not by the quality of the Kwami's replies, so a scripted Kwami still leaves them every chance of taking the pot. The response carries `starved: true` so the UI can say why it went terse rather than leaving the player to conclude it simply got worse at the game.

The program builder is the opposite case and fails closed. There is nobody else's paid time at stake — it is the owner spending their own Kwami's energy on their own tooling — and there is no useful degraded mode, because no fallback writes Anchor.

## Where it lives

Off chain, in Postgres, funded by a verified on-chain payment.

That is a deliberate limit and not a permanent one. An on-chain energy account would be trustless and auditable, and it would also mean new Rust, a compile and a deploy — and `README.md` is clear that the vault program has never been compiled. Putting an unbuildable change on the critical path of a feature that is otherwise pure application code would trade something that works today for something that cannot be verified. The balance can migrate on chain later without the interface changing.

What that costs, stated plainly: the platform is the counterparty for energy. It cannot touch a pot — that is the program's business and always has been — but an owner's energy balance is a number in a database the platform runs, backed by an append-only ledger anyone with access can replay against the chain, and not by the chain itself.

## Schema

| Table / column        |                                                       |
| --------------------- | ----------------------------------------------------- |
| `kwamis.energy_micro` | the live balance, beside the row it belongs to        |
| `energy_ledger`       | append-only audit trail, one row per credit and debit |
| `account_energy`      | the pre-mint trial allowance, one row per account     |

`energy_ledger` is deliberately shaped like `valuations`: a cached scalar is only trustworthy if there is a record you can replay it from. `balance_after` is stored rather than derived so a corrupted balance can be _detected_, not merely recomputed into agreeing with itself.

Every debit runs through a Postgres function holding `select … for update`. Reading a balance in Nitro and writing it back would let two concurrent replies both see the same number and both succeed, and a balance that cannot actually reach zero under load is not a balance — it is a decoration on an unmetered API.

The ledger is readable by the Kwami's author only. How heavily a Kwami is being talked to is competitive information — the same reasoning that keeps transcripts away from a Kwami's owner, pointed the other way.

## The rules, in code

- `shared/energy/constants.ts` — the unit and the price list
- `shared/energy/cost.ts` — what an operation costs, what a payment buys
- `shared/energy/state.ts` — `full` / `low` / `starving`, and the lifecycle fold
- `shared/energy/receipt.ts` — reading a payment off a transaction
- `server/utils/energy.ts` — the plumbing, and nothing else
