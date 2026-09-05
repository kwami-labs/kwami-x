import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import {
  claimWinAttestedIx,
  claimWinRevealIx,
  startSessionSolIx,
  startSessionUsdcIx,
} from '#shared/solana/instructions'
import { findConfigPda } from '#shared/solana/pda'
import type { Asset, TranscriptTurn } from '#shared/types/kwami'

export type PlayPhase =
  'idle' | 'paying' | 'opening' | 'live' | 'won' | 'claiming' | 'claimed' | 'expired' | 'error'

export interface PlayKwami {
  mint: string
  author_wallet: string
  ticket_price_lamports: number
  ticket_price_usdc: number
  session_duration: number
  resolution_mode: string
}

interface ClaimMaterial {
  mode: 'commit-reveal' | 'attested'
  preimage?: string
  signature?: string
  oracle?: string
  validUntil?: number
  message?: string
}

/**
 * A single challenge, start to finish.
 *
 * The whole flow in one composable because its steps are not independent: the
 * ticket signature is what opens the session, the session nonce is what the
 * claim transaction is derived from, and the on-chain start time is what the
 * countdown has to use. Splitting them across stores would mean threading that
 * state through by hand and getting it wrong once.
 */
export function usePlaySession(kwami: Ref<PlayKwami | null>) {
  const wallet = useWalletStore()
  const config = useRuntimeConfig()

  const phase = ref<PlayPhase>('idle')
  const error = ref<string | null>(null)
  const sessionId = ref<string | null>(null)
  const nonce = ref<number>(0)
  const startedAt = ref(0)
  const expiresAt = ref(0)
  const transcript = ref<TranscriptTurn[]>([])
  const claim = ref<ClaimMaterial | null>(null)
  const claimSignature = ref<string | null>(null)
  const winSummary = ref<{ matchedText?: string; score?: number } | null>(null)

  // A local clock so the countdown ticks without a request per second. It is
  // display only — the server and the program both use the on-chain time.
  const now = ref(Math.floor(Date.now() / 1000))
  let clockTimer: ReturnType<typeof setInterval> | null = null

  const secondsLeft = computed(() => Math.max(0, expiresAt.value - now.value))
  const progress = computed(() => {
    const total = expiresAt.value - startedAt.value
    return total > 0 ? Math.max(0, Math.min(1, secondsLeft.value / total)) : 0
  })
  const isLive = computed(() => phase.value === 'live' && secondsLeft.value > 0)

  watch(secondsLeft, (value) => {
    if (value === 0 && phase.value === 'live') phase.value = 'expired'
  })

  function startClock() {
    clockTimer ??= setInterval(() => {
      now.value = Math.floor(Date.now() / 1000)
    }, 250)
  }

  onBeforeUnmount(() => {
    if (clockTimer) clearInterval(clockTimer)
  })

  /**
   * Buy a ticket and open the session.
   *
   * The nonce comes from the Kwami's on-chain session counter, which the
   * program requires to equal the value passed in. That is what stops one
   * player from opening several concurrent sessions against the same Kwami and
   * brute-forcing it in parallel.
   */
  async function buyTicket(asset: Asset, sessionCounter: number) {
    if (!kwami.value) return
    if (!wallet.publicKey) {
      error.value = 'Connect a wallet first.'
      return
    }

    error.value = null
    phase.value = 'paying'

    try {
      const program = new PublicKey(config.public.kwamiProgramId as string)
      const mint = new PublicKey(kwami.value.mint)
      const player = wallet.publicKey
      const [configPda] = findConfigPda(program)
      const treasury = await resolveTreasury(configPda)

      const ix =
        asset === 'SOL'
          ? await startSessionSolIx({
              mint,
              player,
              treasury,
              author: new PublicKey(kwami.value.author_wallet),
              nonce: BigInt(sessionCounter),
              program,
            })
          : await startSessionUsdcIx({
              mint,
              player,
              treasury,
              author: new PublicKey(kwami.value.author_wallet),
              nonce: BigInt(sessionCounter),
              usdcMint: new PublicKey(config.public.usdcMint as string),
              program,
            })

      const connection = wallet.rpc()
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: player,
          recentBlockhash: blockhash,
          instructions: [ix],
        }).compileToV0Message(),
      )

      const signature = await wallet.signAndSend(tx)
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')

      phase.value = 'opening'
      const result = await $fetch<{
        session: { id: string; nonce: number; startedAt: number; expiresAt: number; room: string }
      }>('/api/session/start', {
        method: 'POST',
        body: { mint: kwami.value.mint, signature, nonce: sessionCounter, asset },
      })

      sessionId.value = result.session.id
      nonce.value = result.session.nonce
      startedAt.value = result.session.startedAt
      expiresAt.value = result.session.expiresAt
      phase.value = 'live'
      startClock()
      void wallet.refreshBalances()
    } catch (e) {
      phase.value = 'error'
      error.value = describeWalletError(e)
    }
  }

  /** Send a spoken turn. Returns true if it won. */
  async function submitUtterance(text: string, confidence?: number): Promise<boolean> {
    if (!sessionId.value || !isLive.value) return false
    const at = Math.max(0, Date.now() - startedAt.value * 1000)
    transcript.value.push({ role: 'player', text, at, confidence })

    const result = await $fetch<{
      won: boolean
      score?: number
      matchedText?: string
      nonce?: number
      claim?: ClaimMaterial
    }>(`/api/session/${sessionId.value}/transcript`, {
      method: 'POST',
      body: { role: 'player', text, at, confidence },
    })

    if (result.won && result.claim) {
      claim.value = result.claim
      winSummary.value = { matchedText: result.matchedText, score: result.score }
      phase.value = 'won'
      return true
    }
    return false
  }

  /** Ask the Kwami to answer, and record its reply. */
  async function askKwami(utterance: string): Promise<string | null> {
    if (!sessionId.value) return null
    const at = Math.max(0, Date.now() - startedAt.value * 1000)
    try {
      const { text } = await $fetch<{ text: string }>(`/api/session/${sessionId.value}/reply`, {
        method: 'POST',
        body: { utterance, at },
      })
      transcript.value.push({ role: 'kwami', text, at: Math.max(0, Date.now() - startedAt.value * 1000) })
      return text
    } catch {
      // A brain outage should not look like a failed session — the player's
      // clock is still running and their words still count.
      return null
    }
  }

  /**
   * Take the pot.
   *
   * Runs against the chain, not against this server. By this point the server
   * has already handed over the proof material; if it went offline right now
   * the win would still be claimable from the transaction alone.
   */
  async function claimWin() {
    if (!claim.value || !kwami.value || !wallet.publicKey) return
    error.value = null
    phase.value = 'claiming'

    try {
      const program = new PublicKey(config.public.kwamiProgramId as string)
      const mint = new PublicKey(kwami.value.mint)
      const player = wallet.publicKey
      const usdcMint =
        kwami.value.ticket_price_usdc > 0 ? new PublicKey(config.public.usdcMint as string) : undefined

      const instructions = []

      if (claim.value.mode === 'commit-reveal') {
        instructions.push(
          await claimWinRevealIx({
            mint,
            player,
            nonce: BigInt(nonce.value),
            preimage: new TextEncoder().encode(claim.value.preimage!),
            usdcMint,
            program,
          }),
        )
      } else {
        // Attested mode needs the native ed25519 instruction immediately
        // before the claim, so the program can read back what was verified.
        const { Ed25519Program } = await import('@solana/web3.js')
        const bs58 = (await import('bs58')).default
        instructions.push(
          Ed25519Program.createInstructionWithPublicKey({
            publicKey: new PublicKey(claim.value.oracle!).toBytes(),
            message: Buffer.from(claim.value.message!, 'base64'),
            signature: bs58.decode(claim.value.signature!),
          }),
          await claimWinAttestedIx({
            mint,
            player,
            nonce: BigInt(nonce.value),
            validUntil: BigInt(claim.value.validUntil!),
            usdcMint,
            program,
          }),
        )
      }

      const connection = wallet.rpc()
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: player,
          recentBlockhash: blockhash,
          instructions,
        }).compileToV0Message(),
      )

      const signature = await wallet.signAndSend(tx)
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')

      claimSignature.value = signature
      phase.value = 'claimed'
      void $fetch(`/api/session/${sessionId.value}/claimed`, { method: 'POST', body: { signature } })
      void wallet.refreshBalances()
    } catch (e) {
      phase.value = 'won'
      error.value = describeWalletError(e)
    }
  }

  /** Read the protocol treasury out of the on-chain config account. */
  async function resolveTreasury(configPda: PublicKey): Promise<PublicKey> {
    const account = await wallet.rpc().getAccountInfo(configPda)
    if (!account) throw new Error('Protocol config account not found on this cluster.')
    // Config layout: 8-byte discriminator, authority(32), treasury(32), …
    return new PublicKey(account.data.subarray(40, 72))
  }

  return {
    phase,
    error,
    sessionId,
    nonce,
    startedAt,
    expiresAt,
    secondsLeft,
    progress,
    isLive,
    transcript,
    claim,
    claimSignature,
    winSummary,
    buyTicket,
    submitUtterance,
    askKwami,
    claimWin,
  }
}
