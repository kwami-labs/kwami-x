<script setup lang="ts">
import {
  TRAIT_AXES,
  TRAIT_MAX,
  TRAIT_MIN,
  compileTraits,
  hasTraits,
  type TraitVector,
} from '#shared/kwami/traits'

const model = defineModel<TraitVector>({ required: true })

/**
 * The compiled prompt, shown to the creator.
 *
 * The sliders are numbers and the model reads prose, so without this the
 * creator is tuning something they cannot see the effect of until they hear it.
 * Showing the sentence turns six abstract dials into a thing with a visible
 * output — and it is the *actual* sentence, not a paraphrase, so there is
 * nothing here that can drift away from what the Kwami is really told.
 */
const compiled = computed(() => compileTraits(model.value))
const touched = computed(() => hasTraits(model.value))

function set(id: keyof TraitVector, value: number) {
  model.value = { ...model.value, [id]: value }
}

function clear() {
  model.value = TRAIT_AXES.reduce((acc, axis) => ({ ...acc, [axis.id]: 0 }), {} as TraitVector)
}
</script>

<template>
  <div class="traits stack gap-3">
    <div class="traits__grid">
      <div v-for="axis in TRAIT_AXES" :key="axis.id" class="field trait">
        <label class="label trait__head" :for="`trait-${axis.id}`">
          <span>{{ axis.label }}</span>
          <span class="num trait__value" :class="{ 'trait__value--off': model[axis.id] === 0 }">
            {{ model[axis.id] > 0 ? '+' : '' }}{{ model[axis.id] }}
          </span>
        </label>
        <input
          :id="`trait-${axis.id}`"
          type="range"
          :min="TRAIT_MIN"
          :max="TRAIT_MAX"
          step="5"
          :value="model[axis.id]"
          @input="set(axis.id, Number(($event.target as HTMLInputElement).value))"
        />
        <span class="hint">{{ axis.note }}</span>
      </div>
    </div>

    <div class="traits__out">
      <div class="row gap-2">
        <span class="eyebrow grow">What it is told</span>
        <button v-if="touched" type="button" class="btn btn--sm btn--ghost" @click="clear">Reset</button>
      </div>
      <p v-if="compiled" class="traits__prompt">{{ compiled }}</p>
      <p v-else class="traits__prompt dim">
        Nothing yet — at neutral, none of this reaches the prompt at all and the persona speaks for itself.
      </p>
    </div>
  </div>
</template>

<style scoped>
.traits__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 16px 22px;
}

.trait__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.trait__value {
  color: var(--accent);
  font-size: 0.82rem;
}

.trait__value--off {
  color: var(--fg-dim);
}

.trait input[type='range'] {
  accent-color: var(--accent);
  width: 100%;
}

.traits__out {
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--bg-sunken);
  border: 1px solid var(--border);
}

.traits__prompt {
  margin: 6px 0 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--fg-muted);
}
</style>
