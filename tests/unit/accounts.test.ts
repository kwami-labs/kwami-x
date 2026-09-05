import { PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import { BorshWriter } from '../../shared/solana/borsh'
import {
  decodeKwamiAccount,
  KWAMI_ACCOUNT_SIZE,
  KWAMI_STATES,
  RESOLUTION_MODES,
  type KwamiChainState,
} from '../../shared/solana/accounts'

const MINT = new PublicKey('So11111111111111111111111111111111111111112')
const AUTHOR = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')
const OWNER = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
const EXTENSION = PublicKey.default

/**
 * Serialise a `Kwami` exactly as Anchor does: an 8-byte discriminator, then the fields of
 * `programs/kwami-vault/src/state.rs` in declaration order, little-endian, no padding.
 *
 * Writing the encoder here rather than importing one is deliberate — it is the independent
 * statement of the layout that makes the decoder's agreement meaningful.
 */
function encodeKwami(over: Partial<{ state: KwamiChainState; resolution: number }> = {}) {
  const stateIndex = KWAMI_STATES.indexOf(over.state ?? 'live')
  return new BorshWriter()
    .fixed(new Uint8Array(8)) // discriminator
    .fixed(MINT.toBytes())
    .fixed(AUTHOR.toBytes())
    .fixed(OWNER.toBytes())
    .fixed(new Uint8Array(32).fill(7)) // secret_hash
    .u64(1_500_000_000n) // ticket_price_lamports
    .u64(2_500_000n) // ticket_price_usdc
    .i64(180n) // session_duration
    .u16(8_000) // payout_bps
    .enum(over.resolution ?? 1) // resolution_mode → attested
    .enum(stateIndex)
    .u64(123_456n) // high_water_mark_cents
    .u64(42n) // sessions_played
    .i64(1_800_000_000n) // pot_locked_until
    .u64(3n) // sessions_won
    .bool(false) // secret_revealed
    .fixed(EXTENSION.toBytes())
    .u8(254) // vault_bump
    .u8(253) // bump
    .toBytes()
}

describe('decodeKwamiAccount', () => {
  it('agrees with the on-chain layout field for field', () => {
    const account = decodeKwamiAccount(encodeKwami())

    expect(account.mint).toBe(MINT.toBase58())
    expect(account.author).toBe(AUTHOR.toBase58())
    expect(account.owner).toBe(OWNER.toBase58())
    expect(account.secretHash).toHaveLength(32)
    expect(account.secretHash[0]).toBe(7)
    expect(account.ticketPriceLamports).toBe(1_500_000_000n)
    expect(account.ticketPriceUsdc).toBe(2_500_000n)
    expect(account.sessionDuration).toBe(180n)
    expect(account.payoutBps).toBe(8_000)
    expect(account.resolutionMode).toBe('attested')
    expect(account.state).toBe('live')
    expect(account.highWaterMarkCents).toBe(123_456n)
    expect(account.sessionsPlayed).toBe(42n)
    expect(account.potLockedUntil).toBe(1_800_000_000n)
    expect(account.sessionsWon).toBe(3n)
    expect(account.secretRevealed).toBe(false)
    expect(account.extension).toBe(PublicKey.default.toBase58())
    expect(account.vaultBump).toBe(254)
    expect(account.bump).toBe(253)
  })

  it('the encoded size matches the declared one, so no field is missing', () => {
    expect(encodeKwami()).toHaveLength(KWAMI_ACCOUNT_SIZE)
  })

  it('reads every lifecycle state', () => {
    for (const state of KWAMI_STATES) {
      expect(decodeKwamiAccount(encodeKwami({ state })).state).toBe(state)
    }
  })

  it('reads both resolution modes', () => {
    for (const [index, mode] of RESOLUTION_MODES.entries()) {
      expect(decodeKwamiAccount(encodeKwami({ resolution: index })).resolutionMode).toBe(mode)
    }
  })

  it('refuses truncated data instead of reading past the end', () => {
    const full = encodeKwami()

    expect(() => decodeKwamiAccount(full.slice(0, full.length - 1))).toThrow(/expected at least/)
    expect(() => decodeKwamiAccount(new Uint8Array(0))).toThrow()
  })

  /**
   * A variant byte the program never writes means the layouts have drifted. Failing here is
   * the point: silently mapping it onto a valid state would let the index publish a Kwami the
   * chain considers dead.
   */
  it('refuses an unknown state discriminant rather than guessing', () => {
    const data = encodeKwami()
    // The state byte sits immediately after resolution_mode.
    const stateOffset = 8 + 32 * 3 + 32 + 8 + 8 + 8 + 2 + 1
    data[stateOffset] = 99

    expect(() => decodeKwamiAccount(data)).toThrow(/Unknown variant 99/)
  })

  it('refuses a non-boolean where a bool is declared', () => {
    const data = encodeKwami()
    const revealedOffset = 8 + 32 * 3 + 32 + 8 + 8 + 8 + 2 + 1 + 1 + 8 + 8 + 8 + 8
    data[revealedOffset] = 2

    expect(() => decodeKwamiAccount(data)).toThrow(/Expected a bool/)
  })
})
