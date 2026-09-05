import { DEMO_KWAMIS, isDemoMode } from '~~/server/utils/demo'
import { serviceClient } from '~~/server/utils/supabase'
import { isValidAddress } from '~~/server/utils/solana'
import type { TokenMetadataJson } from '#shared/solana/token-metadata'

/**
 * The NFT's off-chain metadata document.
 *
 * This is the URI written into the Metaplex metadata account at mint, so it is
 * what Phantom, Magic Eden, Tensor and every other Solana client reads to
 * decide what a Kwami *is*.
 *
 * The interesting field is `animation_url`. Metaplex clients render it in
 * place of the static image where they can, and pointing it at `/embed/<mint>`
 * rather than a `.glb` file means the Kwami shown in a wallet is the live one:
 * its real pot, its real vitality, deflating as it dies. A model file would be
 * a snapshot of a thing whose whole point is that it changes.
 *
 * Deliberately public and uncached-by-default at the CDN edge: a marketplace
 * that cached this for an hour would show a stale pot, and the pot is the
 * headline number.
 */
export default defineEventHandler(async (event): Promise<TokenMetadataJson> => {
  const mint = getRouterParam(event, 'mint')
  if (!mint) throw createError({ statusCode: 400, statusMessage: 'Missing mint.' })

  const config = useRuntimeConfig()
  const site = config.public.siteUrl as string

  const kwami = isDemoMode() ? DEMO_KWAMIS.find((k) => k.mint === mint) : await loadKwami(mint)

  if (!kwami) throw createError({ statusCode: 404, statusMessage: 'No such Kwami.' })

  // Wallets poll this; a short TTL keeps the pot roughly current without
  // letting a popular Kwami's page hammer the database.
  setResponseHeader(event, 'Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*')

  const prizeUsd = (kwami.value_cents * (kwami.payout_bps / 10_000)) / 100

  return {
    name: kwami.name,
    symbol: 'KWAMI',
    description: [
      kwami.tagline,
      '',
      `This Kwami guards a secret phrase and a pot worth $${(kwami.value_cents / 100).toFixed(2)}.`,
      `Talk to it for ${Math.round(kwami.session_duration / 60)} minutes. Say the phrase and take ${kwami.payout_bps / 100}% — currently $${prizeUsd.toFixed(2)}.`,
      '',
      `Play it at ${site}/kwami/${mint}`,
    ]
      .filter((line) => line !== undefined)
      .join('\n'),

    image: `${site}/api/kwami/${mint}/image.svg`,
    // The live 3D Kwami, not a snapshot of one.
    animation_url: `${site}/embed/${mint}?chrome=off`,
    external_url: `${site}/kwami/${mint}`,

    attributes: [
      { trait_type: 'Form', value: kwami.renderer },
      { trait_type: 'State', value: kwami.state },
      { trait_type: 'Resolution', value: kwami.resolution_mode },
      { trait_type: 'Payout', value: `${kwami.payout_bps / 100}%` },
      { trait_type: 'Session', value: `${kwami.session_duration}s` },
      { trait_type: 'Attempts', value: kwami.sessions_played },
      { trait_type: 'Times beaten', value: kwami.sessions_won },
      // Marketplaces sort on numeric traits, so the pot is exposed as a number
      // rather than a formatted string.
      { trait_type: 'Pot (USD)', value: Number((kwami.value_cents / 100).toFixed(2)) },
      { trait_type: 'Vitality', value: Number((kwami.vitality * 100).toFixed(1)) },
    ],

    properties: {
      category: 'html',
      files: [
        { uri: `${site}/api/kwami/${mint}/image.svg`, type: 'image/svg+xml' },
        { uri: `${site}/embed/${mint}?chrome=off`, type: 'text/html' },
      ],
      creators: [{ address: kwami.author_wallet, share: 100 }],
    },
  }
})

async function loadKwami(mint: string) {
  if (!isValidAddress(mint)) throw createError({ statusCode: 400, statusMessage: 'Malformed mint address.' })
  const { data, error } = await serviceClient()
    .from('kwamis_public')
    .select('*')
    .eq('mint', mint)
    .maybeSingle()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return data
}
