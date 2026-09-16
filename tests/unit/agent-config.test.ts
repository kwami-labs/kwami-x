import { describe, expect, it } from 'vitest'
import { buildKwamiPrompt } from '#shared/kwami/prompt'
import {
  BRAIN_MODEL,
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
    expect(buildKwamiPrompt({ ...draft, guardStrength: 0.1 })).toContain('talkative and warm')
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

  it('runs the same model the HTTP brain runs', () => {
    // The worker defaults to gpt-4o-mini. A Kwami that sounds like one
    // character when typed to and another when spoken to is not a character
    // the studio can audition.
    expect(message.voice.llm).toEqual({ provider: 'anthropic', model: BRAIN_MODEL })
  })

  it('declines the generic introduction', () => {
    expect(message.greeting).toBe(false)
  })

  it('keeps a rehearsal out of the shared memory namespace', () => {
    // Without a kwami id the worker files memory under `kwami_default`, which
    // would pool every creator's drafts together.
    expect(message.memory.enabled).toBe(false)
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
