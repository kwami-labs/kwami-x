import { isDemoMode } from '~~/server/utils/demo'
import { maybeUser } from '~~/server/utils/supabase'
import { energyPerSol, grantTrial } from '~~/server/utils/energy'
import { FREE_TRIAL_MICRO } from '#shared/energy/constants'
import { energyStateOf } from '#shared/energy/state'

/**
 * The trial allowance the studio spends before a Kwami exists.
 *
 * Granted on read rather than at signup, so an account that never opens the
 * studio never has a balance to account for — and so the grant happens exactly
 * once, at the first moment it could possibly be spent.
 *
 * Answers for a signed-out or demo caller too, with the full allowance, because
 * the meter is on screen before anything has been spent and a dash there reads
 * as broken rather than as "not yet".
 */
export default defineEventHandler(async (event) => {
  const fallback = {
    balance: FREE_TRIAL_MICRO.toString(),
    state: energyStateOf(FREE_TRIAL_MICRO),
    energyPerSol: energyPerSol(),
    granted: false,
  }

  if (isDemoMode()) return { ...fallback, demo: true }

  const user = await maybeUser(event)
  if (!user) return { ...fallback, demo: false }

  const balance = await grantTrial(user.id)
  return {
    demo: false,
    balance: balance.toString(),
    state: energyStateOf(balance),
    energyPerSol: energyPerSol(),
    granted: true,
  }
})
