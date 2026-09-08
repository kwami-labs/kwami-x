import { z } from 'zod'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { assertNotDemo } from '~~/server/utils/demo'
import { creditTopUp } from '~~/server/utils/energy'
import { energyStateOf } from '#shared/energy/state'

const Body = z.object({
  signature: z.string().min(64).max(120),
})

/**
 * Buy a Kwami more energy.
 *
 * The payment happens first, in the browser, as a plain `SystemProgram.transfer`
 * to the platform treasury — the same shape as the mint commission, and for the
 * same reason: Phantom decodes it and shows the destination and the amount as
 * its own line, where an opaque program call would be invisible.
 *
 * This route only *believes* it afterwards. The signature is fetched from the
 * cluster and the treasury's own balance delta is what gets credited, because a
 * client asserting "I paid" is worth nothing when the reward for lying is free
 * inference. Crediting is idempotent on the signature, so a retry after a lost
 * response cannot double it.
 *
 * Not author-gated. Anyone may fuel anyone's Kwami — there is no way to abuse
 * paying for someone else's running costs, and a Kwami its owner has abandoned
 * being revived by a challenger who wants to keep playing it is a good outcome,
 * not a hole.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  await requireUser(event)
  const mint = getRouterParam(event, 'mint')!
  const body = Body.parse(await readBody(event))

  const db = serviceClient()
  const { data: kwami } = await db.from('kwamis').select('id, state').eq('mint', mint).maybeSingle()
  if (!kwami) throw createError({ statusCode: 404, statusMessage: 'No such Kwami.' })

  // Terminal states are terminal. `credit_kwami_energy` already refuses to move
  // them, but taking the payment first and explaining afterwards would be a
  // strange way to learn a Kwami is dead.
  if (kwami.state === 'dead' || kwami.state === 'cracked') {
    throw createError({
      statusCode: 409,
      statusMessage: 'This Kwami has retired. Energy cannot bring it back.',
    })
  }

  const balance = await creditTopUp(body.signature, kwami.id)

  const { data: after } = await db.from('kwamis').select('state').eq('id', kwami.id).maybeSingle()

  return {
    balance: balance.toString(),
    state: energyStateOf(balance),
    kwamiState: after?.state ?? kwami.state,
  }
})
