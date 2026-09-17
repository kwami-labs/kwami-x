<script setup lang="ts">
/**
 * The Form tab: everything about what a Kwami looks like.
 *
 * Modelled on the desktop app's avatar panel rather than on the flat slider
 * grid this replaced. The grid was honest — twenty numbers, all editable — and
 * nobody moved any of them, because a wall of `spikeY` and `rimPower` asks a
 * creator to learn a shader before they can have an opinion. The panel asks
 * three questions instead, in the order someone actually answers them: what is
 * it made of, what colour, and then how does it move.
 *
 * The state transitions all live in `shared/kwami/form.ts` and this emits
 * patches rather than mutating, so the same clicks mean the same thing here
 * and on the owner's edit screen.
 */
import { KWAMI_PALETTES, TUNING_GROUPS, TUNING_RANGES, type KwamiTuning } from '#shared/kwami/appearance'
import { KWAMI_LOOKS } from '#shared/kwami/looks'
import { KWAMI_HARMONIES } from '#shared/kwami/harmony'
import { KWAMI_SKINS, SKIN_FAMILIES, skinDefinition, type SkinFamily } from '#shared/kwami/skins'
import {
  applyHarmony,
  applyLook,
  applyPalette,
  applyRenderer,
  applySkin,
  clearTuning,
  linkAxes,
  randomizeGroup,
  setTuning,
  type FormPatch,
  type KwamiFormState,
} from '#shared/kwami/form'
import { skinSwatch } from '~/utils/skin-swatch'
import { RENDERER_PRESETS } from '~/utils/kwami-renderer'
import type { KwamiRenderer } from '#shared/types/kwami'

const props = defineProps<{ state: KwamiFormState }>()
const emit = defineEmits<{ patch: [FormPatch] }>()

const BODIES: Array<{ id: KwamiRenderer; label: string; note: string }> = [
  { id: 'blob-xyz', label: 'Blob', note: 'Liquid and expressive. Reacts hardest to a voice.' },
  { id: 'crystal-ball', label: 'Crystal', note: 'Still and cold. Barely moves at rest.' },
  { id: 'orbital-shards', label: 'Shards', note: 'Fractured and restless, with a cloud around it.' },
  { id: 'stars-genesis', label: 'Genesis', note: 'A slow field of light. Almost no displacement.' },
  { id: 'black-hole', label: 'Horizon', note: 'Tight, dark and fast. The smallest silhouette.' },
]

const family = ref<SkinFamily | 'all'>('all')
/** Which XYZ rows the creator has linked. Local: it is a habit, not a property of the Kwami. */
const linked = ref<Record<string, boolean>>({})

const shownSkins = computed(() =>
  family.value === 'all' ? KWAMI_SKINS : KWAMI_SKINS.filter((s) => s.family === family.value),
)

const skin = computed(() => skinDefinition(props.state.skin))
const body = computed(() => BODIES.find((b) => b.id === props.state.renderer) ?? BODIES[0]!)

/**
 * The value a slider shows for a key nobody has touched.
 *
 * The body's preset, not the range's minimum. A track pinned to the left for a
 * parameter that is actually mid-range tells the creator their Kwami is at a
 * setting it is not at, and the first drag jumps it somewhere nobody chose.
 */
function valueOf(key: keyof KwamiTuning): number {
  const preset = RENDERER_PRESETS[props.state.renderer] ?? RENDERER_PRESETS['blob-xyz']
  return props.state.tuning[key] ?? preset[key]
}

function isOverridden(key: keyof KwamiTuning): boolean {
  return props.state.tuning[key] !== undefined
}

/** Slider labels are short; a value needs its own precision to be readable. */
function display(key: keyof KwamiTuning): string {
  const value = valueOf(key)
  const { step } = TUNING_RANGES[key]
  return step >= 1 ? String(Math.round(value)) : value.toFixed(step >= 0.05 ? 2 : 3)
}

function onSlide(key: keyof KwamiTuning, row: Array<keyof KwamiTuning>, event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  emit(
    'patch',
    linked.value[row.join()] ? linkAxes(props.state, row, value) : setTuning(props.state, key, value),
  )
}

function rollGroup(keys: Array<keyof KwamiTuning>) {
  emit('patch', randomizeGroup(props.state, keys, Math.random))
}

const colorSlots = computed(() =>
  [
    { key: 'colorA' as const, label: 'Core', value: props.state.colorA },
    { key: 'colorB' as const, label: 'Rim', value: props.state.colorB },
    { key: 'colorC' as const, label: 'Accent', value: props.state.colorC },
  ].slice(0, skin.value.colors),
)

function onColor(key: 'colorA' | 'colorB' | 'colorC', event: Event) {
  emit('patch', {
    [key]: (event.target as HTMLInputElement).value,
    paletteId: null,
    harmonyId: null,
    lookId: null,
  })
}

const tuningCount = computed(() => Object.keys(props.state.tuning).length)
</script>

<template>
  <div class="stack gap-3">
    <!-- ── Looks: the whole thing in one click ───────────────────────────── -->
    <div class="field">
      <span class="label">Looks</span>
      <div class="chips">
        <button
          v-for="l in KWAMI_LOOKS"
          :key="l.id"
          type="button"
          class="chip"
          :class="{ 'chip--on': state.lookId === l.id }"
          @click="emit('patch', applyLook(l.id))"
        >
          {{ l.label }}
        </button>
      </div>
      <span class="hint"
        >Body, surface, palette and motion together — the combinations worth starting from.</span
      >
    </div>

    <!-- ── Skin ──────────────────────────────────────────────────────────── -->
    <div class="field">
      <div class="row gap-2">
        <span class="label grow">Skin</span>
        <span class="hint">{{ skin.label }}</span>
      </div>

      <div class="chips">
        <button
          type="button"
          class="chip chip--sm"
          :class="{ 'chip--on': family === 'all' }"
          @click="family = 'all'"
        >
          All <span class="dim">{{ KWAMI_SKINS.length }}</span>
        </button>
        <button
          v-for="f in SKIN_FAMILIES"
          :key="f.id"
          type="button"
          class="chip chip--sm"
          :class="{ 'chip--on': family === f.id }"
          @click="family = f.id"
        >
          {{ f.label }}
        </button>
      </div>

      <div class="skins">
        <button
          v-for="s in shownSkins"
          :key="s.id"
          type="button"
          class="skin"
          :class="{ 'skin--on': state.skin === s.id }"
          :title="s.note"
          @click="emit('patch', applySkin(state, s.id))"
        >
          <span
            class="skin__chip"
            :style="{ background: skinSwatch(s.id, state.colorA, state.colorB, state.colorC) }"
          />
          <span class="skin__label">{{ s.label }}</span>
        </button>
      </div>
      <span class="hint">{{ skin.note }}</span>
    </div>

    <!-- ── Colours ───────────────────────────────────────────────────────── -->
    <div class="field">
      <span class="label">Colours</span>
      <div class="swatches">
        <button
          v-for="p in KWAMI_PALETTES"
          :key="p.id"
          type="button"
          class="swatch"
          :class="{ 'swatch--on': state.paletteId === p.id }"
          :title="p.label"
          :aria-label="p.label"
          :style="{ background: `linear-gradient(135deg, ${p.a}, ${p.b} 55%, ${p.c})` }"
          @click="emit('patch', applyPalette(p.id))"
        />
      </div>

      <div class="row gap-2 picks">
        <label v-for="slot in colorSlots" :key="slot.key" class="pick">
          <input :value="slot.value" type="color" @input="onColor(slot.key, $event)" />
          <span class="dim">{{ slot.label }}</span>
        </label>
        <span v-if="skin.colors < 3" class="hint grow">
          {{ skin.label }} reads {{ skin.colors === 1 ? 'one colour' : 'two colours' }}; the rest are still
          minted, and come back the moment you try a skin that uses them.
        </span>
      </div>

      <details class="tune">
        <summary>
          Harmonies
          <span v-if="state.harmonyId" class="dim">{{ state.harmonyId }}</span>
        </summary>
        <div class="stack gap-2 tune__body">
          <p class="hint">
            Three colours picked independently mix to mud across the middle of a sphere. Each of these rolls a
            set that holds together — press one twice to try another of the same kind.
          </p>
          <div class="chips">
            <button
              v-for="h in KWAMI_HARMONIES"
              :key="h.id"
              type="button"
              class="chip chip--sm"
              :class="{ 'chip--on': state.harmonyId === h.id }"
              :title="h.note"
              @click="emit('patch', applyHarmony(h.id, Math.random))"
            >
              {{ h.label }}
            </button>
          </div>
        </div>
      </details>

      <span class="hint">
        The colours are minted with the Kwami, so it looks the same here, in the arena, and in any wallet that
        renders its NFT.
      </span>
    </div>

    <!-- ── Body ──────────────────────────────────────────────────────────── -->
    <div class="field">
      <span class="label">Body</span>
      <div class="chips">
        <button
          v-for="r in BODIES"
          :key="r.id"
          type="button"
          class="chip"
          :class="{ 'chip--on': state.renderer === r.id }"
          @click="emit('patch', applyRenderer(r.id))"
        >
          {{ r.label }}
        </button>
      </div>
      <span class="hint">{{ body.note }}</span>
    </div>

    <!-- ── The real controls ─────────────────────────────────────────────── -->
    <details v-for="group in TUNING_GROUPS" :key="group.id" class="tune">
      <summary>
        {{ group.label }}
        <span class="dim">{{ group.hint }}</span>
      </summary>
      <div class="stack gap-3 tune__body">
        <div v-for="row in group.rows" :key="row.keys.join()" class="field">
          <div class="row gap-2">
            <span class="label grow">{{ row.label }}</span>
            <label v-if="row.keys.length === 3" class="linkbox">
              <input v-model="linked[row.keys.join()]" type="checkbox" />
              <span class="dim">link</span>
            </label>
          </div>
          <div class="axes" :class="{ 'axes--multi': row.keys.length === 3 }">
            <div v-for="key in row.keys" :key="key" class="axis">
              <label class="axis__head" :for="`tune-${key}`">
                <span class="dim">{{ row.keys.length === 3 ? key.slice(-1) : '' }}</span>
                <span class="num" :class="{ dim: !isOverridden(key) }">{{ display(key) }}</span>
              </label>
              <input
                :id="`tune-${key}`"
                type="range"
                :min="TUNING_RANGES[key].min"
                :max="TUNING_RANGES[key].max"
                :step="TUNING_RANGES[key].step"
                :value="valueOf(key)"
                @input="onSlide(key, row.keys, $event)"
              />
            </div>
          </div>
        </div>

        <div class="row gap-2">
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            @click="rollGroup(group.rows.flatMap((r) => r.keys))"
          >
            🎲 Roll {{ group.label.toLowerCase() }}
          </button>
        </div>
      </div>
    </details>

    <div v-if="tuningCount" class="row gap-2">
      <span class="hint grow"
        >{{ tuningCount }} setting{{ tuningCount === 1 ? '' : 's' }} moved off the preset.</span
      >
      <button type="button" class="btn btn--sm btn--ghost" @click="emit('patch', clearTuning())">
        Back to the preset
      </button>
    </div>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.chip {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--panel);
  color: inherit;
  cursor: pointer;
  font-size: 0.87rem;
  transition: all 0.15s ease;
}

.chip--sm {
  padding: 4px 11px;
  font-size: 0.8rem;
}

.chip:hover {
  border-color: var(--border-strong);
}

.chip--on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--fg);
}

/* ── Skin gallery ──────────────────────────────────────────────────────── */

.skins {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 8px;
}

.skin {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 7px 4px 6px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--panel);
  color: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.skin:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
}

.skin--on {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}

.skin__chip {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  box-shadow:
    inset 0 -6px 14px -8px rgba(0, 0, 0, 0.9),
    0 4px 12px -6px rgba(0, 0, 0, 0.8);
}

.skin__label {
  font-size: 0.72rem;
  color: var(--fg-muted);
  line-height: 1.1;
  text-align: center;
}

.skin--on .skin__label {
  color: var(--fg);
}

/* ── Colours ───────────────────────────────────────────────────────────── */

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.swatch {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition:
    transform 0.14s ease,
    border-color 0.14s ease;
}

.swatch:hover {
  transform: translateY(-2px);
}

.swatch--on {
  border-color: var(--fg);
  transform: translateY(-2px);
}

.picks {
  flex-wrap: wrap;
  align-items: center;
}

.pick {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.8rem;
  cursor: pointer;
}

.pick input[type='color'] {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: none;
  cursor: pointer;
}

/* ── Grouped sliders ───────────────────────────────────────────────────── */

.tune {
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-sunken);
  padding: 11px 13px;
}

.tune summary {
  cursor: pointer;
  font-size: 0.85rem;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}

.tune summary .dim {
  font-size: 0.78rem;
  text-align: right;
}

.tune__body {
  padding-top: 14px;
}

.axes {
  display: grid;
  gap: 6px 14px;
}

.axes--multi {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.axis {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.axis__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 0.76rem;
  text-transform: uppercase;
}

.linkbox {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.76rem;
  cursor: pointer;
}

input[type='range'] {
  accent-color: var(--accent);
  width: 100%;
}
</style>
