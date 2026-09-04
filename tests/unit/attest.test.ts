import { describe, expect, it } from 'vitest'
import { Keypair, PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import { attestationMessage } from '~~/server/utils/attest'

const SESSION = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')
const PLAYER = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
const VALID_UNTIL = 1_800_000_300

describe('attestationMessage', () => {
  it('matches the Rust layout: tag ‖ session ‖ player ‖ i64 LE deadline', () => {
    // A disagreement with `WinAttestation::message` produces a signature the
    // program rejects, with no error explaining why — so the layout is pinned
    // here field by field rather than as an opaque hash.
    const message = attestationMessage(SESSION.toBase58(), PLAYER.toBase58(), VALID_UNTIL)

    expect(message.length).toBe(80)
    expect(new TextDecoder().decode(message.subarray(0, 8))).toBe('KWAMIWIN')
    expect(Array.from(message.subarray(8, 40))).toEqual(Array.from(SESSION.toBytes()))
    expect(Array.from(message.subarray(40, 72))).toEqual(Array.from(PLAYER.toBytes()))
    expect(new DataView(message.buffer).getBigInt64(72, true)).toBe(BigInt(VALID_UNTIL))
  })

  it('binds the session, so a signature cannot be replayed against another', () => {
    const other = Keypair.generate().publicKey.toBase58()
    const a = attestationMessage(SESSION.toBase58(), PLAYER.toBase58(), VALID_UNTIL)
    const b = attestationMessage(other, PLAYER.toBase58(), VALID_UNTIL)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('binds the player, so a signature cannot be redeemed by another wallet', () => {
    const other = Keypair.generate().publicKey.toBase58()
    const a = attestationMessage(SESSION.toBase58(), PLAYER.toBase58(), VALID_UNTIL)
    const b = attestationMessage(SESSION.toBase58(), other, VALID_UNTIL)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('binds the deadline, so a signature cannot be held indefinitely', () => {
    const a = attestationMessage(SESSION.toBase58(), PLAYER.toBase58(), VALID_UNTIL)
    const b = attestationMessage(SESSION.toBase58(), PLAYER.toBase58(), VALID_UNTIL + 1)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('is deterministic', () => {
    const a = attestationMessage(SESSION.toBase58(), PLAYER.toBase58(), VALID_UNTIL)
    const b = attestationMessage(SESSION.toBase58(), PLAYER.toBase58(), VALID_UNTIL)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('rejects a malformed address rather than signing over garbage', () => {
    expect(() => attestationMessage('not-an-address', PLAYER.toBase58(), VALID_UNTIL)).toThrow()
  })

  it('produces a signature that verifies under the oracle key', () => {
    const oracle = Keypair.generate()
    const message = attestationMessage(SESSION.toBase58(), PLAYER.toBase58(), VALID_UNTIL)
    const signature = nacl.sign.detached(message, oracle.secretKey)

    expect(nacl.sign.detached.verify(message, signature, oracle.publicKey.toBytes())).toBe(true)

    // And does not verify under a different key, which is the property the
    // program's `require!(signer == oracle)` check depends on.
    const impostor = Keypair.generate()
    expect(nacl.sign.detached.verify(message, signature, impostor.publicKey.toBytes())).toBe(false)
  })
})
