<script setup lang="ts">
import { PHANTOM_INSTALL_URL } from '~/utils/phantom'

const wallet = useWalletStore()
const auth = useAuthStore()
const open = ref(false)

const menu = useTemplateRef<HTMLElement>('menu')
onClickOutside(menu, () => (open.value = false))

async function onConnect() {
  if (wallet.status === 'unavailable') {
    window.open(PHANTOM_INSTALL_URL, '_blank', 'noopener')
    return
  }
  await wallet.connect()
}

async function onSignOut() {
  open.value = false
  await auth.signOut()
  await wallet.disconnect()
}
</script>

<template>
  <div class="wallet">
    <button
      v-if="!wallet.isConnected"
      class="btn btn--primary"
      :disabled="wallet.status === 'connecting'"
      @click="onConnect"
    >
      <span v-if="wallet.status === 'connecting'">Connecting…</span>
      <span v-else-if="wallet.status === 'unavailable'">Get Phantom</span>
      <span v-else>Connect wallet</span>
    </button>

    <div v-else ref="menu" class="wallet__menu">
      <button class="btn btn--ghost" @click="open = !open">
        <span class="dot" :class="{ 'dot--pulse': true }" style="color: var(--success)" />
        <span class="num">{{ wallet.shortAddress }}</span>
      </button>

      <div v-if="open" class="popover card card--tight">
        <div class="stack gap-1">
          <span class="eyebrow">Balance</span>
          <div class="row gap-3">
            <span class="num num--lg">{{ wallet.sol.toFixed(3) }} <span class="muted">SOL</span></span>
            <span class="num num--lg">{{ wallet.usdc.toFixed(2) }} <span class="muted">USDC</span></span>
          </div>
        </div>

        <hr class="divider" />

        <div class="stack gap-1">
          <NuxtLink to="/me" class="popover__item" @click="open = false">My Kwamis</NuxtLink>
          <NuxtLink to="/me/sessions" class="popover__item" @click="open = false">Session history</NuxtLink>
          <button class="popover__item" @click="wallet.refreshBalances()">Refresh balance</button>
          <NuxtLink to="/onramp" class="popover__item popover__item--gold" @click="open = false">
            Top up with card
          </NuxtLink>
        </div>

        <hr class="divider" />

        <button class="popover__item danger" @click="onSignOut">Disconnect</button>
      </div>
    </div>

    <p v-if="wallet.error" class="error-text wallet__error">{{ wallet.error }}</p>
  </div>
</template>

<style scoped>
.wallet {
  position: relative;
}
.wallet__menu {
  position: relative;
}

.popover {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  width: 258px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg-raised);
  box-shadow: var(--shadow-lift);
  z-index: 60;
}

.popover__item {
  text-align: left;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  background: none;
  border: 0;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--fg-muted);
  transition:
    background 0.14s ease,
    color 0.14s ease;
}

.popover__item:hover {
  background: var(--panel);
  color: var(--fg);
}
.popover__item--gold {
  color: var(--gold);
}

.wallet__error {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: max-content;
  max-width: 260px;
}
</style>
