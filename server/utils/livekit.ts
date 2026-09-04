import { createHmac } from 'node:crypto'

/**
 * LiveKit access tokens.
 *
 * Hand-rolled rather than pulling in `livekit-server-sdk`: a LiveKit token is
 * a plain HS256 JWT with a `video` grant claim, and the SDK is several
 * megabytes of room-management API for one signing call.
 *
 * This is the boundary of what lives in this repository. The *agent* — the
 * worker that joins the room, runs STT and TTS, and speaks as the Kwami — is a
 * separate long-running service (see `kwami-lk-agent`), because a Nitro request
 * handler cannot hold a WebRTC session open for three minutes.
 */

export interface TokenGrant {
  room: string
  identity: string
  name?: string
  /** Agents publish and subscribe; players publish and subscribe. Observers only subscribe. */
  canPublish?: boolean
  canSubscribe?: boolean
  ttlSeconds?: number
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/**
 * Mint a LiveKit JWT.
 *
 * The TTL is short by default: the token only has to survive long enough to
 * open the connection, and LiveKit keeps the session alive after that. A
 * long-lived token is a long-lived way into someone else's room.
 */
export function createLiveKitToken(grant: TokenGrant): string {
  const config = useRuntimeConfig()
  const apiKey = config.livekitApiKey
  const apiSecret = config.livekitApiSecret

  if (!apiKey || !apiSecret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'LiveKit is not configured. Set NUXT_LIVEKIT_API_KEY and NUXT_LIVEKIT_API_SECRET.',
    })
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: apiKey,
    sub: grant.identity,
    name: grant.name ?? grant.identity,
    nbf: now,
    exp: now + (grant.ttlSeconds ?? 300),
    video: {
      room: grant.room,
      roomJoin: true,
      canPublish: grant.canPublish ?? true,
      canSubscribe: grant.canSubscribe ?? true,
      // No room admin, ever: a player must not be able to remove the agent
      // from the room they are trying to beat.
      roomAdmin: false,
      roomCreate: false,
    },
  }

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = createHmac('sha256', apiSecret).update(signingInput).digest('base64url')
  return `${signingInput}.${signature}`
}

/** Whether the LiveKit voice path is available, so the client can pick a transport. */
export function isLiveKitConfigured(): boolean {
  const config = useRuntimeConfig()
  return Boolean(config.livekitApiKey && config.livekitApiSecret && config.public.livekitUrl)
}
