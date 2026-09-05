<script setup lang="ts">
/**
 * A living background of drifting Kwamis.
 *
 * Fixed to the viewport rather than sized by its parent: it sits behind a modal
 * whose height changes as the user switches between sign-in methods, and a
 * background that resizes with the panel in front of it reads as the whole
 * world lurching every time someone clicks a tab.
 */
import { mountKwamiField, type KwamiFieldHandle } from '~/utils/kwami-field'

const props = withDefaults(defineProps<{ seeds?: string[]; count?: number; tempo?: number }>(), {
  seeds: () => [],
  count: 9,
  tempo: 1,
})

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
let handle: KwamiFieldHandle | null = null

onMounted(() => {
  if (!canvas.value) return
  // Respect the OS-level motion preference. The field is decoration; someone
  // who gets motion sick from drifting objects should still be able to sign in.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  handle = mountKwamiField(canvas.value, {
    seeds: props.seeds.length ? props.seeds : undefined,
    count: props.count,
    tempo: props.tempo,
  })
})

onBeforeUnmount(() => {
  handle?.dispose()
  handle = null
})
</script>

<template>
  <div class="field" aria-hidden="true">
    <canvas ref="canvas" class="field__canvas" />
    <div class="field__veil" />
  </div>
</template>

<style scoped>
.field {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 22% 18%, rgba(124, 92, 255, 0.16), transparent 55%),
    radial-gradient(circle at 78% 76%, rgba(61, 220, 151, 0.12), transparent 55%), var(--bg);
  pointer-events: none;
}

.field__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/**
 * A vignette over the field. The Kwamis are bright and high-contrast by design,
 * and text laid straight over them fails every legibility check at the edges of
 * the panel where the glass blur runs out.
 */
.field__veil {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(7, 8, 12, 0.15) 0%, rgba(7, 8, 12, 0.72) 100%);
}
</style>
