<script setup lang="ts">
import { PHANTOM_INSTALL_URL } from '~/utils/phantom'

const wallet = useWalletStore()
const auth = useAuthStore()
const gate = useAuthGate()
const open = ref(false)
const binding = ref(false)

const menu = useTemplateRef<HTMLElement>('menu')
onClickOutside(menu, () => (open.value = false))

/** Whether the connected address has been proven to belong to this account. */
const bound = computed(() => Boolean(wallet.address && auth.boundAddresses.includes(wallet.address)))

async function onConnect() {
  if (wallet.status === 'unavailable') {
    window.open(PHANTOM_INSTALL_URL, '_blank', 'noopener')
    return
  }
  await wallet.connect()
  // Connecting is a browser-level grant; it proves nothing to the server. Ask
  // for the signature straight after, while the user is still in the flow they
  // started, rather than ambushing them with a second prompt later.
  if (wallet.isConnected && auth.isSignedIn) await onBind()
}

async function onBind() {
  binding.value = true
  try {
    await auth.bindWallet()
  } finally {
    binding.value = false
  }
}

async function onSignOut() {
  open.value = false
  await auth.signOut()
  await wallet.disconnect()
}
</script>

<template>
  <div class="wallet">
    <button v-if="!auth.isSignedIn" class="btn btn--primary" @click="gate.prompt()">Sign in</button>

    <button
      v-else-if="!wallet.isConnected"
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

        <div v-if="!bound" class="stack gap-2 bind">
          <span class="hint">
            This wallet is not linked to your account yet, so winnings and the Kwamis you mint cannot be
            matched to you here.
          </span>
          <button class="btn btn--sm btn--primary" :disabled="binding" @click="onBind">
            {{ binding ? 'Waiting for Phantom…' : 'Link this wallet' }}
          </button>
        </div>

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

.bind {
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
}

.wallet__error {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: max-content;
  max-width: 260px;
}
</style>
