<script setup lang="ts">
import {
  mountKwami,
  type KwamiActivity,
  type KwamiRendererHandle,
  type RendererParams,
} from '~/utils/kwami-renderer'
import type { KwamiRenderer, KwamiSkin } from '#shared/types/kwami'
import { DEFAULT_SKIN } from '#shared/kwami/skins'

const props = withDefaults(
  defineProps<{
    renderer?: KwamiRenderer
    /** Surface material. Orthogonal to the body. */
    skin?: KwamiSkin
    colorA?: string
    colorB?: string
    /** Third colour. Derived from the other two when a Kwami predates skins. */
    colorC?: string
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
    /**
     * How much mesh this render is worth.
     *
     * `stage` is the Kwami as its creator built it. `card` caps the mesh, for a
     * thumbnail in a grid where a dozen live WebGL contexts share one page and
     * nobody can see the difference anyway.
     */
    size?: 'stage' | 'card'
    /**
     * Let the viewer handle it: drag to turn, wheel to dolly, click to squish.
     *
     * Off by default, and deliberately. A Kwami in a card grid is a picture of
     * a thing you are about to open, and a grid where every tile eats the
     * scroll wheel is a grid nobody can get past.
     */
    interactive?: boolean
  }>(),
  {
    renderer: 'blob-xyz',
    skin: DEFAULT_SKIN,
    colorA: '#7c5cff',
    colorB: '#3ddc97',
    colorC: '#ff5cb8',
    vitality: 1,
    level: 0,
    arousal: 0,
    activity: 'idle',
    tuning: null,
    size: 'stage',
    interactive: false,
  },
)

/** Raised the first time the viewer does anything, so a page can drop its hint. */
const emit = defineEmits<{ interact: [] }>()

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
let handle: KwamiRendererHandle | null = null

onMounted(() => {
  if (!canvas.value) return
  handle = mountKwami(canvas.value, {
    renderer: props.renderer,
    skin: props.skin,
    colorA: props.colorA,
    colorB: props.colorB,
    colorC: props.colorC,
    vitality: props.vitality,
    tuning: props.tuning ?? undefined,
    ...(props.size === 'card' ? { resolutionCap: 120 } : {}),
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
watch([() => props.colorA, () => props.colorB, () => props.colorC], ([a, b, c]) => handle?.setColors(a, b, c))
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

// Same reasoning as the body: a skin change recompiles one program in place
// rather than tearing down the WebGL context the way a `:key` would.
watch(
  () => props.skin,
  (v) => handle?.setSkin(v),
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

/* ── Handling it ───────────────────────────────────────────────────────────
   Drag to turn, wheel to dolly, click to squish. All of the arithmetic lives
   in the renderer handle; what is left here is the part that is genuinely
   about the DOM — where the pointer is on the canvas, and whether a press that
   has just ended was a drag or a click.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * How far a press may wander and still count as a click, in CSS pixels.
 *
 * Zero would mean a touch never squishes: a finger moves two or three pixels
 * on the way down whatever the person holding it intended.
 */
const DRAG_SLOP = 6

let dragging = false
/** Total unsigned travel since the press, against `DRAG_SLOP`. */
let travelled = 0
let lastX = 0
let lastY = 0
/** The last move, as canvas fractions, so a release can turn it into a coast. */
let lastDX = 0
let lastDY = 0
/** Only emitted once; the hint it hides has nothing left to say afterwards. */
let announced = false

function touched() {
  if (announced) return
  announced = true
  emit('interact')
}

function onPointerDown(event: PointerEvent) {
  // Left button only. A right-click belongs to the browser's menu, and a
  // middle-click to whatever the person has bound it to.
  if (!props.interactive || !handle || event.button !== 0) return
  dragging = true
  travelled = 0
  lastX = event.clientX
  lastY = event.clientY
  lastDX = 0
  lastDY = 0
  // Captured so a drag that leaves the canvas keeps turning the Kwami rather
  // than stopping at the edge of the panel.
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging || !handle || !canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  const dx = event.clientX - lastX
  const dy = event.clientY - lastY
  lastX = event.clientX
  lastY = event.clientY
  travelled += Math.abs(dx) + Math.abs(dy)
  // Fractions of the canvas rather than pixels: the same gesture should turn
  // the Kwami the same amount on the mint stage and in a phone-width panel.
  lastDX = dx / Math.max(1, rect.width)
  lastDY = dy / Math.max(1, rect.height)
  handle.spinBy(lastDX, lastDY)
  if (travelled > DRAG_SLOP) touched()
}

function onPointerUp(event: PointerEvent) {
  if (!dragging) return
  dragging = false
  const target = event.currentTarget as Element
  if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
  if (!handle) return
  if (travelled <= DRAG_SLOP) {
    handle.squish(pointOn(event))
    touched()
  } else {
    handle.spinFlick(lastDX, lastDY)
  }
}

function onPointerCancel() {
  dragging = false
}

/** Where a pointer landed, in [-1, 1] with +y up — what `squish` wants. */
function pointOn(event: PointerEvent): { x: number; y: number } | null {
  const rect = canvas.value?.getBoundingClientRect()
  if (!rect || rect.width === 0 || rect.height === 0) return null
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: 1 - ((event.clientY - rect.top) / rect.height) * 2,
  }
}

function onWheel(event: WheelEvent) {
  if (!props.interactive || !handle) return
  // Swallowed only while the zoom still has somewhere to go. At either stop the
  // event goes back to the page, so a reader who scrolls onto the Kwami on the
  // way down the build is not trapped on it.
  if (!handle.zoomByWheel(event.deltaY, event.deltaMode)) return
  event.preventDefault()
  touched()
}

function onKeydown(event: KeyboardEvent) {
  if (!props.interactive || !handle) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    handle.squish()
    touched()
  }
}

/** Somewhere to get back to, for anyone who has turned it upside down. */
function onDoubleClick() {
  if (!props.interactive) return
  handle?.resetView()
}

onBeforeUnmount(() => {
  handle?.dispose()
  handle = null
})
</script>

<template>
  <div class="avatar" :class="{ 'avatar--live': interactive }">
    <canvas
      ref="canvas"
      class="avatar__canvas"
      :tabindex="interactive ? 0 : undefined"
      :role="interactive ? 'button' : undefined"
      :aria-label="
        interactive ? 'The Kwami. Drag to turn it, scroll to zoom, press to squish it.' : undefined
      "
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @dblclick="onDoubleClick"
      @keydown="onKeydown"
      @wheel="onWheel"
    />
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

/*
  `pan-y` rather than `none`: a horizontal drag turns the Kwami, and a vertical
  swipe still scrolls the page. On a phone the stage is not sticky — it sits at
  the top of the build and scrolls away with it — so a canvas that swallowed
  vertical swipes would be a wall across the top of the page.
*/
.avatar--live .avatar__canvas {
  cursor: grab;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}

.avatar--live .avatar__canvas:active {
  cursor: grabbing;
}

.avatar--live .avatar__canvas:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -4px;
  border-radius: var(--radius);
}
</style>
