import { describe, expect, it } from 'vitest'
import { decodeEvents, encodeEvent, stripCodeFence, type CodegenEvent } from '#shared/codegen/activity'
import {
  CODEGEN_MAX_TOKENS,
  CODEGEN_MODELS,
  CODEGEN_THINKING_BUDGET,
  DEFAULT_CODEGEN_MODEL,
  isAdaptiveModel,
  isCodegenModel,
  minOutputTokens,
  normalizeThinking,
  resolveCodegenModel,
} from '#shared/codegen/config'

describe('the model allow-list', () => {
  it('accepts the offered models and nothing else', () => {
    for (const m of CODEGEN_MODELS) expect(isCodegenModel(m)).toBe(true)
    expect(isCodegenModel('claude-3-opus-20240229')).toBe(false)
    expect(isCodegenModel('gpt-4')).toBe(false)
    expect(isCodegenModel('')).toBe(false)
  })

  it('resolves an unknown or missing model to the default', () => {
    // The id arrives in a request body and the call is billed to the
    // deployment's own key, so anything off the list must not reach the API.
    expect(resolveCodegenModel(undefined)).toBe(DEFAULT_CODEGEN_MODEL)
    expect(resolveCodegenModel('some-expensive-model')).toBe(DEFAULT_CODEGEN_MODEL)
    expect(resolveCodegenModel('claude-opus-5')).toBe('claude-opus-5')
  })

  it('offers the default', () => {
    expect(isCodegenModel(DEFAULT_CODEGEN_MODEL)).toBe(true)
  })
})

describe('normalizeThinking', () => {
  it('returns nothing when thinking is off', () => {
    expect(normalizeThinking(false, 'claude-sonnet-5')).toBeUndefined()
  })

  it('asks for summarized reasoning on the adaptive models', () => {
    // The default is 'omitted', which streams empty thinking blocks — the model
    // reasons for half a minute and the builder shows nothing at all.
    expect(normalizeThinking(true, 'claude-sonnet-5')).toEqual({
      type: 'adaptive',
      display: 'summarized',
    })
  })

  it('uses the fixed-budget form on the pre-adaptive models', () => {
    expect(normalizeThinking(true, 'claude-haiku-4-5')).toEqual({
      type: 'enabled',
      budget_tokens: CODEGEN_THINKING_BUDGET,
    })
    expect(isAdaptiveModel('claude-haiku-4-5')).toBe(false)
    expect(isAdaptiveModel('claude-opus-5')).toBe(true)
  })
})

describe('minOutputTokens', () => {
  it('leaves room for the reasoning and an answer', () => {
    // A fixed-budget model 400s outright when max_tokens lands at or under
    // budget_tokens, so the floor has to clear the budget.
    expect(minOutputTokens('claude-haiku-4-5', true)).toBeGreaterThan(CODEGEN_THINKING_BUDGET)
    expect(minOutputTokens('claude-sonnet-5', true)).toBeGreaterThanOrEqual(1024)
  })

  it('is small when thinking is off', () => {
    expect(minOutputTokens('claude-sonnet-5', false)).toBe(512)
  })

  it('always fits inside the token cap', () => {
    for (const m of CODEGEN_MODELS) {
      expect(minOutputTokens(m, true)).toBeLessThan(CODEGEN_MAX_TOKENS)
    }
  })
})

describe('the NDJSON wire format', () => {
  it('round-trips every event kind', () => {
    const events: CodegenEvent[] = [
      { t: 'phase', phase: 'thinking' },
      { t: 'thinking', d: 'considering the escalation curve' },
      { t: 'source', d: 'pub fn on_expire() {}' },
      { t: 'result', id: 'abc', source: 'pub fn main() {}', rules: ['no vault authority'] },
      { t: 'error', message: 'upstream died' },
      { t: 'done' },
    ]
    const wire = events.map(encodeEvent).join('')
    const { events: decoded, rest } = decodeEvents(wire)
    expect(decoded).toEqual(events)
    expect(rest).toBe('')
  })

  it('survives source containing newlines and blank lines', () => {
    // The whole reason this is NDJSON and not SSE: a blank line inside generated
    // Rust would end an SSE frame mid-program.
    const rust = 'use anchor_lang::prelude::*;\n\n#[program]\npub mod ext {\n\n    // hi\n}\n'
    const { events } = decodeEvents(encodeEvent({ t: 'source', d: rust }))
    expect(events).toEqual([{ t: 'source', d: rust }])
  })

  it('holds back a record split across two reads', () => {
    const wire = encodeEvent({ t: 'source', d: 'fn a() {}' }) + encodeEvent({ t: 'done' })
    const cut = wire.indexOf('\n') + 6

    const first = decodeEvents(wire.slice(0, cut))
    expect(first.events).toEqual([{ t: 'source', d: 'fn a() {}' }])
    expect(first.rest).not.toBe('')

    // The remainder is carried into the next read, which is what stops a chunk
    // boundary from swallowing a frame.
    const second = decodeEvents(first.rest + wire.slice(cut))
    expect(second.events).toEqual([{ t: 'done' }])
  })

  it('skips a malformed line rather than abandoning the generation', () => {
    const wire = `{ not json\n${encodeEvent({ t: 'done' })}`
    expect(decodeEvents(wire).events).toEqual([{ t: 'done' }])
  })

  it('ignores blank lines', () => {
    const wire = `\n\n${encodeEvent({ t: 'done' })}\n\n`
    expect(decodeEvents(wire).events).toEqual([{ t: 'done' }])
  })
})

describe('stripCodeFence', () => {
  it('removes a fence the model added despite being told not to', () => {
    // The value is written to the database and later fed to `anchor build`,
    // where a stray fence is a syntax error on line one.
    expect(stripCodeFence('```rust\npub fn a() {}\n```')).toBe('pub fn a() {}')
    expect(stripCodeFence('```\npub fn a() {}\n```')).toBe('pub fn a() {}')
  })

  it('leaves bare source alone', () => {
    expect(stripCodeFence('pub fn a() {}')).toBe('pub fn a() {}')
  })

  it('does not eat a fence in the middle of a doc comment', () => {
    const source = '/// ```ignore\n/// let x = 1;\n/// ```\npub fn a() {}'
    expect(stripCodeFence(source)).toBe(source)
  })

  it('trims surrounding whitespace', () => {
    expect(stripCodeFence('\n\n  pub fn a() {}\n\n')).toBe('pub fn a() {}')
  })
})
