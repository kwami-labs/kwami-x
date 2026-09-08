import { describe, expect, it } from 'vitest'
import {
  isSupabasePublicConfigured,
  isSupabaseServerConfigured,
  resolveSupabaseUrl,
} from '#shared/config/supabase'

describe('resolveSupabaseUrl', () => {
  it('builds the hosted URL from project id', () => {
    expect(resolveSupabaseUrl({ public: { supabaseProjectId: 'svxhshwgdigbsbjczzou' } })).toBe(
      'https://svxhshwgdigbsbjczzou.supabase.co',
    )
  })

  it('prefers an explicit URL (local stack) over project id', () => {
    expect(
      resolveSupabaseUrl({
        public: {
          supabaseUrl: 'http://127.0.0.1:54321',
          supabaseProjectId: 'svxhshwgdigbsbjczzou',
        },
      }),
    ).toBe('http://127.0.0.1:54321')
  })

  it('rejects placeholders', () => {
    expect(resolveSupabaseUrl({ public: { supabaseProjectId: 'your-project' } })).toBe('')
    expect(resolveSupabaseUrl({ public: { supabaseUrl: 'https://your-project.supabase.co' } })).toBe('')
  })
})

describe('isSupabasePublicConfigured / isSupabaseServerConfigured', () => {
  it('requires publishable key on the public side and secret key on the server', () => {
    const base = { public: { supabaseProjectId: 'svxhshwgdigbsbjczzou' } }
    expect(
      isSupabasePublicConfigured({
        ...base,
        public: { ...base.public, supabasePublishableKey: 'sb_publishable_abc' },
      }),
    ).toBe(true)
    expect(
      isSupabasePublicConfigured({
        ...base,
        public: { ...base.public, supabasePublishableKey: 'sb_publishable_...' },
      }),
    ).toBe(false)
    expect(isSupabaseServerConfigured({ ...base, supabaseSecretKey: 'sb_secret_abc' })).toBe(true)
    expect(isSupabaseServerConfigured({ ...base, supabaseSecretKey: 'sb_secret_...' })).toBe(false)
  })
})
