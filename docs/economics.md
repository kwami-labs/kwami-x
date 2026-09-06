# Economics

All of this is integer arithmetic on base units. The rules live twice — `shared/game/economy.ts` and `programs/kwami-vault/src/math.rs` — and the two must agree exactly, because the UI quotes a payout from one and the chain pays it out with the other.

## The ticket split

Of every ticket:

| Share     | Where it goes                |
| --------- | ---------------------------- |
| **97.5%** | The Kwami's pot              |
| **1.5%**  | Protocol treasury            |
| **1.0%**  | The original author, forever |

The author royalty is carved **out of** the protocol fee, not charged on top of it. A challenger's total cost is exactly the advertised ticket price, and the fee can never exceed `PROTOCOL_FEE_BPS` regardless of how the split is configured.

The royalty follows the _author_, not the owner. Sell the NFT and the buyer collects nothing from it — you minted it, you seeded it, that share is yours for as long as the Kwami lives.

## The mint commission

Minting charges a flat fee in SOL — `NUXT_PUBLIC_MINT_COMMISSION_SOL`, default **0.5** — paid
to `NUXT_PUBLIC_PLATFORM_TREASURY` as an ordinary system transfer appended to the mint bundle.

Flat rather than a share of the pot, because minting is where the platform's real costs land:
rent for the mint account, the metadata account, the Kwami account and its vault, plus the
program deploy an owner's extension may need. None of that scales with how popular the Kwami
later becomes. Charging a percentage of a pot that does not exist yet would take nothing for the
expensive part and everything for the cheap one.

It is a plain `SystemProgram.transfer`, not a CPI inside the vault instruction, so Phantom
decodes it and shows _"0.5 SOL to &lt;treasury&gt;"_ as its own line in the approval preview. The
builder also prints it as a line item before the button is pressed — a creator who first
discovers the fee in their wallet prompt has been ambushed, and will read every later prompt
with suspicion.

It is appended **last**, so a failure anywhere earlier in the bundle costs the creator nothing.

An empty treasury adds no instruction at all, so a fresh clone pointed at devnet can mint
without first inventing an address to pay.

## Energy

The mint commission and the ticket split are the platform's two charges on a Kwami's _money_. Energy
is the third charge, and it is on its _running costs_ — the model calls and the speech that let it
answer at all.

It is a separate balance from the pot, and it has to be. The pot is escrow: the program has no
instruction that spends it on anything but a payout, and an owner cannot withdraw from it while a
challenger still has time on the clock. Paying for inference out of it would be spending the
challengers' stake on the owner's overheads.

A Kwami that runs out of energy goes `starving` — unlisted, selling no tickets, pot untouched — and
comes straight back on a top-up. It is the one lifecycle transition in this system that reverses.

Full treatment, including the rounding rules and the one place a ticket can still be stranded, in
[Energy](/docs/energy).

## The payout

The winner takes `payout_bps` of the pot — 80% by default, and the owner may set anything from 50% to 95% at mint.

The band is not arbitrary. Below 50% the game stops being worth playing; above 95% a single win effectively kills the Kwami, which makes the drawdown death rule redundant and removes any reason for an owner to keep it alive.

What survives a win is what makes the next challenge possible. At 80%, a Kwami that is beaten still holds a fifth of its pot and keeps selling tickets.

## Rounding

Every `applyBps` rounds **down**:

```ts
return (amount * BigInt(bps)) / BigInt(BPS_DENOMINATOR)
```

Rounding up would let a winner take one lamport more than exists in a vault holding 3 lamports at 80%. Rounding down means the dust stays behind, which is the only direction that is always safe.

## Death

A Kwami dies under either of two rules, evaluated together in `evaluateDeath`:

**Drawdown** — the vault has lost 99% of its all-time high-water mark.

```
current * 100 < high_water_mark   →   dead
```

**Dust** — the vault is worth less than one dollar.

Both are expressed in whole US cents on chain, so the comparison is integer and the two implementations cannot drift on a floating-point edge.

A Kwami sitting exactly on the 1% line survives; the rule fires strictly below it. A never-funded Kwami is not dust-dead — it has not _lost_ anything, it simply has not started yet, and callers pass `hasBeenFunded: false` for that case.

Death is terminal. `nextState` keeps `dead` and `cracked` where they are even if someone later sends SOL to the vault, because the alternative is a Kwami that resurrects when an unrelated wallet makes a mistake.

## Vitality

Vitality is `current / high_water_mark`, clamped to `[0, 1]`. It drives the avatar — a dying Kwami visibly deflates and desaturates — and the vitality bar on every card.

The bar renders on a **square-root scale**. Linearly, a Kwami at 3% of its peak and one at 0.5% are both an invisible sliver, but one is alive and one is about to die, which is the single most important fact on the card. The root spreads out the bottom of the range, where the drama actually is.

## Valuation

A mixed SOL/USDC vault cannot be priced on chain, so an oracle pushes a valuation into `record_valuation`. That instruction can only ever raise the high-water mark or declare death — it can never move funds. A faulty oracle can kill a Kwami; it cannot steal from one.

## Constants

Defined once in `shared/game/constants.ts` and mirrored in `programs/kwami-vault/src/state.rs`.

| Constant                            | Value                 |
| ----------------------------------- | --------------------- |
| `DEFAULT_PAYOUT_BPS`                | 8000 (80%)            |
| `MIN_PAYOUT_BPS` / `MAX_PAYOUT_BPS` | 5000 / 9500           |
| `DEFAULT_SESSION_DURATION_SECS`     | 180                   |
| `MIN` / `MAX_SESSION_DURATION_SECS` | 30 / 900              |
| `PROTOCOL_FEE_BPS`                  | 250 (2.5%)            |
| `AUTHOR_ROYALTY_BPS_OF_FEE`         | 4000 (40% of the fee) |
| `DEATH_VITALITY_THRESHOLD`          | 0.01                  |
| `DEATH_FLOOR_USD`                   | 1                     |
