/**
 * Kwami v3 — core domain types.
 *
 * These types are shared between the Nuxt client, the Nitro server and the
 * Vitest suite. They intentionally contain no runtime dependencies so they can
 * be imported from anywhere (including the Anchor IDL glue layer).
 */

/** Assets a Kwami vault can hold. */
export type Asset = 'SOL' | 'USDC'

/**
 * Lifecycle of a Kwami.
 *
 * ```
 * Draft ──mint──▶ Minted ──publish──▶ Live ⇄ Paused
 *                                      │
 *                                      ├──▶ Starving ──top up──▶ Live
 *                                      │
 *                                   cracked
 *                                      ▼
 *                                     Dead
 * ```
 *
 * `starving` is the one transition here that runs backwards. Every other edge
 * is paid for on chain and irreversible; running out of energy is neither, so
 * `withEnergyState` moves a Kwami into it and back out again as the balance
 * crosses zero.
 */
export type KwamiState =
  /** Metadata authored, not yet on chain. */
  | 'draft'
  /** NFT + vault program account exist, not accepting challengers. */
  | 'minted'
  /** Published: anyone may buy a ticket and play. */
  | 'live'
  /** Owner temporarily stopped new sessions; existing ones finish. */
  | 'paused'
  /**
   * Out of energy: it cannot answer, so it is unlisted and sells no tickets.
   * Reversible — a top-up puts it straight back to `live`. Nothing is lost, and
   * in particular the pot is untouched.
   */
  | 'starving'
  /** Secret was revealed on chain (commit-reveal win). No longer playable. */
  | 'cracked'
  /** Vault fell below the death threshold. Permanently retired. */
  | 'dead'

/** How a winning claim is proven on chain. */
export type ResolutionMode =
  /**
   * The player submits the secret pre-image; the program checks
   * `sha256(preimage) == secret_hash`. Fully trustless, but the pre-image
   * becomes public, so the Kwami transitions to `cracked` after a win.
   */
  | 'commit-reveal'
  /**
   * A registered oracle signs a win attestation (ed25519) that the program
   * verifies. The secret stays private, so the Kwami can be played forever,
   * at the cost of trusting the oracle.
   */
  | 'attested'

/** Result of a single challenge session. */
export type SessionOutcome = 'pending' | 'won' | 'lost' | 'expired' | 'aborted'

/** The immutable, on-chain half of a Kwami. */
export interface KwamiOnChain {
  /** NFT mint address (Metaplex Core asset). */
  mint: string
  /** Vault PDA holding SOL + the USDC token account. */
  vault: string
  /** Current NFT holder — receives author-side economics. */
  owner: string
  /** Wallet that minted it. Never changes. Used for royalties + credits. */
  author: string
  /** `sha256(secret || salt)`, hex. Set once at mint. */
  secretHash: string
  /** Ticket price in lamports (0 disables SOL tickets). */
  ticketPriceLamports: bigint
  /** Ticket price in USDC base units, 6 decimals (0 disables USDC tickets). */
  ticketPriceUsdc: bigint
  /** Session length in seconds. Protocol default is 180 (3 minutes). */
  sessionDurationSecs: number
  /** Winner's share of the pot in basis points. Protocol default 8000 = 80%. */
  payoutBps: number
  /** How wins are proven. */
  resolutionMode: ResolutionMode
  /** Highest total USD value the vault ever reached — the death baseline. */
  highWaterMarkUsd: number
  /** Optional AI-generated sub-program invoked via CPI on each state change. */
  extensionProgram?: string
}

/** The mutable, off-chain half (Supabase) — presentation and discovery. */
export interface KwamiOffChain {
  id: string
  mint: string
  name: string
  tagline: string
  /** Personality prompt fragment fed to the voice agent. */
  persona: string
  /** Renderer id from the `kwami` 3D library. */
  renderer: KwamiRenderer
  /** Renderer tuning (colours, geometry, motion). */
  appearance: Record<string, unknown>
  /** Voice pipeline configuration. */
  voice: KwamiVoiceConfig
  /** Public hints the challenger sees before paying. */
  hints: string[]
  createdAt: string
  updatedAt: string
}

export type KwamiRenderer = 'blob-xyz' | 'crystal-ball' | 'orbital-shards' | 'stars-genesis' | 'black-hole'

/**
 * Voice configuration, as it is actually stored.
 *
 * Re-exported from `shared/kwami/voice.ts` rather than redeclared. It was
 * redeclared once, as `{ llmModel, ttsVoice, sttModel }`, and drifted: nothing
 * ever wrote those three fields, so the type described a shape that existed
 * nowhere while the real one lived in another file under another name.
 */
export type { KwamiVoiceConfigStored as KwamiVoiceConfig } from '../kwami/voice'

/** A Kwami as the UI sees it: on-chain truth + off-chain presentation + live balances. */
export interface Kwami extends KwamiOffChain {
  chain: KwamiOnChain
  state: KwamiState
  balances: VaultBalances
  stats: KwamiStats
}

export interface VaultBalances {
  lamports: bigint
  usdcBaseUnits: bigint
  /** Derived from a price oracle at read time. */
  totalUsd: number
}

export interface KwamiStats {
  sessionsPlayed: number
  sessionsWon: number
  totalTicketsUsd: number
  totalPaidOutUsd: number
  /** Cheapest way to express "how alive is it" — 1.0 at the high-water mark. */
  vitality: number
}

/** A challenge session. */
export interface GameSession {
  id: string
  kwamiMint: string
  /** Challenger wallet. */
  player: string
  /** On-chain session PDA. */
  account: string
  asset: Asset
  ticketAmount: bigint
  ticketUsd: number
  /** Unix seconds. */
  startedAt: number
  /** Unix seconds — `startedAt + sessionDurationSecs`. */
  expiresAt: number
  outcome: SessionOutcome
  /** Payout in base units of `asset`, once won. */
  payout?: { lamports: bigint; usdcBaseUnits: bigint }
  /** LiveKit room used for the voice conversation. */
  room?: string
  transcript: TranscriptTurn[]
}

export interface TranscriptTurn {
  role: 'player' | 'kwami'
  text: string
  /** Milliseconds since session start. */
  at: number
  /** STT confidence, when the provider reports it. */
  confidence?: number
}
