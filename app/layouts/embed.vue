<script setup lang="ts">
/**
 * Chrome-free layout for third-party embeds.
 *
 * No header, no footer, transparent background: the host page supplies the
 * surrounding design, and an embed that paints its own dark rectangle over
 * someone's light site looks broken.
 */
</script>

<template>
  <div class="embed-shell">
    <slot />
  </div>
</template>

<style>
/* Global rather than scoped: the ambient body gradient has to go too, or it
   shows through as a purple haze inside the host's iframe. */
body:has(.embed-shell) {
  background: transparent;
}
body:has(.embed-shell)::before {
  display: none;
}
</style>

<style scoped>
.embed-shell {
  width: 100%;
  height: 100vh;
  margin: 0;
  overflow: hidden;
}
</style>
