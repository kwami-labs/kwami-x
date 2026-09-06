import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAME_ID,
  DEFAULT_VOICE_CONFIG,
  DEFAULT_VOICE_ID,
  KWAMI_GAMES,
  KWAMI_VOICES,
  gameById,
  readVoiceConfig,
  voiceById,
} from '#shared/kwami/voice'
import { NEUTRAL_TRAITS } from '#shared/kwami/traits'

describe('the offered voices', () => {
  it('has no duplicate ids', () => {
    expect(new Set(KWAMI_VOICES.map((v) => v.id)).size).toBe(KWAMI_VOICES.length)
  })

  it('includes the default', () => {
    expect(KWAMI_VOICES.some((v) => v.id === DEFAULT_VOICE_ID)).toBe(true)
  })

  it('maps every voice to a provider voice', () => {
    for (const v of KWAMI_VOICES) expect(v.openai).toBeTruthy()
  })
})

describe('the offered games', () => {
  it('has no duplicate ids', () => {
    expect(new Set(KWAMI_GAMES.map((g) => g.id)).size).toBe(KWAMI_GAMES.length)
  })

  it('includes the default', () => {
    expect(KWAMI_GAMES.some((g) => g.id === DEFAULT_GAME_ID)).toBe(true)
  })

  it('never instructs a Kwami it may say the phrase', () => {
    // Each directive is concatenated into the system prompt alongside the
    // phrase itself. A mode whose directive licensed revealing it would hand
    // the pot to whoever bought the first ticket.
    for (const g of KWAMI_GAMES) {
      expect(g.directive.toLowerCase()).toContain('never state the phrase')
    }
  })
})

describe('voiceById / gameById', () => {
  it('resolves a known id', () => {
    expect(voiceById('ghost').id).toBe('ghost')
    expect(gameById('riddle').id).toBe('riddle')
  })

  it('falls back rather than returning undefined', () => {
    // These feed a system prompt and a profile page. A crash or an empty label
    // at either call site is a broken paid session.
    expect(voiceById('no-such-voice').id).toBe(DEFAULT_VOICE_ID)
    expect(voiceById(undefined).id).toBe(DEFAULT_VOICE_ID)
    expect(gameById('no-such-game').id).toBe(DEFAULT_GAME_ID)
    expect(gameById(undefined).id).toBe(DEFAULT_GAME_ID)
  })
})

describe('readVoiceConfig', () => {
  it('reads a config the builder wrote', () => {
    expect(
      readVoiceConfig({ voiceId: 'warden', gameId: 'trial', language: 'es', guardStrength: 0.4 }),
    ).toEqual({
      voiceId: 'warden',
      gameId: 'trial',
      language: 'es',
      guardStrength: 0.4,
      traits: NEUTRAL_TRAITS,
    })
  })

  it('fills in for a Kwami minted before voices existed', () => {
    expect(readVoiceConfig({})).toEqual(DEFAULT_VOICE_CONFIG)
    expect(readVoiceConfig(null)).toEqual(DEFAULT_VOICE_CONFIG)
    expect(readVoiceConfig(undefined)).toEqual(DEFAULT_VOICE_CONFIG)
  })

  it('clamps guard strength into range', () => {
    // The value scales how hard the brain deflects and reaches the prompt as a
    // percentage. A stored 5 would read as "500% guarded" on the profile page.
    expect(readVoiceConfig({ guardStrength: 5 }).guardStrength).toBe(1)
    expect(readVoiceConfig({ guardStrength: -3 }).guardStrength).toBe(0)
  })

  it('discards junk rather than passing it through', () => {
    const cfg = readVoiceConfig({ voiceId: 42, gameId: {}, language: '', guardStrength: 'loud' })
    expect(cfg).toEqual(DEFAULT_VOICE_CONFIG)
  })
})

describe('readVoiceConfig traits', () => {
  it('carries a stored trait vector through', () => {
    expect(readVoiceConfig({ traits: { cruelty: 60 } }).traits.cruelty).toBe(60)
  })

  it('neutralises a vector that is not one', () => {
    expect(readVoiceConfig({ traits: 'mean' }).traits).toEqual(NEUTRAL_TRAITS)
  })

  it('keeps the archetype only when there is one, so the key is absent rather than empty', () => {
    expect(readVoiceConfig({ personaId: 'grump' }).personaId).toBe('grump')
    expect('personaId' in readVoiceConfig({})).toBe(false)
    expect('personaId' in readVoiceConfig({ personaId: '' })).toBe(false)
  })
})
