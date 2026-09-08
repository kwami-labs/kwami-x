<script setup lang="ts">
import type { TranscriptTurn } from '#shared/types/kwami'

const props = defineProps<{
  turns: TranscriptTurn[]
  thinking: boolean
  error: string | null
  exhausted: boolean
  /** Set when the phrase is not yet valid — the Kwami has nothing to guard. */
  blocked?: string | null
  /**
   * The draft to hand the voice worker.
   *
   * A function rather than an object so the worker is given whatever the studio
   * looks like at the moment the connection opens, not whatever it looked like
   * when this component mounted.
   */
  draftConfig?: () => Record<string, unknown>
}>()

const emit = defineEmits<{
  say: [text: string]
  turn: [role: 'player' | 'kwami', text: string]
  exhausted: []
  balance: [micro: bigint]
  reset: []
  fuel: []
}>()

const draft = ref('')
const micError = ref<string | null>(null)

/**
 * Speech is the upgrade, typing is the floor.
 *
 * The live game is voice-only because that is the game. A rehearsal is not:
 * `useSpeech` needs Chrome or Edge, and a creator on Firefox still has to be
 * able to hear their Kwami before minting it permanently. Typing is also
 * simply faster when you are iterating on a persona rather than playing.
 */
const speech = useSpeech({
  onFinal: (text) => {
    draft.value = ''
    if (text.trim()) emit('say', text)
  },
  onInterim: (text) => (draft.value = text),
  onError: (message) => (micError.value = message),
})

function submit() {
  const text = draft.value.trim()
  if (!text || props.thinking) return
  draft.value = ''
  emit('say', text)
}

/**
 * The metered upgrade over `useSpeech`, when the account can pay for it.
 *
 * Streaming both ways instead of a typed round trip, billed per second against
 * the same trial allowance a typed reply spends. `connect()` reporting
 * `browser` covers every reason it might not be available — no LiveKit, no
 * worker, no allowance left — and each of them means fall back rather than
 * fail.
 */
const voice = useVoiceLink({
  tokenUrl: '/api/studio/voice-token',
  tickUrl: '/api/studio/voice-tick',
  config: () => props.draftConfig?.() ?? {},
  onTranscript: (role, text) => emit('turn', role, text),
  // Out of allowance mid-sentence. The page's existing "Add fuel" notice is
  // the right place for that to land, and it already exists.
  onExhausted: () => emit('exhausted'),
})

watch(voice.balance, (micro) => {
  if (micro !== null) emit('balance', micro)
})

const listening = computed(() => voice.connected.value || speech.listening.value)

async function toggleMic() {
  micError.value = null
  if (listening.value) {
    speech.stop()
    await voice.disconnect()
    return
  }
  if ((await voice.connect()) === 'livekit') return
  // No metered room to open, so the browser has to do it — and on Firefox it
  // cannot. Typing is still there, which is why this is a note and not a
  // failure.
  if (!speech.supported.value) {
    micError.value = 'This browser cannot listen. Type instead, or open the studio in Chrome.'
    return
  }
  speech.start()
}

onBeforeUnmount(() => speech.stop())
</script>

<template>
  <div class="drive stack gap-2">
    <TranscriptView v-if="turns.length" :turns="turns" />

    <div v-else class="drive__empty">
      <p class="muted">
        Say something to it. Nothing here is saved, nothing can be won — this is a rehearsal, and it is the
        only chance to hear the character before it is written to the chain for good.
      </p>
    </div>

    <p v-if="thinking" class="drive__thinking dim">
      <span class="dot dot--pulse" />
      Thinking…
    </p>

    <div v-if="blocked" class="notice">{{ blocked }}</div>

    <template v-else>
      <div class="row gap-2 drive__input">
        <input
          v-model="draft"
          class="input grow"
          placeholder="Ask it something."
          :disabled="thinking"
          @keydown.enter.prevent="submit"
        />
        <button
          type="button"
          class="btn btn--sm drive__mic"
          :class="{ 'drive__mic--on': listening }"
          :title="listening ? 'Stop listening' : 'Speak instead'"
          @click="toggleMic"
        >
          {{ listening ? '● Listening' : '🎙' }}
        </button>
        <button
          type="button"
          class="btn btn--sm btn--primary"
          :disabled="thinking || !draft.trim()"
          @click="submit"
        >
          Send
        </button>
      </div>

      <p v-if="micError" class="error-text">{{ micError }}</p>
    </template>

    <!--
      Running out is not an error, so it does not get the red treatment. The
      creator has done nothing wrong; they have used the thing up, and the only
      useful response is to offer them more of it.
    -->
    <div v-if="exhausted" class="notice">
      <p class="drive__out">Out of energy.</p>
      <p class="dim">
        Every reply costs a little, in the studio and in a real session alike. Mint this Kwami with fuel and
        it keeps its own balance from then on.
      </p>
      <button type="button" class="btn btn--sm btn--gold" @click="emit('fuel')">Add fuel</button>
    </div>
    <p v-else-if="error" class="error-text">{{ error }}</p>

    <button v-if="turns.length" type="button" class="btn btn--sm btn--ghost" @click="emit('reset')">
      Start over
    </button>
  </div>
</template>

<style scoped>
.drive__empty {
  padding: 14px;
  border-radius: var(--radius);
  border: 1px dashed var(--border);
  background: var(--bg-sunken);
}

.drive__empty p {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
}

.drive__input {
  align-items: center;
}

.drive__mic--on {
  border-color: var(--danger);
  color: var(--danger);
}

.drive__thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 0.82rem;
  color: var(--fg-muted);
}

.drive__thinking .dot {
  color: var(--accent);
}

.notice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--radius);
  border: 1px solid rgba(255, 171, 74, 0.3);
  background: rgba(255, 171, 74, 0.08);
  font-size: 0.85rem;
  line-height: 1.5;
}

.notice p {
  margin: 0;
}

.drive__out {
  font-weight: 600;
  color: var(--warn);
}
</style>
