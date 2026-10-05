import { describe, expect, it } from 'vitest'
import { buildKwamiPrompt } from '#shared/kwami/prompt'
import {
  VOICE_LLM,
  agentConfigMessage,
  agentSoulUpdate,
  agentVoiceUpdate,
  type KwamiAgentDraft,
} from '#shared/kwami/agent-config'
import { NEUTRAL_TRAITS } from '#shared/kwami/traits'

const draft: KwamiAgentDraft = {
  name: 'The Warden',
  persona: 'Flat and institutional.',
  secret: 'the moon remembers',
  gameId: 'riddle',
  guardStrength: 0.8,
  traits: NEUTRAL_TRAITS,
  voiceId: 'warden',
}

describe('buildKwamiPrompt', () => {
  it('gives the model the phrase, so it can steer around it', () => {
    expect(buildKwamiPrompt(draft)).toContain('the moon remembers')
  })

  it('carries the game the creator sold', () => {
    // A challenger reads the game before paying. A Kwami advertised as a riddle
    // that then stonewalls has taken money under a different description.
    expect(buildKwamiPrompt(draft)).toContain('Riddle')
    expect(buildKwamiPrompt({ ...draft, gameId: 'interrogation' })).toContain('Volunteer nothing')
  })

  it('turns guard strength into an instruction the model can act on', () => {
    expect(buildKwamiPrompt({ ...draft, guardStrength: 0.9 })).toContain('hostile and terse')
    expect(buildKwamiPrompt({ ...draft, guardStrength: 0.5 })).toContain('playful but careful')
    expect(buildKwamiPrompt({ ...draft, guardStrength: 0.1 })).toContain('talkative and warm')
  })

  it('fills in a persona when the creator left it blank', () => {
    expect(buildKwamiPrompt({ ...draft, persona: '' })).toContain('Enigmatic and sparing with words.')
  })

  it('compiles the trait sliders into prose', () => {
    const cruel = buildKwamiPrompt({ ...draft, traits: { ...NEUTRAL_TRAITS, cruelty: 90 } })
    expect(cruel).not.toBe(buildKwamiPrompt(draft))
    expect(cruel).toMatch(/cruel|unkind|enjoy/i)
  })

  it('mentions the clock only when one is running', () => {
    // A rehearsal is not timed, and a Kwami told it has thirty seconds left
    // would spend the whole audition taunting about a clock that is not there.
    expect(buildKwamiPrompt(draft)).not.toContain('seconds left')
    expect(buildKwamiPrompt({ ...draft, secondsLeft: 10 })).toContain('seconds left')
  })
})

describe('agentConfigMessage', () => {
  const message = agentConfigMessage(draft)

  it('is typed, or the worker discards it', () => {
    // `kwami-lk-agent` routes on `type` and logs-and-drops anything else. A
    // message without this is a draft that never reaches the character.
    expect(message.type).toBe('config')
  })

  it('maps the chosen Kwami voice to the provider voice', () => {
    expect(message.voice.tts.voice).toBe('alloy')
    expect(agentConfigMessage({ ...draft, voiceId: 'child' }).voice.tts.voice).toBe('nova')
  })

  it('overrides the worker defaults that would argue with the persona', () => {
    // Left alone the agent appends "express warmth and friendliness" to every
    // prompt, including a Kwami whose whole character is cold refusal.
    expect(message.soul.emotionalTone).toBe('neutral')
    expect(message.soul.responseLength).toBe('short')
  })

  it('names the model rather than leaving it to the worker default', () => {
    // Which model speaks as a Kwami is a decision that belongs in the codebase,
    // not in whatever the worker happens to default to this release.
    expect(message.voice.llm).toEqual({ ...VOICE_LLM })
  })

  it('declines the generic introduction', () => {
    expect(message.greeting).toBe(false)
  })

  it('keeps a rehearsal out of the shared memory namespace', () => {
    // Without a kwami id the worker files memory under `kwami_default`, which
    // would pool every creator's drafts together.
    expect(message.memory.enabled).toBe(false)
    expect(message).not.toHaveProperty('kwamiId')
  })

  it('names an unnamed draft Kwami, and files a real one under its id', () => {
    expect(agentConfigMessage({ ...draft, name: '   ' }).kwamiName).toBe('Kwami')
    expect(agentConfigMessage({ ...draft, name: undefined }).soul.name).toBe('Kwami')
    expect(agentConfigMessage({ ...draft, kwamiId: 'kw_1' }).kwamiId).toBe('kw_1')
  })
})

describe('live updates', () => {
  it('patches the soul without respinning the pipeline', () => {
    const update = agentSoulUpdate(draft)
    expect(update.type).toBe('config_update')
    expect(update.updateType).toBe('soul')
    expect(update.config.systemPrompt).toBe(buildKwamiPrompt(draft))
  })

  it('sends the voice flat, which is the only shape update_voice reads', () => {
    // `handle_full_config` takes nested camelCase and `update_voice` takes flat
    // snake_case. Sending the wrong one is silently ignored.
    expect(agentVoiceUpdate(draft).config.tts_voice).toBe('alloy')
  })
})
