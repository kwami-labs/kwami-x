<script setup lang="ts">
import { LOW_ENERGY_MICRO, energyStateOf } from '#shared/energy/state'
import { REPLY_MICRO } from '#shared/energy/constants'
import { toEnergy } from '#shared/energy/cost'

const props = withDefaults(
  defineProps<{
    /** Micro-energy. `null` while it is still being read. */
    balance: bigint | null
    /** What the bar reads as full. Defaults to one session's worth. */
    full?: bigint
    /** Hide the "≈ N replies" line where space is tight. */
    compact?: boolean
    label?: string
  }>(),
  { full: undefined, compact: false, label: 'Energy' },
)

const state = computed(() => (props.balance === null ? 'full' : energyStateOf(props.balance)))

/**
 * The bar is drawn against a session's worth, not against a peak.
 *
 * A percentage of some historical high would tell an owner how their balance is
 * trending, which is not the question they have — the question is "can the next
 * challenger finish their three minutes", and that is a fixed quantity.
 * Anything above it is simply full.
 */
const ceiling = computed(() => props.full ?? LOW_ENERGY_MICRO)

const fraction = computed(() => {
  if (props.balance === null) return 0
  if (props.balance <= 0n) return 0
  const capped = props.balance > ceiling.value ? ceiling.value : props.balance
  return Number((capped * 1000n) / ceiling.value) / 1000
})

const replies = computed(() => (props.balance === null ? 0 : Number(props.balance / REPLY_MICRO)))
const display = computed(() => (props.balance === null ? '—' : toEnergy(props.balance).toLocaleString()))
</script>

<template>
  <div class="meter" :class="`meter--${state}`">
    <div class="meter__head">
      <span class="meter__label">
        <span class="meter__bolt" aria-hidden="true">⚡</span>
        {{ label }}
      </span>
      <span class="num meter__value">{{ display }}</span>
    </div>

    <div
      class="meter__track"
      role="meter"
      :aria-valuenow="replies"
      aria-valuemin="0"
      :aria-label="`${label}: ${display}`"
    >
      <div
        class="meter__fill"
        :style="{ width: `${Math.max(fraction * 100, balance && balance > 0n ? 3 : 0)}%` }"
      />
    </div>

    <p v-if="!compact" class="meter__note dim">
      <template v-if="balance === null">Reading the balance…</template>
      <template v-else-if="state === 'starving'">
        Empty. It cannot answer, so it is off the arena until it is topped up.
      </template>
      <template v-else-if="state === 'low'">
        About {{ replies }} more {{ replies === 1 ? 'reply' : 'replies' }} — not a full session.
      </template>
      <template v-else>About {{ replies }} replies.</template>
    </p>
  </div>
</template>

<style scoped>
.meter {
  display: flex;
  flex-direction: column;
  gap: 7px;
  /* Recoloured per state rather than per element, so the bar, the number and
     the bolt cannot drift out of agreement with each other. */
  --meter: var(--success);
}

.meter--low {
  --meter: var(--warn);
}
.meter--starving {
  --meter: var(--danger);
}

.meter__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-size: 0.82rem;
}

.meter__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 0.72rem;
}

.meter__bolt {
  color: var(--meter);
  font-size: 0.85rem;
}

.meter__value {
  color: var(--meter);
  font-weight: 600;
}

.meter__track {
  height: 6px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

.meter__fill {
  height: 100%;
  border-radius: inherit;
  background: var(--meter);
  transition:
    width 0.45s cubic-bezier(0.16, 1, 0.3, 1),
    background-color 0.4s ease;
}

.meter__note {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
}

/* An empty meter is the one state that should catch the eye across the page. */
.meter--starving .meter__bolt {
  animation: flicker 2.4s ease-in-out infinite;
}

@keyframes flicker {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .meter__bolt {
    animation: none;
  }
}
</style>
