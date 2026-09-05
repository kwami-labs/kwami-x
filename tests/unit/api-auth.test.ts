import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiFetch } from '../../app/utils/api'

/**
 * `createApiFetch` is built on Nuxt's auto-imported `$fetch` (ofetch). Under
 * Vitest there is no Nuxt runtime, so the global is supplied here — with the
 * real `ofetch`, not a stub, because the whole point of these tests is that the
 * `onRequest` hook ofetch actually runs does the right thing.
 */
const { ofetch } = await import('ofetch')

/** Requests the fake transport saw, in order. */
let seen: Array<{ url: string; authorization: string | null }> = []

beforeEach(() => {
  seen = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      seen.push({ url: String(input), authorization: headers.get('authorization') })
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
    }),
  )
  vi.stubGlobal('$fetch', ofetch)
})

describe('createApiFetch', () => {
  it('attaches the bearer token to an API call', async () => {
    // Without this, every route behind `requireUser` answers 401 to a browser
    // signed in by email, phone, Google or GitHub — Supabase keeps the session
    // in local storage, so nothing is sent automatically.
    const api = createApiFetch(() => 'tok_123')
    await api('/api/session/start', { method: 'POST', body: {} })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.authorization).toBe('Bearer tok_123')
  })

  it('sends nothing when there is no session', async () => {
    const api = createApiFetch(() => undefined)
    await api('/api/kwami/draft', { method: 'POST', body: {} })
    expect(seen[0]!.authorization).toBeNull()

    const nullToken = createApiFetch(() => null)
    await nullToken('/api/kwami/draft', { method: 'POST', body: {} })
    expect(seen[1]!.authorization).toBeNull()
  })

  it('never sends the token to a third-party host', async () => {
    // The token is a bearer credential: anything holding it can act as the
    // user. A URL that is not a same-origin API path must not carry it, however
    // it reached the call.
    const api = createApiFetch(() => 'tok_123')
    await api('https://api.moonpay.com/v3/currencies')
    await api('//evil.example/api/steal')
    await api('api/relative')

    for (const request of seen) expect(request.authorization).toBeNull()
  })

  it('leaves an explicitly set authorization header alone', async () => {
    // An interceptor you cannot opt out of is a trap; a call that sets the
    // header is saying something specific.
    const api = createApiFetch(() => 'tok_123')
    await api('/api/session/start', { method: 'POST', headers: { authorization: 'Bearer other' } })
    expect(seen[0]!.authorization).toBe('Bearer other')
  })

  it('reads the token at request time, not at construction', async () => {
    // One instance is created in `setup` and outlives a sign-in, a sign-out and
    // every silent refresh in between.
    let token: string | undefined
    const api = createApiFetch(() => token)

    await api('/api/kwami/draft')
    expect(seen[0]!.authorization).toBeNull()

    token = 'tok_after_signin'
    await api('/api/kwami/draft')
    expect(seen[1]!.authorization).toBe('Bearer tok_after_signin')

    token = undefined
    await api('/api/kwami/draft')
    expect(seen[2]!.authorization).toBeNull()
  })
})
