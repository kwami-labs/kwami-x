import { z } from 'zod'
import { EXTENSION_RULES, EXTENSION_TEMPLATE, hooksToBitmask } from '#shared/builder/extension-abi'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { assertNotDemo } from '~~/server/utils/demo'

const Body = z.object({
  kwamiMint: z.string(),
  name: z.string().min(2).max(64),
  brief: z.string().min(10).max(2000),
  hooks: z.array(z.string()).min(1),
})

/**
 * Generate an Anchor sub-program from a plain-language brief.
 *
 * The model writes Rust; a human deploys it. That separation is not a
 * limitation to be engineered away — a generated program that moves other
 * people's money should be read by its owner before it goes anywhere near a
 * cluster, and the vault's own guarantees are what stop a bad extension from
 * being catastrophic rather than merely broken.
 *
 * `EXTENSION_RULES` is sent to the model and shown to the owner beside the
 * result, so the person approving the deploy is checking the same list the
 * generator was working from.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const body = Body.parse(await readBody(event))
  const config = useRuntimeConfig()

  if (!config.anthropicApiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The program builder needs NUXT_ANTHROPIC_API_KEY.',
    })
  }

  const db = serviceClient()
  const { data: kwami } = await db
    .from('kwamis')
    .select('id, name, author_id, state, payout_bps, session_duration')
    .eq('mint', body.kwamiMint)
    .maybeSingle()

  if (!kwami) throw createError({ statusCode: 404, statusMessage: 'No such Kwami.' })
  if (kwami.author_id !== user.id) throw createError({ statusCode: 403, statusMessage: 'Not your Kwami.' })
  if (kwami.state !== 'minted') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Extensions can only be attached before a Kwami first goes live.',
    })
  }

  const { data: record, error: insertError } = await db
    .from('kwami_programs')
    .insert({
      kwami_id: kwami.id,
      author_id: user.id,
      name: body.name,
      brief: body.brief,
      status: 'generating',
      hooks: hooksToBitmask(body.hooks),
    })
    .select('id')
    .single()
  if (insertError) throw createError({ statusCode: 500, statusMessage: insertError.message })

  const system = `You write Solana programs with Anchor 0.31 for the Kwami protocol.

A Kwami is an NFT that owns a pot. Challengers pay a ticket for a timed voice session and win ${kwami.payout_bps / 100}% of the pot if they say its secret phrase. You are writing an *extension*: a separate program the Kwami vault calls by CPI at lifecycle moments, which adds game mechanics on top of that base loop.

Hard rules, all of which are non-negotiable:
${EXTENSION_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Start from this scaffold and extend it. Keep the hook signatures exactly as given — the vault calls them by discriminator:

${EXTENSION_TEMPLATE}

Output format: return ONLY Rust source, no markdown fences and no commentary. Comment the code where a reader would otherwise have to guess *why* a rule works the way it does. Do not comment the obvious.`

  try {
    const response = await $fetch<{ content: Array<{ type: string; text?: string }> }>(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': config.anthropicApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: {
          model: 'claude-sonnet-5',
          max_tokens: 8000,
          system,
          messages: [
            {
              role: 'user',
              content: `Kwami: "${kwami.name}". Hooks to implement: ${body.hooks.join(', ')}.\n\nThe game the owner wants:\n${body.brief}`,
            },
          ],
        },
      },
    )

    const source = response.content
      .find((c) => c.type === 'text')
      ?.text?.replace(/^```(?:rust)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim()

    if (!source) throw new Error('The model returned no source.')

    await db.from('kwami_programs').update({ source, status: 'built' }).eq('id', record.id)

    return { id: record.id, source, rules: EXTENSION_RULES, status: 'built' }
  } catch (e) {
    await db
      .from('kwami_programs')
      .update({ status: 'failed', build_log: (e as Error).message })
      .eq('id', record.id)
    throw createError({ statusCode: 502, statusMessage: `Generation failed: ${(e as Error).message}` })
  }
})
