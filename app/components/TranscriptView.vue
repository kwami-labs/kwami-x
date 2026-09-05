<script setup lang="ts">
import type { TranscriptTurn } from '#shared/types/kwami'

const props = defineProps<{ turns: TranscriptTurn[] }>()

const scroller = useTemplateRef<HTMLElement>('scroller')

// Pin to the newest turn. During a live session the interesting line is always
// the last one, and a player scrolling back mid-challenge is losing seconds.
watch(
  () => props.turns.length,
  async () => {
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  },
)

function stamp(ms: number) {
  const secs = Math.floor(ms / 1000)
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="card card--tight transcript">
    <span class="eyebrow">Transcript</span>
    <div ref="scroller" class="transcript__scroll">
      <div v-for="(turn, i) in turns" :key="i" class="turn" :class="`turn--${turn.role}`">
        <span class="turn__time num dim">{{ stamp(turn.at) }}</span>
        <p class="turn__text">{{ turn.text }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.transcript {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.transcript__scroll {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding-right: 4px;
}

.turn {
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.turn__time {
  font-size: 0.7rem;
  flex: none;
}
.turn__text {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.45;
}
.turn--player .turn__text {
  color: var(--fg);
}
.turn--kwami .turn__text {
  color: var(--accent);
  font-style: italic;
}
</style>
