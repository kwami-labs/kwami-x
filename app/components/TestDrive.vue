<script setup lang="ts">
import type { TranscriptTurn } from '#shared/types/kwami'

const props = defineProps<{
  turns: TranscriptTurn[]
  thinking: boolean
  error: string | null
  exhausted: boolean
  /** Set when the phrase is not yet valid — the Kwami has nothing to guard. */
  blocked?: string | null
}>()

const emit = defineEmits<{ say: [text: string]; reset: []; fuel: [] }>()

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

function toggleMic() {
  micError.value = null
  if (speech.listening.value) speech.stop()
  else speech.start()
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
          v-if="speech.supported.value"
          type="button"
          class="btn btn--sm drive__mic"
          :class="{ 'drive__mic--on': speech.listening.value }"
          :title="speech.listening.value ? 'Stop listening' : 'Speak instead'"
          @click="toggleMic"
        >
          {{ speech.listening.value ? '● Listening' : '🎙' }}
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
