<script setup lang="ts">
import { formatCountdown } from '#shared/game/session'
import type { Asset } from '#shared/types/kwami'
import { createAudioMeter, type AudioMeter } from '~/utils/audio-meter'

const route = useRoute()
const mint = computed(() => route.params.mint as string)

const { data } = await useFetch(`/api/kwami/${mint.value}`)
const kwami = computed(() => data.value?.kwami ?? null)
const demo = computed(() => data.value?.demo ?? false)

const wallet = useWalletStore()
const auth = useAuthStore()
const play = usePlaySession(kwami as never)

const palette = computed(() => paletteFromMint(mint.value))
const chosenAsset = ref<Asset>('SOL')
const micError = ref<string | null>(null)
const level = ref(0)
const caption = ref('')

let meter: AudioMeter | null = null
let levelRaf = 0

const speech = useSpeech({
  onFinal: async (text, confidence) => {
    caption.value = ''
    const won = await play.submitUtterance(text, confidence)
    if (won) {
      speech.stop()
      return
    }
    const reply = await play.askKwami(text)
    if (reply) speak(reply)
  },
  onInterim: (text) => (caption.value = text),
  onError: (message) => (micError.value = message),
})

/** Arousal rises as the clock runs down, so the avatar visibly tightens. */
const arousal = computed(() => {
  if (!play.isLive.value) return 0
  return Math.min(1, 1 - play.progress.value)
})

const urgent = computed(() => play.isLive.value && play.secondsLeft.value <= 30)

async function beginVoice() {
  micError.value = null
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    meter = createAudioMeter(stream)
    const tick = () => {
      level.value = meter?.level() ?? 0
      levelRaf = requestAnimationFrame(tick)
    }
    levelRaf = requestAnimationFrame(tick)
    speech.start()
  } catch {
    micError.value = 'Microphone access was refused. The whole game is voice, so it cannot start without it.'
  }
}

async function onStart() {
  // The Kwami's on-chain session counter is the required nonce; `sessions_played`
  // mirrors it, so an out-of-date index shows up as a rejected transaction
  // rather than a silently wrong session address.
  await play.buyTicket(chosenAsset.value, kwami.value?.sessions_played ?? 0)
  if (play.phase.value === 'live') await beginVoice()
}

watch(
  () => play.phase.value,
  (phase) => {
    if (phase === 'expired' || phase === 'won') {
      speech.stop()
      cancelSpeech()
      stopMeter()
    }
  },
)

function stopMeter() {
  cancelAnimationFrame(levelRaf)
  meter?.stop()
  meter = null
  level.value = 0
}

onBeforeUnmount(() => {
  speech.stop()
  cancelSpeech()
  stopMeter()
})

useSeoMeta({ title: () => (kwami.value ? `Challenge ${kwami.value.name}` : 'Challenge') })
</script>

<template>
  <div v-if="!kwami" class="wrap card"><h2>No such Kwami.</h2></div>

  <div v-else class="wrap play" :class="{ 'play--urgent': urgent }">
    <section class="play__stage">
      <KwamiAvatar
        :renderer="kwami.renderer as never"
        :color-a="palette.a"
        :color-b="palette.b"
        :vitality="kwami.vitality"
        :level="level"
        :arousal="arousal"
      />

      <div v-if="play.isLive.value" class="clock" :class="{ 'clock--urgent': urgent }">
        <svg viewBox="0 0 100 100" class="clock__ring">
          <circle cx="50" cy="50" r="45" class="clock__track" />
          <circle
            cx="50"
            cy="50"
            r="45"
            class="clock__fill"
            :style="{ strokeDashoffset: 283 - 283 * play.progress.value }"
          />
        </svg>
        <span class="num clock__text">{{ formatCountdown(play.secondsLeft.value) }}</span>
      </div>

      <p v-if="caption" class="caption">{{ caption }}</p>
    </section>

    <aside class="play__panel stack gap-3">
      <header class="stack gap-1">
        <h2>{{ kwami.name }}</h2>
        <p class="muted">{{ kwami.tagline }}</p>
      </header>

      <!-- ── Before the ticket ─────────────────────────────────────────── -->
      <div v-if="play.phase.value === 'idle' || play.phase.value === 'error'" class="card stack gap-3">
        <div class="stack gap-1">
          <span class="eyebrow">Prize if you win</span>
          <span class="num num--xl gold">{{ formatCents(kwami.value_cents * (kwami.payout_bps / 10000)) }}</span>
        </div>

        <div v-if="kwami.ticket_price_lamports > 0 && kwami.ticket_price_usdc > 0" class="field">
          <span class="label">Pay with</span>
          <div class="row gap-1">
            <button class="chip" :class="{ 'chip--on': chosenAsset === 'SOL' }" @click="chosenAsset = 'SOL'">
              {{ formatSol(kwami.ticket_price_lamports) }}
            </button>
            <button class="chip" :class="{ 'chip--on': chosenAsset === 'USDC' }" @click="chosenAsset = 'USDC'">
              {{ formatUsdc(kwami.ticket_price_usdc) }}
            </button>
          </div>
        </div>

        <ul class="terms dim">
          <li>{{ Math.round(kwami.session_duration / 60 * 10) / 10 }} minutes of voice, starting the moment the ticket confirms.</li>
          <li>Say its phrase and {{ (kwami.payout_bps / 100).toFixed(0) }}% of the pot is transferred to you.</li>
          <li>Miss and your ticket stays in the pot for whoever comes next.</li>
        </ul>

        <div v-if="demo" class="notice">
          Demo mode — no Supabase or Solana configured, so tickets cannot be bought. See
          <NuxtLink to="/docs/setup" class="gold">setup</NuxtLink>.
        </div>
        <button v-else-if="!wallet.isConnected" class="btn btn--primary btn--block" @click="wallet.connect()">
          Connect Phantom
        </button>
        <button v-else-if="!auth.isSignedIn" class="btn btn--primary btn--block" @click="auth.signInWithPhantom()">
          Sign in with Phantom
        </button>
        <button v-else class="btn btn--gold btn--lg btn--block" @click="onStart">
          Pay
          {{ chosenAsset === 'SOL' ? formatSol(kwami.ticket_price_lamports) : formatUsdc(kwami.ticket_price_usdc) }}
          and start
        </button>

        <p v-if="play.error.value" class="error-text">{{ play.error.value }}</p>
      </div>

      <!-- ── Paying ───────────────────────────────────────────────────── -->
      <div v-else-if="play.phase.value === 'paying' || play.phase.value === 'opening'" class="card stack gap-2">
        <h3>{{ play.phase.value === 'paying' ? 'Confirm in Phantom' : 'Opening the room…' }}</h3>
        <p class="muted">The clock starts when the transaction confirms, not before.</p>
      </div>

      <!-- ── Live ─────────────────────────────────────────────────────── -->
      <div v-else-if="play.phase.value === 'live'" class="card stack gap-2">
        <div class="row gap-2">
          <span class="dot dot--pulse" :style="{ color: speech.listening.value ? 'var(--success)' : 'var(--warn)' }" />
          <span class="grow">{{ speech.listening.value ? 'Listening' : 'Not listening' }}</span>
          <button v-if="!speech.listening.value" class="btn btn--sm" @click="beginVoice">Enable mic</button>
        </div>
        <p v-if="micError" class="error-text">{{ micError }}</p>
        <p v-else-if="!speech.supported.value" class="error-text">
          This browser has no speech recognition. Chrome or Edge will work.
        </p>
        <p v-else class="hint">Talk to it. Say the phrase out loud if you think you have it.</p>
      </div>

      <!-- ── Won ──────────────────────────────────────────────────────── -->
      <div v-else-if="play.phase.value === 'won' || play.phase.value === 'claiming'" class="card stack gap-3 win">
        <div class="stack gap-1">
          <span class="eyebrow gold">You said it</span>
          <h2 class="gold">{{ formatCents(kwami.value_cents * (kwami.payout_bps / 10000)) }}</h2>
          <p class="muted">
            Matched on “<span class="num">{{ play.winSummary.value?.matchedText }}</span>”.
            The pot is not yours until you claim it on chain.
          </p>
        </div>
        <button class="btn btn--gold btn--lg btn--block" :disabled="play.phase.value === 'claiming'" @click="play.claimWin()">
          {{ play.phase.value === 'claiming' ? 'Claiming…' : 'Claim the pot' }}
        </button>
        <p v-if="play.error.value" class="error-text">{{ play.error.value }}</p>
      </div>

      <!-- ── Claimed ──────────────────────────────────────────────────── -->
      <div v-else-if="play.phase.value === 'claimed'" class="card stack gap-2 win">
        <h2 class="gold">Paid.</h2>
        <p class="muted">It is in your wallet.</p>
        <a
          v-if="play.claimSignature.value"
          :href="`https://explorer.solana.com/tx/${play.claimSignature.value}?cluster=devnet`"
          target="_blank"
          rel="noopener"
          class="btn btn--ghost btn--block"
        >
          View the settlement
        </a>
        <NuxtLink to="/" class="btn btn--ghost btn--block">Back to the arena</NuxtLink>
      </div>

      <!-- ── Expired ──────────────────────────────────────────────────── -->
      <div v-else-if="play.phase.value === 'expired'" class="card stack gap-2">
        <h2>Time.</h2>
        <p class="muted">
          Your ticket is in its pot now, which means the next person is playing for more than you were.
        </p>
        <NuxtLink :to="`/kwami/${mint}`" class="btn btn--ghost btn--block">Try again</NuxtLink>
      </div>

      <TranscriptView v-if="play.transcript.value.length" :turns="play.transcript.value" />
    </aside>
  </div>
</template>

<style scoped>
.play {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 26px;
  align-items: start;
}

.play__stage {
  position: relative;
  height: min(72vh, 640px);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--border);
  background: radial-gradient(circle at 50% 55%, rgba(255, 255, 255, 0.05), transparent 70%), var(--bg-sunken);
  transition: border-color 0.4s ease;
}

.play--urgent .play__stage { border-color: rgba(255, 92, 114, 0.4); }

.clock {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 76px;
  height: 76px;
  display: grid;
  place-items: center;
}

.clock__ring { position: absolute; inset: 0; transform: rotate(-90deg); }
.clock__track { fill: none; stroke: rgba(255, 255, 255, 0.1); stroke-width: 5; }

.clock__fill {
  fill: none;
  stroke: var(--accent);
  stroke-width: 5;
  stroke-linecap: round;
  stroke-dasharray: 283;
  transition: stroke-dashoffset 0.3s linear, stroke 0.4s ease;
}

.clock--urgent .clock__fill { stroke: var(--danger); }
.clock__text { font-size: 0.95rem; font-weight: 600; }
.clock--urgent .clock__text { color: var(--danger); }

.caption {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  max-width: 78%;
  margin: 0;
  padding: 9px 16px;
  border-radius: var(--radius-pill);
  background: rgba(4, 5, 10, 0.82);
  border: 1px solid var(--border);
  backdrop-filter: blur(10px);
  font-size: 0.95rem;
  text-align: center;
}

.terms { margin: 0; padding-left: 17px; display: flex; flex-direction: column; gap: 5px; font-size: 0.85rem; }

.notice {
  padding: 11px 13px;
  border-radius: var(--radius);
  border: 1px solid rgba(255, 171, 74, 0.3);
  background: rgba(255, 171, 74, 0.08);
  font-size: 0.86rem;
  color: var(--fg-muted);
}

.win { border-color: rgba(245, 196, 81, 0.3); box-shadow: 0 0 60px -24px var(--gold); }

.chip {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
  font-size: 0.87rem;
}

.chip--on { background: var(--accent-soft); border-color: var(--accent-line); }

@media (max-width: 980px) {
  .play { grid-template-columns: 1fr; }
  .play__stage { height: 46vh; }
}
</style>
