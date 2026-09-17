<script setup lang="ts">
/**
 * The inline "Connect Phantom" call to action.
 *
 * Every page that wanted one used to inline `@click="wallet.connect()"`, so a
 * failure the store wrote to `wallet.error` — a locked Phantom, a site it has
 * not authorised yet — was rendered nowhere and the button read as dead. One
 * component, so the failure always has somewhere to land.
 */
const props = withDefaults(defineProps<{ label?: string; block?: boolean }>(), {
  label: 'Connect Phantom',
  block: false,
})

const wallet = useWalletStore()

const text = computed(() => {
  if (wallet.status === 'connecting') return 'Connecting…'
  if (wallet.status === 'unavailable') return 'Get Phantom'
  return props.label
})
</script>

<template>
  <div class="stack gap-1">
    <button
      class="btn btn--primary"
      :class="{ 'btn--block': block }"
      :disabled="wallet.status === 'connecting'"
      @click="wallet.connect()"
    >
      {{ text }}
    </button>
    <!-- Click to dismiss: nothing else clears it until the next attempt. -->
    <p v-if="wallet.error" class="error-text" @click="wallet.error = null">{{ wallet.error }}</p>
  </div>
</template>
