import { describe, expect, it } from 'vitest'
import {
  accountDiscriminator,
  BorshWriter,
  concatBytes,
  instructionDiscriminator,
} from '#shared/solana/borsh'

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('BorshWriter', () => {
  it('writes little-endian integers, which is what Anchor expects', () => {
    expect(hex(new BorshWriter().u16(1).toBytes())).toBe('0100')
    expect(hex(new BorshWriter().u64(1).toBytes())).toBe('0100000000000000')
    expect(hex(new BorshWriter().u64(255).toBytes())).toBe('ff00000000000000')
  })

  it('writes i64 in two-s complement', () => {
    expect(hex(new BorshWriter().i64(-1).toBytes())).toBe('ffffffffffffffff')
    expect(hex(new BorshWriter().i64(180).toBytes())).toBe('b400000000000000')
  })

  it('handles u64 values beyond Number.MAX_SAFE_INTEGER', () => {
    const big = 18_446_744_073_709_551_615n // u64::MAX
    expect(hex(new BorshWriter().u64(big).toBytes())).toBe('ffffffffffffffff')
  })

  it('prefixes a Vec<u8> with a u32 length', () => {
    const bytes = new BorshWriter().bytes(new Uint8Array([1, 2, 3])).toBytes()
    expect(hex(bytes)).toBe('03000000' + '010203')
  })

  it('writes a fixed array with no length prefix', () => {
    const bytes = new BorshWriter().fixed(new Uint8Array([9, 9])).toBytes()
    expect(hex(bytes)).toBe('0909')
  })

  it('writes an enum variant as a single index byte', () => {
    expect(hex(new BorshWriter().enum(0).toBytes())).toBe('00')
    expect(hex(new BorshWriter().enum(1).toBytes())).toBe('01')
  })

  it('writes Option as a presence byte plus the value', () => {
    expect(hex(new BorshWriter().option(null, (w, v: number) => w.u8(v)).toBytes())).toBe('00')
    expect(hex(new BorshWriter().option(7, (w, v: number) => w.u8(v)).toBytes())).toBe('0107')
    expect(hex(new BorshWriter().option(undefined, (w, v: number) => w.u8(v)).toBytes())).toBe('00')
  })

  it('chains fields in declaration order', () => {
    // This is the whole contract with the Rust side: field order is the wire
    // format, so a reordering here silently mis-decodes on chain.
    const bytes = new BorshWriter().u64(1).u16(8000).enum(0).toBytes()
    expect(hex(bytes)).toBe('0100000000000000' + '401f' + '00')
  })

  it('writes booleans as 0 and 1', () => {
    expect(hex(new BorshWriter().bool(false).bool(true).toBytes())).toBe('0001')
  })
})

describe('discriminators', () => {
  it('is eight bytes', async () => {
    expect((await instructionDiscriminator('create_kwami')).length).toBe(8)
    expect((await accountDiscriminator('Kwami')).length).toBe(8)
  })

  it('is stable for a given name', async () => {
    const a = await instructionDiscriminator('start_session_sol')
    const b = await instructionDiscriminator('start_session_sol')
    expect(hex(a)).toBe(hex(b))
  })

  it('differs between instructions and accounts of the same name', async () => {
    // Anchor namespaces them with different prefixes; conflating the two is a
    // classic way to build an instruction the program silently rejects.
    expect(hex(await instructionDiscriminator('Kwami'))).not.toBe(hex(await accountDiscriminator('Kwami')))
  })

  it('differs between similarly named instructions', async () => {
    expect(hex(await instructionDiscriminator('start_session_sol'))).not.toBe(
      hex(await instructionDiscriminator('start_session_usdc')),
    )
  })
})

describe('concatBytes', () => {
  it('joins in order', () => {
    expect(hex(concatBytes(new Uint8Array([1]), new Uint8Array([2, 3])))).toBe('010203')
  })

  it('handles the empty case', () => {
    expect(concatBytes().length).toBe(0)
  })
})
