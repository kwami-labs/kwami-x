import { describe, expect, it } from 'vitest'
import { isConfigured } from '#shared/config/configured'

describe('isConfigured', () => {
  it('rejects empty and non-string values', () => {
    expect(isConfigured(undefined)).toBe(false)
    expect(isConfigured(null)).toBe(false)
    expect(isConfigured(1)).toBe(false)
    expect(isConfigured('')).toBe(false)
    expect(isConfigured('   ')).toBe(false)
  })

  it('rejects the .env.example placeholders that a fresh clone would copy', () => {
    // Without this, `cp .env.example .env` puts demo Kwamis behind a sign-in
    // wall that can never open — the server thinks credentials exist.
    expect(isConfigured('https://your-project.supabase.co')).toBe(false)
    expect(isConfigured('your-project')).toBe(false)
    expect(isConfigured('wss://your-server.livekit.cloud')).toBe(false)
    expect(isConfigured('sk_test_...')).toBe(false)
    expect(isConfigured('pk_publishable_...')).toBe(false)
    expect(isConfigured('sb_secret_...')).toBe(false)
    expect(isConfigured('sb_publishable_...')).toBe(false)
    expect(isConfigured('https://example.supabase.co...')).toBe(false)
  })

  it('accepts a real-looking value', () => {
    expect(isConfigured('https://abcdefgh.supabase.co')).toBe(true)
    expect(isConfigured('svxhshwgdigbsbjczzou')).toBe(true)
    expect(isConfigured('sb_publishable_4wXFhbrzw6PDUUtDRuWi')).toBe(true)
    expect(isConfigured('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig')).toBe(true)
  })
})
