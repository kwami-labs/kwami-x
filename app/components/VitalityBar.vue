<script setup lang="ts">
import { DEATH_VITALITY_THRESHOLD } from '#shared/game/constants'

const props = defineProps<{ value: number; showLabel?: boolean }>()

/**
 * Vitality is displayed on a square-root scale.
 *
 * Linearly, a Kwami sitting at 3% of its peak and one at 0.5% both render as
 * an invisible sliver — but one is alive and one is about to die, which is the
 * single most important thing on the card. The root spreads the bottom of the
 * range out where the drama actually is.
 */
const width = computed(() => `${Math.max(1.5, Math.sqrt(Math.min(1, Math.max(0, props.value))) * 100)}%`)

const tone = computed(() => {
  if (props.value <= DEATH_VITALITY_THRESHOLD) return 'dying'
  if (props.value < 0.25) return 'weak'
  return 'well'
})
</script>

<template>
  <div class="vitality">
    <div class="vitality__track">
      <div class="vitality__fill" :class="`vitality__fill--${tone}`" :style="{ width }" />
    </div>
    <span v-if="showLabel" class="vitality__label dim">
      {{ (value * 100).toFixed(value < 0.1 ? 1 : 0) }}% of peak
    </span>
  </div>
</template>

<style scoped>
.vitality {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.vitality__track {
  height: 4px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

.vitality__fill {
  height: 100%;
  border-radius: inherit;
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.vitality__fill--well {
  background: linear-gradient(90deg, var(--accent), var(--success));
}
.vitality__fill--weak {
  background: linear-gradient(90deg, var(--warn), var(--gold));
}
.vitality__fill--dying {
  background: var(--danger);
  animation: flicker 1.6s ease-in-out infinite;
}

.vitality__label {
  font-size: 0.74rem;
}

@keyframes flicker {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
</style>
