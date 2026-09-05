<script setup lang="ts">
definePageMeta({ title: 'Top up' })

const wallet = useWalletStore()
const auth = useAuthStore()

const amount = ref(50)
const currency = ref<'sol' | 'usdc_sol'>('sol')
const widgetUrl = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

async function openWidget() {
  if (!wallet.address) return
  loading.value = true
  error.value = null
  try {
    const { url } = await $fetch<{ url: string }>('/api/moonpay/sign', {
      method: 'POST',
      body: {
        walletAddress: wallet.address,
        currencyCode: currency.value,
        baseCurrencyAmount: amount.value,
      },
    })
    widgetUrl.value = url
  } catch (e) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? 'Could not open the on-ramp.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="wrap onramp">
    <header class="stack gap-1">
      <span class="eyebrow">On-ramp</span>
      <h1>Buy SOL or USDC with a card.</h1>
      <p class="muted">
        MoonPay sends it straight to your Phantom wallet. Kwami never touches the funds and never sees your
        card.
      </p>
    </header>

    <div v-if="!wallet.isConnected" class="card stack gap-2">
      <p class="muted">Connect your wallet so MoonPay knows where to send it.</p>
      <button class="btn btn--primary" @click="wallet.connect()">Connect Phantom</button>
    </div>

    <div v-else-if="!auth.isSignedIn" class="card stack gap-2">
      <p class="muted">Sign in first — the destination address is signed against your session.</p>
      <button class="btn btn--primary" @click="auth.signInWithPhantom()">Sign in with Phantom</button>
    </div>

    <div v-else-if="!widgetUrl" class="card stack gap-3">
      <div class="field">
        <span class="label">Buy</span>
        <div class="row gap-1">
          <button class="chip" :class="{ 'chip--on': currency === 'sol' }" @click="currency = 'sol'">
            SOL
          </button>
          <button
            class="chip"
            :class="{ 'chip--on': currency === 'usdc_sol' }"
            @click="currency = 'usdc_sol'"
          >
            USDC
          </button>
        </div>
      </div>

      <div class="field">
        <span class="label">Amount (USD)</span>
        <div class="row gap-1">
          <button
            v-for="a in [25, 50, 100, 250]"
            :key="a"
            class="chip"
            :class="{ 'chip--on': amount === a }"
            @click="amount = a"
          >
            ${{ a }}
          </button>
        </div>
      </div>

      <div class="field">
        <span class="label">Sending to</span>
        <code class="addr num">{{ wallet.address }}</code>
      </div>

      <button class="btn btn--primary btn--lg" :disabled="loading" @click="openWidget">
        {{ loading ? 'Preparing…' : `Continue with MoonPay` }}
      </button>
      <p v-if="error" class="error-text">{{ error }}</p>
    </div>

    <div v-else class="card widget">
      <iframe :src="widgetUrl" title="MoonPay" allow="accelerometer; autoplay; camera; gyroscope; payment" />
    </div>
  </div>
</template>

<style scoped>
.onramp {
  display: flex;
  flex-direction: column;
  gap: 22px;
  max-width: 620px;
}

.chip {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
  font-size: 0.87rem;
}
.chip--on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}

.addr {
  display: block;
  padding: 9px 12px;
  border-radius: var(--radius);
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
  color: var(--fg-muted);
}

.widget {
  padding: 0;
  overflow: hidden;
  height: 640px;
}
.widget iframe {
  width: 100%;
  height: 100%;
  border: 0;
}
</style>
