/**
 * Minimal Borsh writer and Anchor discriminator helper.
 *
 * `@coral-xyz/anchor` would do this, but it drags in a provider, a wallet
 * abstraction and a large chunk of BN.js — none of which this app wants, since
 * it drives Phantom directly and the instruction set is eleven calls wide. The
 * encoding below is the whole of what Anchor's serialiser does for these
 * argument types.
 */

export class BorshWriter {
  private chunks: Uint8Array[] = []

  u8(value: number): this {
    return this.push(new Uint8Array([value & 0xff]))
  }

  u16(value: number): this {
    const buf = new Uint8Array(2)
    new DataView(buf.buffer).setUint16(0, value, true)
    return this.push(buf)
  }

  u32(value: number): this {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, value, true)
    return this.push(buf)
  }

  u64(value: bigint | number): this {
    const buf = new Uint8Array(8)
    new DataView(buf.buffer).setBigUint64(0, BigInt(value), true)
    return this.push(buf)
  }

  i64(value: bigint | number): this {
    const buf = new Uint8Array(8)
    new DataView(buf.buffer).setBigInt64(0, BigInt(value), true)
    return this.push(buf)
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0)
  }

  /** A fixed-size byte array, written without a length prefix. */
  fixed(bytes: Uint8Array): this {
    return this.push(bytes)
  }

  /** A Borsh `String`: a u32 byte-length followed by UTF-8 bytes. */
  string(value: string): this {
    return this.bytes(new TextEncoder().encode(value))
  }

  /** A `Vec<u8>`: a u32 length followed by the bytes. */
  bytes(value: Uint8Array): this {
    return this.u32(value.length).push(value)
  }

  /** A Rust fieldless enum: one byte holding the variant index. */
  enum(variantIndex: number): this {
    return this.u8(variantIndex)
  }

  /** `Option<T>`: a presence byte, then the value if present. */
  option<T>(value: T | null | undefined, write: (w: this, v: T) => void): this {
    if (value === null || value === undefined) return this.u8(0)
    this.u8(1)
    write(this, value)
    return this
  }

  private push(bytes: Uint8Array): this {
    this.chunks.push(bytes)
    return this
  }

  toBytes(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of this.chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}

/**
 * Anchor's instruction discriminator: the first eight bytes of
 * `sha256("global:" + snake_case_name)`.
 *
 * Async because it uses Web Crypto, which is the one SHA-256 available
 * unchanged in the browser, in Nitro and in Bun. Callers cache the result —
 * these are eleven fixed values, not a hot path.
 */
export async function instructionDiscriminator(name: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(`global:${name}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return new Uint8Array(digest).slice(0, 8)
}

/** The same derivation for account types, which Anchor prefixes with `account:`. */
export async function accountDiscriminator(name: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(`account:${name}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return new Uint8Array(digest).slice(0, 8)
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
