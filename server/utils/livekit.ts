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
  /**
   * The named agent to dispatch into this room.
   *
   * A named agent — `kwami-agent` registers itself as one — joins nothing on
   * its own. It has to be asked, and asking it through the token is how the
   * room and the worker are introduced without this server holding a
   * connection open to LiveKit's dispatch API.
   *
   * Omit it and no agent is dispatched, which is the correct behaviour for a
   * deployment that has LiveKit keys but no worker running.
   */
  agentName?: string
  /**
   * What the agent is told about the room, in one string.
   *
   * An identifier, never the Kwami's secret. This claim is inside a JWT that is
   * handed to the player, who can decode their own token — a secret here would
   * be a secret published to the one person the game exists to keep it from.
   * The agent trades this identifier for the real configuration over
   * `/api/internal/voice/:id`, which is authenticated and server-to-server.
   */
  agentMetadata?: string
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
  const payload: Record<string, unknown> = {
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

  // Field names are the JSON encoding of LiveKit's `RoomConfiguration`
  // protobuf, which is what `livekit-server-sdk` emits for the same claim and
  // what `kwami-lk-api` builds through `RoomAgentDispatch`. camelCase, not the
  // snake_case of the .proto.
  if (grant.agentName) {
    payload.roomConfig = {
      agents: [{ agentName: grant.agentName, metadata: grant.agentMetadata ?? '' }],
    }
  }

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = createHmac('sha256', apiSecret).update(signingInput).digest('base64url')
  return `${signingInput}.${signature}`
}

/**
 * The worker to dispatch, or empty for none.
 *
 * Empty is a supported deployment and not a misconfiguration: LiveKit keys with
 * no worker running gives a room the player can speak into and nothing that
 * answers, which is worse than the browser path. An operator turns the agent on
 * by naming it.
 */
export function livekitAgentName(): string {
  return (useRuntimeConfig().livekitAgentName as string) || ''
}

/** Whether the LiveKit voice path is available, so the client can pick a transport. */
export function isLiveKitConfigured(): boolean {
  const config = useRuntimeConfig()
  return Boolean(config.livekitApiKey && config.livekitApiSecret && config.public.livekitUrl)
}
