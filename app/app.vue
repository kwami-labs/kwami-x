<script setup lang="ts">
/**
 * Root shell.
 *
 * Wallet auto-connect runs once, client-side, before the first paint of any
 * page that needs it — otherwise a returning user sees "Connect wallet" flash
 * on every navigation despite having already authorised the site.
 */
const wallet = useWalletStore()

onMounted(() => {
  void wallet.autoConnect()
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
