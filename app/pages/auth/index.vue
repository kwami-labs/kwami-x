<script setup lang="ts">
definePageMeta({ title: 'Sign in' })

const auth = useAuthStore()
const route = useRoute()

const mode = ref<'wallet' | 'email' | 'phone'>('wallet')
const email = ref('')
const password = ref('')
const phone = ref('')
const otp = ref('')
const otpSent = ref(false)
const signUp = ref(false)
const notice = ref<string | null>(null)

const redirect = computed(() => (route.query.next as string) ?? '/')

async function done() {
  await navigateTo(redirect.value)
}

async function onEmail() {
  notice.value = null
  try {
    if (signUp.value) {
      await auth.signUpWithEmail(email.value, password.value)
      notice.value = 'Check your inbox to confirm the address.'
    } else {
      await auth.signInWithEmail(email.value, password.value)
      await done()
    }
  } catch {
    /* surfaced through auth.error */
  }
}

async function onPhone() {
  notice.value = null
  try {
    if (!otpSent.value) {
      await auth.signInWithPhone(phone.value)
      otpSent.value = true
      notice.value = 'Code sent.'
    } else {
      await auth.verifyPhone(phone.value, otp.value)
      await done()
    }
  } catch {
    /* surfaced through auth.error */
  }
}

async function onWallet(kind: 'phantom' | 'metamask') {
  try {
    if (kind === 'phantom') await auth.signInWithPhantom()
    else await auth.signInWithMetaMask()
    await done()
  } catch {
    /* surfaced through auth.error */
  }
}
</script>

<template>
  <div class="wrap authpage">
    <div class="card stack gap-3">
      <header class="stack gap-1">
        <KwamiMark :size="28" />
        <h2>Sign in to Kwami</h2>
        <p class="muted">Any of these get you the same account. You can bind more later.</p>
      </header>

      <div class="row gap-1 tabs">
        <button class="chip" :class="{ 'chip--on': mode === 'wallet' }" @click="mode = 'wallet'">
          Wallet
        </button>
        <button class="chip" :class="{ 'chip--on': mode === 'email' }" @click="mode = 'email'">Email</button>
        <button class="chip" :class="{ 'chip--on': mode === 'phone' }" @click="mode = 'phone'">Phone</button>
      </div>

      <!-- Wallet -->
      <div v-if="mode === 'wallet'" class="stack gap-2">
        <button class="btn btn--primary btn--block" :disabled="auth.loading" @click="onWallet('phantom')">
          Continue with Phantom
        </button>
        <button class="btn btn--block" :disabled="auth.loading" @click="onWallet('metamask')">
          Continue with MetaMask
        </button>
        <p class="hint">
          Phantom is a full account — it can hold Kwamis and receive payouts. MetaMask signs you in but cannot
          hold a Kwami; pots settle on Solana.
        </p>
      </div>

      <!-- Email -->
      <form v-else-if="mode === 'email'" class="stack gap-2" @submit.prevent="onEmail">
        <div class="field">
          <label class="label" for="email">Email</label>
          <input id="email" v-model="email" class="input" type="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label class="label" for="password">Password</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            :autocomplete="signUp ? 'new-password' : 'current-password'"
            required
            minlength="8"
          />
        </div>
        <button class="btn btn--primary btn--block" type="submit" :disabled="auth.loading">
          {{ signUp ? 'Create account' : 'Sign in' }}
        </button>
        <button class="linkish" type="button" @click="signUp = !signUp">
          {{ signUp ? 'I already have an account' : 'Create an account instead' }}
        </button>
      </form>

      <!-- Phone -->
      <form v-else class="stack gap-2" @submit.prevent="onPhone">
        <div class="field">
          <label class="label" for="phone">Phone</label>
          <input
            id="phone"
            v-model="phone"
            class="input"
            type="tel"
            placeholder="+34600000000"
            autocomplete="tel"
            required
          />
        </div>
        <div v-if="otpSent" class="field">
          <label class="label" for="otp">Code</label>
          <input
            id="otp"
            v-model="otp"
            class="input input--mono"
            inputmode="numeric"
            maxlength="8"
            required
          />
        </div>
        <button class="btn btn--primary btn--block" type="submit" :disabled="auth.loading">
          {{ otpSent ? 'Verify' : 'Send code' }}
        </button>
      </form>

      <hr class="divider" />

      <div class="row gap-2">
        <button class="btn btn--block" @click="auth.signInWithOAuth('google')">Google</button>
        <button class="btn btn--block" @click="auth.signInWithOAuth('github')">GitHub</button>
      </div>

      <p v-if="auth.error" class="error-text">{{ auth.error }}</p>
      <p v-if="notice" class="hint">{{ notice }}</p>
    </div>
  </div>
</template>

<style scoped>
.authpage {
  max-width: 420px;
}
.tabs {
  justify-content: center;
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

.linkish {
  background: none;
  border: 0;
  color: var(--fg-muted);
  font-size: 0.84rem;
  cursor: pointer;
  text-align: center;
  padding: 4px;
}
.linkish:hover {
  color: var(--fg);
}
</style>
