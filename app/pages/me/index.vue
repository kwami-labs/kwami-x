<script setup lang="ts">
definePageMeta({ title: 'My Kwamis' })

const wallet = useWalletStore()
const auth = useAuthStore()

/**
 * Whose Kwamis to show.
 *
 * The linked wallet, not the connected one. Keying off the live connection made
 * this page tell someone with a wallet linked to their account that they hold
 * nothing, every time they opened it on a device where Phantom was not
 * connected yet — which is most devices, most of the time.
 */
const owner = computed(() => auth.payoutAddress)

const { data, pending, refresh } = await useFetch('/api/kwami', {
  query: computed(() => ({ state: 'all', owner: owner.value ?? '', limit: 60 })),
  immediate: false,
})

watch(
  owner,
  (address) => {
    if (address) refresh()
  },
  { immediate: true },
)

const mine = computed(() => data.value?.kwamis ?? [])
</script>

<template>
  <div class="wrap stack gap-3">
    <header class="row gap-2">
      <div class="stack gap-1 grow">
        <span class="eyebrow">Yours</span>
        <h1>My Kwamis</h1>
      </div>
      <NuxtLink to="/mint" class="btn btn--primary">Mint another</NuxtLink>
    </header>

    <div v-if="!owner" class="card stack gap-2">
      <p class="muted">Link a wallet to your account to see what you hold.</p>
      <div class="row gap-2">
        <ConnectWallet v-if="!wallet.isConnected" />
        <NuxtLink to="/me/profile" class="btn btn--ghost">Account</NuxtLink>
      </div>
    </div>

    <div v-else-if="pending" class="card"><p class="dim">Loading…</p></div>

    <div v-else-if="mine.length === 0" class="card stack gap-2">
      <h3>You do not hold any Kwamis yet.</h3>
      <p class="muted">Mint one and hide something worth finding.</p>
      <NuxtLink to="/mint" class="btn btn--primary" style="align-self: flex-start">Mint a Kwami</NuxtLink>
    </div>

    <div v-else class="grid grid--cards">
      <KwamiCard v-for="k in mine" :key="k.mint" :kwami="k" />
    </div>
  </div>
</template>
