import { describe, expect, it } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { DEFAULT_RPC, explorerUrl, KWAMI_PROGRAM_ID, SEEDS, USDC_MINT } from '#shared/solana/constants'

describe('cluster configuration', () => {
  it('declares a valid program id', () => {
    expect(() => new PublicKey(KWAMI_PROGRAM_ID)).not.toThrow()
  })

  it('declares a valid USDC mint and RPC for every cluster', () => {
    for (const cluster of ['mainnet-beta', 'devnet', 'localnet'] as const) {
      expect(() => new PublicKey(USDC_MINT[cluster]), cluster).not.toThrow()
      expect(DEFAULT_RPC[cluster], cluster).toMatch(/^https?:\/\//)
    }
  })

  it('uses the real Circle mint on mainnet', () => {
    expect(USDC_MINT['mainnet-beta']).not.toBe(USDC_MINT.devnet)
  })
})

describe('explorerUrl', () => {
  it('needs no query param on mainnet', () => {
    expect(explorerUrl('sig', 'mainnet-beta')).toBe('https://explorer.solana.com/tx/sig')
  })

  it('tags devnet, or the link silently resolves against mainnet', () => {
    expect(explorerUrl('sig', 'devnet')).toContain('cluster=devnet')
  })

  it('points localnet at the local validator', () => {
    const url = explorerUrl('sig', 'localnet')
    expect(url).toContain('cluster=custom')
    expect(url).toContain(encodeURIComponent('http://127.0.0.1:8899'))
  })

  it('can link an address instead of a transaction', () => {
    expect(explorerUrl('addr', 'mainnet-beta', 'address')).toBe('https://explorer.solana.com/address/addr')
  })
})

describe('PDA seeds', () => {
  it('are distinct, so two account types cannot collide', () => {
    const values = Object.values(SEEDS)
    expect(new Set(values).size).toBe(values.length)
  })

  it('fit inside Solana’s 32-byte seed limit', () => {
    for (const seed of Object.values(SEEDS)) {
      expect(new TextEncoder().encode(seed).length, seed).toBeLessThanOrEqual(32)
    }
  })
})
