<script setup lang="ts">
import type { KwamiDetailResponse } from '#shared/types/api'
definePageMeta({ layout: 'embed' })

const route = useRoute()
const mint = computed(() => route.params.mint as string)
const q = computed(() => route.query)

const { data } = await useFetch<KwamiDetailResponse>(`/api/kwami/${mint.value}`)
const kwami = computed(() => data.value?.kwami ?? null)

const palette = computed(() => {
  const derived = paletteFor(kwami.value ?? { mint: mint.value })
  // A host site can retint the Kwami to fit its own design without losing the
  // silhouette that makes it recognisable.
  return {
    a: typeof q.value.colorA === 'string' ? `#${q.value.colorA.replace('#', '')}` : derived.a,
    b: typeof q.value.colorB === 'string' ? `#${q.value.colorB.replace('#', '')}` : derived.b,
  }
})

const showChrome = computed(() => q.value.chrome !== 'off')
const interactive = computed(() => q.value.interactive !== 'off')

/**
 * A gentle idle animation so an embedded Kwami is never completely still.
 *
 * Static 3D on someone else's page reads as a broken canvas. A slow breathing
 * cycle costs nothing and makes it obvious the thing is alive.
 */
const idle = ref(0)
let raf = 0
onMounted(() => {
  const loop = () => {
    idle.value = ((Math.sin(Date.now() / 1400) + 1) / 2) * 0.16
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  // Tell the host how tall we want to be, so an auto-sizing embed can adapt.
  window.parent?.postMessage({ type: 'kwami:ready', mint: mint.value }, '*')
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

const href = computed(() => `${useRuntimeConfig().public.siteUrl}/kwami/${mint.value}`)
</script>

<template>
  <div v-if="kwami" class="embed">
    <KwamiAvatar
      :renderer="kwami.renderer as never"
      :color-a="palette.a"
      :color-b="palette.b"
      :vitality="kwami.vitality"
      :level="idle"
    />

    <div v-if="showChrome" class="embed__chrome">
      <div class="embed__meta">
        <strong>{{ kwami.name }}</strong>
        <span class="embed__pot">{{ formatCents(kwami.value_cents * (kwami.payout_bps / 10000)) }} pot</span>
      </div>
      <a v-if="interactive" :href="href" target="_blank" rel="noopener" class="embed__cta">Challenge</a>
    </div>
  </div>

  <div v-else class="embed embed--missing">
    <span>Kwami not found</span>
  </div>
</template>

<style scoped>
.embed {
  position: relative;
  width: 100%;
  height: 100%;
  /* No background: the host page's own surface shows through, which is what
     makes an embed feel native rather than pasted on. */
}

.embed--missing {
  display: grid;
  place-items: center;
  font:
    13px/1.4 ui-sans-serif,
    system-ui,
    sans-serif;
  color: #888;
}

.embed__chrome {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  font:
    12px/1.35 ui-sans-serif,
    system-ui,
    sans-serif;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent);
  color: #fff;
}

.embed__meta {
  display: flex;
  flex-direction: column;
}
.embed__pot {
  opacity: 0.72;
  font-variant-numeric: tabular-nums;
}

.embed__cta {
  flex: none;
  padding: 5px 12px;
  border-radius: 999px;
  background: #f5c451;
  color: #201703;
  font-weight: 620;
  text-decoration: none;
}
</style>
