/**
 * Security headers.
 *
 * The one that carries weight here is `frame-ancestors`. Kwami has exactly one
 * route that is *meant* to be framed by strangers — `/embed/**` — and every
 * other route must not be, because a framed mint or claim page is a clickjacking
 * primitive for transactions worth real money.
 *
 * `X-Frame-Options` is set alongside CSP for older browsers, but it has no
 * allow-list form, so the embed route omits it entirely and relies on CSP.
 */
export default defineEventHandler((event) => {
  const path = event.path ?? ''
  const isEmbed = path.startsWith('/embed/') || path === '/embed.js'

  if (isEmbed) {
    setResponseHeader(event, 'Content-Security-Policy', 'frame-ancestors *')
    // Embeds are cross-origin by definition; CORP would block the frame itself.
    setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
  } else {
    setResponseHeader(event, 'Content-Security-Policy', "frame-ancestors 'none'")
    setResponseHeader(event, 'X-Frame-Options', 'DENY')
  }

  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  // `strict-origin-when-cross-origin` still leaks the full path to same-origin
  // navigations, which is fine, while sending only the origin outward — so a
  // session URL never reaches a third party.
  setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setResponseHeader(event, 'X-DNS-Prefetch-Control', 'off')

  // The microphone is the whole game; everything else is denied.
  setResponseHeader(
    event,
    'Permissions-Policy',
    'microphone=(self), camera=(), geolocation=(), payment=(self), interest-cohort=()',
  )
})
