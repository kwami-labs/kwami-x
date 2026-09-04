import { describe, expect, it } from 'vitest'
import {
  bitmaskToHooks,
  EXTENSION_HOOKS,
  EXTENSION_RULES,
  EXTENSION_TEMPLATE,
  hooksToBitmask,
} from '#shared/builder/extension-abi'

describe('hook bitmask', () => {
  it('round-trips a selection', () => {
    const hooks = ['onSessionStart', 'onDeath']
    expect(bitmaskToHooks(hooksToBitmask(hooks)).sort()).toEqual([...hooks].sort())
  })

  it('is empty for no hooks', () => {
    expect(hooksToBitmask([])).toBe(0)
    expect(bitmaskToHooks(0)).toEqual([])
  })

  it('gives every hook a distinct single bit', () => {
    // Two hooks sharing a bit would silently fire the wrong one on chain.
    const bits = EXTENSION_HOOKS.map((h) => h.bit)
    expect(new Set(bits).size).toBe(bits.length)
    for (const bit of bits) {
      expect(bit & (bit - 1), `${bit} is not a single bit`).toBe(0)
    }
  })

  it('fits in the u8 the Extension account stores', () => {
    expect(hooksToBitmask(EXTENSION_HOOKS.map((h) => h.name))).toBeLessThanOrEqual(255)
  })

  it('ignores names that are not hooks', () => {
    expect(hooksToBitmask(['onSessionStart', 'onNonsense'])).toBe(hooksToBitmask(['onSessionStart']))
  })
})

describe('the extension contract', () => {
  it('declares a template containing every hook the vault calls', () => {
    for (const hook of EXTENSION_HOOKS) {
      expect(EXTENSION_TEMPLATE, hook.instruction).toContain(`pub fn ${hook.instruction}(`)
    }
  })

  it('states the vault-authority prohibition, which is the whole safety argument', () => {
    // The builder shows these rules to the owner beside generated code, so the
    // one that actually bounds the blast radius must be present.
    expect(EXTENSION_RULES.join(' ')).toMatch(/never hold authority over the Kwami vault/i)
    expect(EXTENSION_RULES.join(' ')).toMatch(/checked_\*|saturating_\*/)
  })

  it('gives every hook a description the builder UI can render', () => {
    for (const hook of EXTENSION_HOOKS) {
      expect(hook.description.length, hook.name).toBeGreaterThan(10)
      expect(hook.accounts.length, hook.name).toBeGreaterThan(0)
    }
  })
})
