import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatSiwsMessage, SIWS_STATEMENT, SOLANA_CHAIN_IDS, type SiwsMessage } from '#shared/auth/siws'

/**
 * `verifySignedSiws` is the single gate for both login and wallet bind. The
 * curve check and the nonce store are stubbed so this file exercises the
 * ordering and field checks without talking to storage or an RPC.
 */

const consumeNonce = vi.fn()
const verifySolanaSignature = vi.fn()

vi.mock('~~/server/utils/nonce', () => ({
  consumeNonce: (...args: unknown[]) => consumeNonce(...args),
}))
vi.mock('~~/server/utils/solana', () => ({
  verifySolanaSignature: (...args: unknown[]) => verifySolanaSignature(...args),
}))

vi.stubGlobal('useRuntimeConfig', () => ({
  public: { siteUrl: 'https://x.kwami.io', solanaCluster: 'devnet' },
}))
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) => {
  const error = new Error(opts.statusMessage) as Error & { statusCode: number }
  error.statusCode = opts.statusCode
  return error
})

const { verifySignedSiws } = await import('~~/server/utils/siws-verify')

const ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

const BASE: SiwsMessage = {
  domain: 'x.kwami.io',
  address: ADDRESS,
  statement: SIWS_STATEMENT,
  uri: 'https://x.kwami.io',
  version: '1',
  chainId: SOLANA_CHAIN_IDS.devnet,
  nonce: 'nonce-abc',
  issuedAt: new Date().toISOString(),
}

function signed(overrides: Partial<{ message: string; address: string; signature: string }> = {}) {
  return {
    message: formatSiwsMessage(BASE),
    address: ADDRESS,
    // Any base58 blob — the curve check is mocked.
    signature: '3xJ',
    ...overrides,
  }
}

describe('verifySignedSiws', () => {
  beforeEach(() => {
    consumeNonce.mockReset()
    verifySolanaSignature.mockReset()
    consumeNonce.mockResolvedValue({ ok: true })
    verifySolanaSignature.mockReturnValue(true)
  })

  it('returns the address when every check passes', async () => {
    await expect(verifySignedSiws(signed())).resolves.toEqual({ address: ADDRESS })
    expect(consumeNonce).toHaveBeenCalledWith('nonce-abc', ADDRESS)
    expect(verifySolanaSignature).toHaveBeenCalled()
  })

  it('rejects a malformed message before touching the nonce store', async () => {
    await expect(verifySignedSiws(signed({ message: 'not a siws message' }))).rejects.toMatchObject({
      statusCode: 400,
      message: /malformed/i,
    })
    expect(consumeNonce).not.toHaveBeenCalled()
  })

  it('rejects when the body address disagrees with the signed message', async () => {
    // Trusting the body would let a caller claim someone else's signature.
    await expect(
      verifySignedSiws(signed({ address: 'So11111111111111111111111111111111111111112' })),
    ).rejects.toMatchObject({ statusCode: 400, message: /does not match/i })
    expect(consumeNonce).not.toHaveBeenCalled()
  })

  it('rejects a spent or unknown nonce', async () => {
    consumeNonce.mockResolvedValue({ ok: false, reason: 'Nonce already used.' })
    await expect(verifySignedSiws(signed())).rejects.toMatchObject({
      statusCode: 400,
      message: /already used/i,
    })
    expect(verifySolanaSignature).not.toHaveBeenCalled()
  })

  it('rejects a signature that fails the curve check', async () => {
    verifySolanaSignature.mockReturnValue(false)
    await expect(verifySignedSiws(signed())).rejects.toMatchObject({
      statusCode: 401,
      message: /does not verify/i,
    })
  })

  it('rejects a message farmed on another domain', async () => {
    const foreign = formatSiwsMessage({ ...BASE, domain: 'evil.example' })
    await expect(verifySignedSiws(signed({ message: foreign }))).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('accepts a domain that matches one of several expected hosts', async () => {
    const tunneled = formatSiwsMessage({ ...BASE, domain: 'abc.ngrok-free.app' })
    await expect(
      verifySignedSiws(
        { ...signed({ message: tunneled }), address: ADDRESS },
        { expectedDomains: ['x.kwami.io', 'abc.ngrok-free.app'] },
      ),
    ).resolves.toEqual({ address: ADDRESS })
  })

  it('rejects a message signed for the wrong cluster', async () => {
    const wrongChain = formatSiwsMessage({ ...BASE, chainId: 'mainnet' })
    await expect(verifySignedSiws(signed({ message: wrongChain }))).rejects.toMatchObject({
      statusCode: 400,
      message: /chain id/i,
    })
  })
})
