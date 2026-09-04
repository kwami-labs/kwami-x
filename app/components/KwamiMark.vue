<script setup lang="ts">
/** The wordmark glyph: a ring with a sealed core — a pot with something inside it. */
withDefaults(defineProps<{ size?: number }>(), { size: 22 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.4" />
    <circle cx="12" cy="12" r="4.4" fill="var(--accent)" />
    <circle cx="12" cy="12" r="4.4" fill="url(#kwami-mark-sheen)" />
    <defs>
      <radialGradient id="kwami-mark-sheen" cx="0.32" cy="0.28" r="0.85">
        <stop offset="0" stop-color="#fff" stop-opacity="0.55" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </radialGradient>
    </defs>
  </svg>
</template>
