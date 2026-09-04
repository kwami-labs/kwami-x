<script setup lang="ts">
definePageMeta({ title: 'Top up' })

const wallet = useWalletStore()

/**
 * MoonPay's redirect target.
 *
 * The purchase settles on chain some minutes after the redirect, so the balance
 * is almost never there on arrival. Polling a few times beats a static "check
 * back later", which reads as a failure — and beats polling forever, which
 * hammers the RPC for a user who has already walked away.
 */
const attempts = ref(0)
const arrived = ref(false)
const startingLamports = ref(0n)

onMounted(async () => {
  startingLamports.value = wallet.lamports
  const poll = setInterval(async () => {
    attempts.value++
    await wallet.refreshBalances()
    if (wallet.lamports > startingLamports.value || wallet.usdcBaseUnits > 0n) {
      arrived.value = true
      clearInterval(poll)
    }
    if (attempts.value >= 20) clearInterval(poll)
  }, 6000)
  onBeforeUnmount(() => clearInterval(poll))
})
</script>

<template>
  <div class="wrap done">
    <div class="card stack gap-3">
      <KwamiMark :size="30" />
      <h1>{{ arrived ? 'It landed.' : 'On its way.' }}</h1>
      <p class="muted">
        <template v-if="arrived">
          Your balance is now {{ wallet.sol.toFixed(3) }} SOL and {{ wallet.usdc.toFixed(2) }} USDC.
        </template>
        <template v-else-if="attempts >= 20">
          Card purchases usually settle within a few minutes, sometimes longer. It will appear in your wallet on its
          own — nothing here needs to stay open.
        </template>
        <template v-else>
          MoonPay is settling the purchase. This page is watching your wallet and will say so when it arrives.
        </template>
      </p>

      <div class="row gap-2">
        <NuxtLink to="/" class="btn btn--primary">Find a Kwami</NuxtLink>
        <NuxtLink to="/onramp" class="btn btn--ghost">Buy more</NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.done { max-width: 480px; }
</style>
