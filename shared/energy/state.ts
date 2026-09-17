/**
 * How much energy is "enough", and what running out does to a Kwami.
 *
 * Starving is deliberately *not* a death. `evaluateDeath` in
 * `shared/game/economy.ts` kills a Kwami for losing its pot, and that is
 * terminal because the loss is real and on chain. An empty energy balance is
 * neither: nothing was lost, the pot is untouched, and the owner can fix it in
 * one transaction. A Kwami that starved is asleep, not dead, and the transition
 * runs in both directions.
 */
import { DEFAULT_SESSION_DURATION_SECS } from '../game/constants'
import type { KwamiState } from '../types/kwami'
import { estimateSessionMicro } from './cost'

/**
 * Below this, the meter warns.
 *
 * One default session's worth, rather than a round number, because that is the
 * only threshold with a meaning the owner can act on: "there is not enough here
 * for the next challenger to finish their three minutes". A percentage of some
 * past peak would tell them how their balance is trending, which is not the
 * question.
 */
export const LOW_ENERGY_MICRO = estimateSessionMicro(DEFAULT_SESSION_DURATION_SECS)

export type EnergyState =
  /** Enough for at least one more full session. */
  | 'full'
  /** Some left, but not a session's worth. */
  | 'low'
  /** Empty. The Kwami cannot answer and must not be sold a ticket. */
  | 'starving'

export function energyStateOf(micro: bigint, lowThreshold: bigint = LOW_ENERGY_MICRO): EnergyState {
  if (micro <= 0n) return 'starving'
  return micro < lowThreshold ? 'low' : 'full'
}

/**
 * Whether a balance covers a cost.
 *
 * Inclusive: a balance of exactly the cost can pay it and lands on zero. The
 * boundary matters because it is the difference between a last reply that lands
 * and one that is refused while the challenger's clock runs — and the analogous
 * rule in `evaluateDeath` is the same shape, where a Kwami sitting exactly on
 * the 1% line survives.
 */
export function canAfford(micro: bigint, cost: bigint): boolean {
  return micro >= cost
}

/**
 * Fold an energy balance into the lifecycle state.
 *
 * Only `live` and `starving` are touched, and only ever into each other. A
 * `dead` or `cracked` Kwami stays where it is — buying it fuel must not
 * resurrect something the chain has already retired — and `draft`, `minted` and
 * `paused` are states nobody is being sold a session in, so an empty balance
 * there is not yet anybody's problem.
 */
export function withEnergyState(state: KwamiState, micro: bigint): KwamiState {
  if (state === 'live' && micro <= 0n) return 'starving'
  if (state === 'starving' && micro > 0n) return 'live'
  return state
}
