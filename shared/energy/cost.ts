/**
 * What each thing a Kwami does costs, and what a payment buys.
 *
 * Pure arithmetic over `bigint` micro-energy. The client imports it to quote a
 * price before anything is spent and the server imports it to charge, which is
 * the whole reason it lives in `shared/` — a quote the browser computed one way
 * and a debit the server computed another is a bug the user experiences as
 * being overcharged.
 *
 * Every debit rounds **up** and every credit rounds **down**. The asymmetry
 * always favours the ledger, which is the only direction that is safe: rounding
 * a debit down lets a Kwami be talked to for free one fraction at a time, and
 * `docs/economics.md` makes the same argument for rounding payouts down.
 */
import { LAMPORTS_PER_SOL } from '../game/constants'
import {
  CODEGEN_MICRO,
  MICRO_PER_ENERGY,
  REPLY_MICRO,
  TYPICAL_REPLIES_PER_SESSION,
  VOICE_MICRO_PER_SECOND,
} from './constants'

/** Something a Kwami can spend energy doing. */
export type EnergyOp =
  /** One turn of the brain — a session reply, or a test drive in the studio. */
  | { kind: 'reply' }
  /** Speech, in seconds. Fractional seconds are allowed and always round up. */
  | { kind: 'voice'; seconds: number }
  /** One run of the program builder. */
  | { kind: 'codegen' }

/** Divide, rounding away from zero, so a debit is never rounded to nothing. */
function ceilDiv(amount: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) throw new RangeError('divisor must be positive')
  if (amount <= 0n) return 0n
  return (amount + divisor - 1n) / divisor
}

/**
 * What an operation costs, in micro-energy.
 *
 * Voice is the only op with a continuous input, and it is milliseconds-precise
 * on the way in: a caller that measured 12.4 seconds should not have to decide
 * for itself whether to charge for 12 or 13.
 */
export function costOf(op: EnergyOp): bigint {
  switch (op.kind) {
    case 'reply':
      return REPLY_MICRO
    case 'codegen':
      return CODEGEN_MICRO
    case 'voice': {
      if (!Number.isFinite(op.seconds) || op.seconds <= 0) return 0n
      // Scale by a thousand first so a sub-second fragment survives to be
      // rounded up, rather than truncating to zero inside the BigInt cast.
      const milliseconds = BigInt(Math.ceil(op.seconds * 1_000))
      return ceilDiv(milliseconds * VOICE_MICRO_PER_SECOND, 1_000n)
    }
  }
}

/**
 * Roughly what one session will cost, for the "you can afford N more" line.
 *
 * An estimate and named as one. The replies figure is a typical count, not a
 * limit — nothing stops a talkative challenger from spending more, and the UI
 * must not imply the number is a guarantee.
 */
export function estimateSessionMicro(
  durationSecs: number,
  replies: number = TYPICAL_REPLIES_PER_SESSION,
): bigint {
  const spoken = costOf({ kind: 'voice', seconds: Math.max(0, durationSecs) })
  return spoken + REPLY_MICRO * BigInt(Math.max(0, Math.trunc(replies)))
}

/**
 * What a payment in lamports is worth in micro-energy.
 *
 * Rounds down, so a deposit never credits more than it paid for. Goes through
 * `bigint` end to end because `lamports * energyPerSol` overflows a double at
 * around 0.05 SOL, and quietly crediting a rounded float is precisely the class
 * of bug this module exists to prevent.
 */
export function energyFromLamports(lamports: bigint, energyPerSol: number): bigint {
  if (lamports <= 0n) return 0n
  if (!Number.isFinite(energyPerSol) || energyPerSol <= 0) return 0n
  const perSol = BigInt(Math.trunc(energyPerSol))
  return (lamports * perSol * MICRO_PER_ENERGY) / LAMPORTS_PER_SOL
}

/**
 * What buying `micro` worth of energy costs, in lamports.
 *
 * The inverse of `energyFromLamports`, rounded up: the quote a creator is shown
 * must never be less than what the deposit has to be to actually buy it.
 */
export function lamportsForEnergy(micro: bigint, energyPerSol: number): bigint {
  if (micro <= 0n) return 0n
  if (!Number.isFinite(energyPerSol) || energyPerSol <= 0) return 0n
  const perSol = BigInt(Math.trunc(energyPerSol))
  return ceilDiv(micro * LAMPORTS_PER_SOL, perSol * MICRO_PER_ENERGY)
}

/** Micro-energy as whole displayed energy, rounded down — never promise more than is there. */
export function toEnergy(micro: bigint): number {
  return Number(micro / MICRO_PER_ENERGY)
}

/** Whole energy as micro-energy. */
export function fromEnergy(energy: number): bigint {
  if (!Number.isFinite(energy) || energy <= 0) return 0n
  return BigInt(Math.trunc(energy)) * MICRO_PER_ENERGY
}
