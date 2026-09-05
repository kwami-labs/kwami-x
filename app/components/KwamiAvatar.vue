<script setup lang="ts">
import { mountKwami, type KwamiRendererHandle } from '~/utils/kwami-renderer'
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
  }>(),
  { renderer: 'blob-xyz', colorA: '#7c5cff', colorB: '#3ddc97', vitality: 1, level: 0, arousal: 0 },
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
