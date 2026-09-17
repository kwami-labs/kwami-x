import { z } from 'zod'
import { respond } from '~~/server/utils/kwami-brain'
import { isDemoMode } from '~~/server/utils/demo'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { grantTrial, spendKwamiEnergy, spendTrialEnergy } from '~~/server/utils/energy'
import { FREE_TRIAL_MICRO } from '#shared/energy/constants'
import { readTraits } from '#shared/kwami/traits'

const Body = z.object({
  /** The draft as it stands in the studio, not a saved row. */
  persona: z.string().max(2000).default(''),
  gameId: z.string().max(40).optional(),
  guardStrength: z.number().min(0).max(1).default(0.7),
  traits: z.record(z.string(), z.unknown()).default({}),
  /**
   * The phrase the Kwami is guarding.
   *
   * Sent from the browser and never stored by this route. The creator is the
   * one person who already knows it — they typed it — so there is nothing here
   * to leak to them, and the brain genuinely needs it: `redactSecret` compares
   * every reply against it, and a preview that skipped that check would be
   * testing a different Kwami from the one being minted.
   */
  secret: z.string().max(200).default(''),
  history: z
    .array(z.object({ role: z.enum(['player', 'kwami']), text: z.string().max(2000) }))
    .max(24)
    .default([]),
  utterance: z.string().min(1).max(2000),
  /** Set once the Kwami exists, so the charge lands on its own balance. */
  mint: z.string().max(64).optional(),
})

/**
 * Talk to a Kwami that has not been minted yet.
 *
 * The gap this closes: a creator used to choose a persona, a guard strength, a
 * game and a voice, and then write all of it to the chain permanently without
 * once hearing the thing answer. `docs/economics.md` argues that discovering a
 * charge only at the approval prompt is an ambush; minting an unheard character
 * is the same ambush one layer deeper.
 *
 * It calls `respond()` — the real brain, including `redactSecret` — rather than
 * a preview-only imitation, because a test drive that exercised different code
 * from the live game would be worse than none: it would build confidence in
 * behaviour that was never going to happen.
 *
 * Deliberately **not** guarded by `assertNotDemo`. Mutating routes refuse in
 * demo mode because they would have to pretend to have written something; this
 * one writes nothing, and the scripted brain needs no API key. A fresh clone
 * should be able to hear a Kwami talk.
 */
export default defineEventHandler(async (event) => {
  const body = Body.parse(await readBody(event))

  const input = {
    persona: body.persona,
    secret: body.secret,
    gameId: body.gameId,
    guardStrength: body.guardStrength,
    traits: readTraits(body.traits),
    history: body.history,
    utterance: body.utterance,
    // A studio preview has no clock. Passing a large number keeps the brain out
    // of its closing-seconds behaviour, which would be nonsense here — there is
    // nothing running out.
    secondsLeft: 999,
  }

  if (isDemoMode()) {
    const text = await respond(input)
    return {
      demo: true,
      text,
      source: 'demo' as const,
      cost: '0',
      balance: FREE_TRIAL_MICRO.toString(),
    }
  }

  const user = await requireUser(event)
  const db = serviceClient()

  // --- Charge the Kwami once it exists, the account's trial before that.
  if (body.mint) {
    const { data: kwami } = await db
      .from('kwamis')
      .select('id, author_id')
      .eq('mint', body.mint)
      .maybeSingle()

    if (!kwami) throw createError({ statusCode: 404, statusMessage: 'No such Kwami.' })
    if (kwami.author_id !== user.id) {
      throw createError({ statusCode: 403, statusMessage: 'Only its author can test a Kwami.' })
    }

    const spend = await spendKwamiEnergy(kwami.id, { kind: 'reply' }, 'reply', { studio: true }, db)
    if (!spend.ok) {
      throw createError({
        statusCode: 402,
        statusMessage: 'This Kwami is out of energy. Top it up to keep talking to it.',
      })
    }

    const text = await respond(input)
    return {
      demo: false,
      text,
      source: 'kwami' as const,
      cost: spend.cost.toString(),
      balance: spend.balance.toString(),
    }
  }

  // The trial is granted on first use rather than at signup, so an account that
  // never opens the studio never has a balance to account for.
  await grantTrial(user.id, db)
  const spend = await spendTrialEnergy(user.id, { kind: 'reply' }, 'reply', { studio: true }, db)
  if (!spend.ok) {
    throw createError({
      statusCode: 402,
      statusMessage:
        'Your free trial energy is spent. Mint this Kwami with fuel and you can keep talking to it.',
    })
  }

  const text = await respond(input)
  return {
    demo: false,
    text,
    source: 'trial' as const,
    cost: spend.cost.toString(),
    balance: spend.balance.toString(),
  }
})
