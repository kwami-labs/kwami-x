<script setup lang="ts">
import { KWAMI_PERSONAS, type KwamiPersona } from '#shared/kwami/personas'

defineProps<{ selected?: string | null }>()
const emit = defineEmits<{ pick: [persona: KwamiPersona] }>()
</script>

<template>
  <div class="personas">
    <button
      v-for="persona in KWAMI_PERSONAS"
      :key="persona.id"
      type="button"
      class="persona"
      :class="{ 'persona--on': selected === persona.id }"
      :style="{ '--tint': persona.accent }"
      @click="emit('pick', persona)"
    >
      <span class="persona__dot" aria-hidden="true" />
      <strong>{{ persona.label }}</strong>
      <span class="dim">{{ persona.blurb }}</span>
    </button>
  </div>
</template>

<style scoped>
.personas {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

/*
 * Each card carries its own accent so the grid reads as a spread of
 * temperaments rather than a column of radio buttons — the creator should be
 * able to tell Snark from Sage before reading either label.
 */
.persona {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: left;
  padding: 13px;
  padding-left: 15px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
  font-size: 0.84rem;
  line-height: 1.45;
  transition: all 0.15s ease;
}

.persona:hover {
  border-color: var(--border-strong);
}

.persona--on {
  border-color: var(--tint);
  background: color-mix(in srgb, var(--tint) 12%, transparent);
}

.persona__dot {
  position: absolute;
  top: 14px;
  right: 13px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tint);
  opacity: 0.55;
  transition: opacity 0.15s ease;
}

.persona--on .persona__dot {
  opacity: 1;
  box-shadow: 0 0 10px var(--tint);
}
</style>
