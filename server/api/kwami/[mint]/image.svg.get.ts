import { DEMO_KWAMIS, isDemoMode } from '~~/server/utils/demo'
import { serviceClient } from '~~/server/utils/supabase'
import { isValidAddress } from '~~/server/utils/solana'

/**
 * The NFT's static image.
 *
 * Generated as SVG rather than stored as a PNG because it has to say something
 * *current*: the pot, and how close to death the Kwami is. A file uploaded at
 * mint would show a $0 pot forever, which is the least interesting moment in a
 * Kwami's life.
 *
 * SVG also means no image pipeline, no object storage and no bill — every
 * client that renders an NFT thumbnail renders SVG.
 *
 * The palette is derived from the mint with the same hash the app uses, so the
 * thumbnail, the card and the live 3D object are recognisably the same being.
 */
export default defineEventHandler(async (event) => {
  const mint = getRouterParam(event, 'mint')
  if (!mint) throw createError({ statusCode: 400, statusMessage: 'Missing mint.' })

  const kwami = isDemoMode() ? DEMO_KWAMIS.find((k) => k.mint === mint) : await loadKwami(mint)
  if (!kwami) throw createError({ statusCode: 404, statusMessage: 'No such Kwami.' })

  const { a, b } = paletteFromMint(mint)
  const potUsd = kwami.value_cents / 100
  const vitality = Math.max(0, Math.min(1, kwami.vitality))
  // Match the app's square-root vitality scale, so a dying Kwami looks as
  // close to death here as it does on its own page.
  const ring = Math.sqrt(vitality)
  const dead = kwami.state === 'dead'

  setResponseHeader(event, 'Content-Type', 'image/svg+xml; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*')

  const circumference = 2 * Math.PI * 178

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="core" cx="42%" cy="38%" r="70%">
      <stop offset="0" stop-color="${a}" stop-opacity="${dead ? 0.35 : 1}"/>
      <stop offset="1" stop-color="${b}" stop-opacity="${dead ? 0.15 : 0.85}"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0.55" stop-color="${a}" stop-opacity="${dead ? 0.04 : 0.22}"/>
      <stop offset="1" stop-color="${a}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>

  <rect width="512" height="512" fill="#07080c"/>
  <circle cx="256" cy="232" r="200" fill="url(#halo)"/>
  <circle cx="256" cy="232" r="104" fill="url(#core)" filter="url(#soft)" opacity="0.9"/>
  <circle cx="256" cy="232" r="92" fill="url(#core)"/>

  <circle cx="256" cy="232" r="178" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="6"/>
  <circle cx="256" cy="232" r="178" fill="none"
          stroke="${dead ? '#ff5c72' : vitality < 0.25 ? '#ffab4a' : b}"
          stroke-width="6" stroke-linecap="round"
          stroke-dasharray="${(circumference * ring).toFixed(1)} ${circumference.toFixed(1)}"
          transform="rotate(-90 256 232)"/>

  <text x="256" y="452" text-anchor="middle" fill="#eef0f6"
        font-family="ui-sans-serif, system-ui, sans-serif" font-size="30" font-weight="600">
    ${escapeXml(kwami.name)}
  </text>
  <text x="256" y="486" text-anchor="middle" fill="${dead ? '#656c80' : '#f5c451'}"
        font-family="ui-monospace, monospace" font-size="22">
    ${dead ? 'dead' : `$${potUsd.toFixed(2)} pot`}
  </text>
</svg>`
})

async function loadKwami(mint: string) {
  if (!isValidAddress(mint)) throw createError({ statusCode: 400, statusMessage: 'Malformed mint address.' })
  const { data } = await serviceClient().from('kwamis_public').select('*').eq('mint', mint).maybeSingle()
  return data
}

/** The same hash the client uses, so a Kwami looks like itself everywhere. */
function paletteFromMint(mint: string): { a: string; b: string } {
  let hash = 0
  for (let i = 0; i < mint.length; i++) hash = (hash * 31 + mint.charCodeAt(i)) >>> 0
  const hueA = hash % 360
  return { a: `hsl(${hueA} 78% 62%)`, b: `hsl(${(hueA + 140) % 360} 72% 58%)` }
}

/** Kwami names are user-supplied and land inside an XML document. */
function escapeXml(value: string): string {
  return value.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c,
  )
}
