import { PublicKey } from '@solana/web3.js'

/**
 * Decoding for the vault's on-chain accounts.
 *
 * There was no decoder at all, which is why the index could never learn what the chain
 * actually said: publishing sent an instruction and then only refreshed the page, so
 * `kwamis.state` stayed `minted` forever and no honest ticket could be bought. Owner changes
 * had the same problem — `owner_wallet` was written once at draft and never again, so after a
 * marketplace sale the app still showed the seller.
 *
 * The layouts below mirror `programs/kwami-vault/src/state.rs` field for field. Anchor prefixes
 * every account with an 8-byte discriminator and then serialises fields in declaration order,
 * little-endian, with no padding. `tests/unit/accounts.test.ts` round-trips a synthetic account
 * so a change on either side of the boundary fails loudly rather than silently misreading.
 */

/** Anchor's account discriminator length. */
const DISCRIMINATOR = 8
const PUBKEY = 32

/** Mirrors `KwamiState` in state.rs. Order is the discriminant order. */
export const KWAMI_STATES = ['minted', 'live', 'paused', 'cracked', 'dead'] as const
export type KwamiChainState = (typeof KWAMI_STATES)[number]

/** Mirrors `ResolutionMode` in state.rs. */
export const RESOLUTION_MODES = ['commit-reveal', 'attested'] as const
export type ChainResolutionMode = (typeof RESOLUTION_MODES)[number]

export interface KwamiAccount {
  mint: string
  author: string
  owner: string
  secretHash: Uint8Array
  ticketPriceLamports: bigint
  ticketPriceUsdc: bigint
  sessionDuration: bigint
  payoutBps: number
  resolutionMode: ChainResolutionMode
  state: KwamiChainState
  highWaterMarkCents: bigint
  sessionsPlayed: bigint
  potLockedUntil: bigint
  sessionsWon: bigint
  secretRevealed: boolean
  extension: string
  vaultBump: number
  bump: number
}

/** Sequential little-endian reader over an account's data. */
class Reader {
  private offset: number
  private readonly view: DataView

  constructor(
    private readonly data: Uint8Array,
    start: number,
  ) {
    this.offset = start
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  }

  private take(length: number): number {
    const at = this.offset
    if (at + length > this.data.length) {
      throw new Error(`Account data ends at ${this.data.length}, needed ${at + length}`)
    }
    this.offset += length
    return at
  }

  u8(): number {
    return this.view.getUint8(this.take(1))
  }

  bool(): boolean {
    const byte = this.u8()
    if (byte > 1) throw new Error(`Expected a bool, read ${byte}`)
    return byte === 1
  }

  u16(): number {
    return this.view.getUint16(this.take(2), true)
  }

  u64(): bigint {
    return this.view.getBigUint64(this.take(8), true)
  }

  i64(): bigint {
    return this.view.getBigInt64(this.take(8), true)
  }

  fixed(length: number): Uint8Array {
    return this.data.slice(this.take(length), this.offset)
  }

  pubkey(): string {
    return new PublicKey(this.fixed(PUBKEY)).toBase58()
  }

  /** A borsh enum is a single discriminant byte indexing into the declared variants. */
  variant<const T extends readonly string[]>(variants: T): T[number] {
    const index = this.u8()
    const value = variants[index]
    if (value === undefined) {
      throw new Error(`Unknown variant ${index}; expected 0..${variants.length - 1}`)
    }
    return value
  }
}

/** Total size of a serialised `Kwami`, discriminator included. */
export const KWAMI_ACCOUNT_SIZE =
  DISCRIMINATOR + PUBKEY * 3 + 32 + 8 + 8 + 8 + 2 + 1 + 1 + 8 + 8 + 8 + 8 + 1 + PUBKEY + 1 + 1

export function decodeKwamiAccount(data: Uint8Array): KwamiAccount {
  if (data.length < KWAMI_ACCOUNT_SIZE) {
    throw new Error(`Kwami account is ${data.length} bytes, expected at least ${KWAMI_ACCOUNT_SIZE}`)
  }

  const r = new Reader(data, DISCRIMINATOR)
  return {
    mint: r.pubkey(),
    author: r.pubkey(),
    owner: r.pubkey(),
    secretHash: r.fixed(32),
    ticketPriceLamports: r.u64(),
    ticketPriceUsdc: r.u64(),
    sessionDuration: r.i64(),
    payoutBps: r.u16(),
    resolutionMode: r.variant(RESOLUTION_MODES),
    state: r.variant(KWAMI_STATES),
    highWaterMarkCents: r.u64(),
    sessionsPlayed: r.u64(),
    potLockedUntil: r.i64(),
    sessionsWon: r.u64(),
    secretRevealed: r.bool(),
    extension: r.pubkey(),
    vaultBump: r.u8(),
    bump: r.u8(),
  }
}

/** Mirrors `Asset` in state.rs. */
export const ASSETS = ['SOL', 'USDC'] as const
export type ChainAsset = (typeof ASSETS)[number]

/** Mirrors `SessionOutcome` in state.rs. */
export const SESSION_OUTCOMES = ['pending', 'won', 'expired'] as const
export type ChainSessionOutcome = (typeof SESSION_OUTCOMES)[number]

export interface SessionAccount {
  kwami: string
  player: string
  nonce: bigint
  asset: ChainAsset
  /** Gross ticket, before the protocol fee. */
  ticketAmount: bigint
  startedAt: bigint
  expiresAt: bigint
  outcome: ChainSessionOutcome
  payoutLamports: bigint
  payoutUsdc: bigint
  bump: number
}

/** Total size of a serialised `Session`, discriminator included. */
export const SESSION_ACCOUNT_SIZE = DISCRIMINATOR + PUBKEY * 2 + 8 + 1 + 8 + 8 + 8 + 1 + 8 + 8 + 1

/**
 * Decode a `Session`.
 *
 * This account existing, owned by the program, with the right player and nonce, IS the proof
 * that a ticket was paid: the program only ever creates it inside `start_session_sol` or
 * `start_session_usdc`, after the transfers. The server used to accept any transaction that
 * merely listed the session PDA among its account keys — including one that never called the
 * program at all — so a challenger could open a voice session, and reach the Kwami's brain,
 * without paying.
 */
export function decodeSessionAccount(data: Uint8Array): SessionAccount {
  if (data.length < SESSION_ACCOUNT_SIZE) {
    throw new Error(`Session account is ${data.length} bytes, expected at least ${SESSION_ACCOUNT_SIZE}`)
  }

  const r = new Reader(data, DISCRIMINATOR)
  return {
    kwami: r.pubkey(),
    player: r.pubkey(),
    nonce: r.u64(),
    asset: r.variant(ASSETS),
    ticketAmount: r.u64(),
    startedAt: r.i64(),
    expiresAt: r.i64(),
    outcome: r.variant(SESSION_OUTCOMES),
    payoutLamports: r.u64(),
    payoutUsdc: r.u64(),
    bump: r.u8(),
  }
}
