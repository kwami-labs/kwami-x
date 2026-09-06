/**
 * What it costs to keep a Kwami talking.
 *
 * A Kwami's pot is escrow. It holds challengers' money, the Anchor program has
 * no path to spend it on anything but a payout, and `may_withdraw` deliberately
 * locks it while anyone still has time on the clock. So the model calls, the
 * speech synthesis and the program generation a Kwami needs in order to *be* a
 * Kwami cannot come out of it — paying for them from the pot would be spending
 * the challengers' stake on the owner's running costs.
 *
 * Energy is that second axis: prepaid compute credit, owned by the Kwami,
 * bought by its owner, and spent every time it opens its mouth.
 */

/**
 * Energy is stored in integer micro-units and displayed in whole energy.
 *
 * Integer base units for the same reason every lamport amount in this codebase
 * is a `bigint`: a balance that decrements a few thousand times and is compared
 * against zero cannot be a float. A thousandth is fine enough that a single
 * spoken second has a non-zero price without needing decimals anywhere.
 *
 * The divisor matches `kwami-app`'s `MICRO_CREDITS_PER_CREDIT`, so the two
 * applications do not end up with two different meanings for the user's word.
 */
export const MICRO_PER_ENERGY = 1_000n

/** One generated reply — a single turn of the Kwami's brain. */
export const REPLY_MICRO = 1_000n

/**
 * One second of synthesised or transcribed speech.
 *
 * Priced per second rather than per minute because a session is billed for the
 * speech that actually happened, and rounding a forty-second exchange up to a
 * whole minute would overcharge by half.
 */
export const VOICE_MICRO_PER_SECOND = 50n

/**
 * One run of the program builder.
 *
 * Two orders of magnitude above a reply, and honestly so: a generation spends a
 * minute reasoning before the first line of Rust exists, and `docs/builder.md`
 * describes exactly how much thinking that is. Pricing it like a chat turn
 * would let one owner's afternoon of iteration cost more than every session
 * their Kwami has ever sold.
 */
export const CODEGEN_MICRO = 250_000n

/** Replies a three-minute session tends to use. Only ever used for estimates. */
export const TYPICAL_REPLIES_PER_SESSION = 10

/**
 * How much energy one SOL buys.
 *
 * A deployment decision rather than a constant baked into the client: the real
 * cost of a reply is denominated in dollars and SOL is not, so an operator has
 * to be able to move this without a release. Overridable through
 * `NUXT_PUBLIC_ENERGY_PER_SOL`.
 */
export const DEFAULT_ENERGY_PER_SOL = 20_000

/**
 * What a new account gets to spend before it has paid anything.
 *
 * Roughly two sessions' worth of replies. It exists because the alternative is
 * asking someone to buy fuel for a character they have never heard speak, and
 * `docs/economics.md` already names that pattern — discovering a charge only at
 * the approval prompt — as the thing that makes a creator distrust every later
 * prompt. Hearing it first is what the trial buys.
 */
export const FREE_TRIAL_MICRO = 40_000n
