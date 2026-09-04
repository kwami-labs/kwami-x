import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `createLiveKitToken` reads credentials through Nitro's `useRuntimeConfig`
 * auto-import, so the test supplies one. Stubbing the global rather than the
 * module keeps the code under test unmodified — the point is to verify the JWT
 * it actually produces, not a rewired version of it.
 */
const config = {
  livekitApiKey: 'APIkey123',
  livekitApiSecret: 'secret-value-long-enough-to-sign-with',
  public: { livekitUrl: 'wss://example.livekit.cloud' },
}

vi.stubGlobal('useRuntimeConfig', () => config)
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) => {
  const error = new Error(opts.statusMessage) as Error & { statusCode: number }
  error.statusCode = opts.statusCode
  return error
})

const { createLiveKitToken, isLiveKitConfigured } = await import('~~/server/utils/livekit')

function decode(token: string) {
  const [header, payload, signature] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(header!, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payload!, 'base64url').toString()),
    signature: signature!,
  }
}

describe('createLiveKitToken', () => {
  beforeEach(() => {
    config.livekitApiKey = 'APIkey123'
    config.livekitApiSecret = 'secret-value-long-enough-to-sign-with'
  })

  it('produces a three-part HS256 JWT', () => {
    const { header, signature } = decode(createLiveKitToken({ room: 'r', identity: 'i' }))
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(signature.length).toBeGreaterThan(20)
  })

  it('scopes the grant to one room', () => {
    const { payload } = decode(createLiveKitToken({ room: 'kwami-abc-0', identity: 'player-x' }))
    expect(payload.video.room).toBe('kwami-abc-0')
    expect(payload.video.roomJoin).toBe(true)
    expect(payload.sub).toBe('player-x')
    expect(payload.iss).toBe('APIkey123')
  })

  it('never grants room admin, so a player cannot evict the agent', () => {
    // Removing the Kwami's agent from the room would leave a paid session with
    // nothing to talk to — and a challenger with a grievance.
    const { payload } = decode(createLiveKitToken({ room: 'r', identity: 'i' }))
    expect(payload.video.roomAdmin).toBe(false)
    expect(payload.video.roomCreate).toBe(false)
  })

  it('expires quickly by default', () => {
    const { payload } = decode(createLiveKitToken({ room: 'r', identity: 'i' }))
    expect(payload.exp - payload.nbf).toBe(300)
  })

  it('honours an explicit TTL', () => {
    const { payload } = decode(createLiveKitToken({ room: 'r', identity: 'i', ttlSeconds: 60 }))
    expect(payload.exp - payload.nbf).toBe(60)
  })

  it('signs differently for different rooms', () => {
    const a = createLiveKitToken({ room: 'room-a', identity: 'i' })
    const b = createLiveKitToken({ room: 'room-b', identity: 'i' })
    expect(decode(a).signature).not.toBe(decode(b).signature)
  })

  it('refuses to mint a token without credentials', () => {
    config.livekitApiSecret = ''
    expect(() => createLiveKitToken({ room: 'r', identity: 'i' })).toThrow(/not configured/i)
  })
})

describe('isLiveKitConfigured', () => {
  it('is true with a key, a secret and a URL', () => {
    config.livekitApiKey = 'k'
    config.livekitApiSecret = 's'
    expect(isLiveKitConfigured()).toBe(true)
  })

  it('is false when any part is missing, so the client falls back cleanly', () => {
    config.livekitApiKey = ''
    expect(isLiveKitConfigured()).toBe(false)
  })
})
