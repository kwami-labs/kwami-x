import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { assertNotDemo } from '~~/server/utils/demo'
import { energyPerSol } from '~~/server/utils/energy'
import { energyStateOf } from '#shared/energy/state'

/**
 * A Kwami's energy, and where it went.
 *
 * Author-only, including the ledger. How heavily a Kwami is being talked to is
 * competitive information — the same reasoning that keeps transcripts away from
 * a Kwami's owner, pointed the other way: there, the owner must not learn how
 * challengers attack; here, a rival must not learn how much traffic a Kwami is
 * carrying and price against it.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const mint = getRouterParam(event, 'mint')!

  const db = serviceClient()
  const { data: kwami } = await db
    .from('kwamis')
    .select('id, author_id, energy_micro, energy_updated_at, state')
    .eq('mint', mint)
    .maybeSingle()

  if (!kwami) throw createError({ statusCode: 404, statusMessage: 'No such Kwami.' })
  if (kwami.author_id !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Only its author can read its energy.' })
  }

  const { data: ledger } = await db
    .from('energy_ledger')
    .select('delta_micro, reason, balance_after, tx, created_at')
    .eq('kwami_id', kwami.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const balance = BigInt(kwami.energy_micro)

  return {
    // Strings, because these are `bigint` everywhere else and JSON has no such
    // thing. Sending a number would silently round past 2^53 and the balance is
    // the one figure on this page that has to be exact.
    balance: balance.toString(),
    state: energyStateOf(balance),
    kwamiState: kwami.state,
    updatedAt: kwami.energy_updated_at,
    energyPerSol: energyPerSol(),
    ledger: ledger ?? [],
  }
})
