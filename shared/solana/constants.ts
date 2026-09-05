/** Solana network configuration shared by client and server. */

export type Cluster = 'mainnet-beta' | 'devnet' | 'localnet'

/** The Kwami vault program. Generated once; the keypair lives in `programs/`. */
export const KWAMI_PROGRAM_ID = 'DoQubWtmNa4WZTLWxe1iptCDrwf81M8LHDrZDP7pEBbL'

/** Circle's USDC mint per cluster. Localnet mints its own in `scripts/bootstrap-localnet.ts`. */
export const USDC_MINT: Record<Cluster, string> = {
  'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  localnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
}

export const DEFAULT_RPC: Record<Cluster, string> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  localnet: 'http://127.0.0.1:8899',
}

/** Explorer link helper — devnet and localnet need the `cluster` query param. */
export function explorerUrl(
  signatureOrAddress: string,
  cluster: Cluster,
  kind: 'tx' | 'address' = 'tx',
): string {
  const base = `https://explorer.solana.com/${kind}/${signatureOrAddress}`
  if (cluster === 'mainnet-beta') return base
  if (cluster === 'devnet') return `${base}?cluster=devnet`
  return `${base}?cluster=custom&customUrl=${encodeURIComponent(DEFAULT_RPC.localnet)}`
}

/** PDA seed prefixes. Kept in one place because Rust and TypeScript must agree byte for byte. */
export const SEEDS = {
  kwami: 'kwami',
  vault: 'vault',
  session: 'session',
  config: 'config',
  extension: 'extension',
} as const
