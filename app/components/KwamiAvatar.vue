<script setup lang="ts">
import {
  mountKwami,
  type KwamiActivity,
  type KwamiRendererHandle,
  type RendererParams,
} from '~/utils/kwami-renderer'
import type { KwamiRenderer } from '#shared/types/kwami'

const props = withDefaults(
  defineProps<{
    renderer?: KwamiRenderer
    colorA?: string
    colorB?: string
    /** 0 = dead, 1 = at its high-water mark. */
    vitality?: number
    /** Live audio level in [0, 1]. */
    level?: number
    /** 0 = idle, 1 = agitated. */
    arousal?: number
    /** What it is doing — drives the movement it generates on its own. */
    activity?: KwamiActivity
    /** Creator overrides on top of the body's preset. */
    tuning?: Partial<RendererParams> | null
  }>(),
  {
    renderer: 'blob-xyz',
    colorA: '#7c5cff',
    colorB: '#3ddc97',
    vitality: 1,
    level: 0,
    arousal: 0,
    activity: 'idle',
    tuning: null,
  },
)

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
let handle: KwamiRendererHandle | null = null

onMounted(() => {
  if (!canvas.value) return
  handle = mountKwami(canvas.value, {
    renderer: props.renderer,
    colorA: props.colorA,
    colorB: props.colorB,
    vitality: props.vitality,
    tuning: props.tuning ?? undefined,
  })
})

// Audio level changes ~50 times a second. It is pushed straight into the
// renderer handle, which owns its own smoothing, rather than through a
// reactive uniform that would re-render the component each frame.
watch(
  () => props.level,
  (v) => handle?.setAudioLevel(v),
)
watch(
  () => props.arousal,
  (v) => handle?.setArousal(v),
)
watch(
  () => props.vitality,
  (v) => handle?.setVitality(v),
)
watch([() => props.colorA, () => props.colorB], ([a, b]) => handle?.setColors(a, b))
watch(
  () => props.activity,
  (v) => handle?.setActivity(v),
)

/**
 * Move to another body in place, rather than remounting.
 *
 * The obvious alternative — `:key="renderer"` on this component — tears down a
 * WebGL context and builds a new one on every click. Browsers cap live contexts
 * at around sixteen and drop the oldest without warning, which is the whole
 * reason `kwami-field.ts` packs a dozen Kwamis into one context; doing the
 * opposite from a click handler on the mint page is the same hazard pointed the
 * other way.
 */
watch(
  () => props.renderer,
  (v) => handle?.setRenderer(v),
)

// Deep, because the studio's sliders mutate fields on one object rather than
// replacing it — a shallow watch would fire on the first drag and never again.
watch(
  () => props.tuning,
  (v) => handle?.setTuning(v ?? {}),
  { deep: true },
)

// The renderer sizes itself from its parent, so a layout change that does not
// resize the window still needs a nudge.
useResizeObserver(canvas, () => handle?.resize())

onBeforeUnmount(() => {
  handle?.dispose()
  handle = null
})
</script>

<template>
  <div class="avatar">
    <canvas ref="canvas" class="avatar__canvas" />
  </div>
</template>

<style scoped>
.avatar {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 120px;
}

.avatar__canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
