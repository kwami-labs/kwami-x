<script setup lang="ts">
/**
 * The sign-in gate.
 *
 * A modal over the live Kwami field rather than a page of its own, because the
 * first thing someone should see of this product is Kwamis moving — the sign-in
 * form is the toll, not the attraction. Rendering it as an overlay also means
 * there is no navigation to undo afterwards: dismissing the panel reveals the
 * arena that was already loading behind it.
 *
 * All six methods converge on the same Supabase user, so which tab someone
 * picks changes nothing downstream. Phantom leads because it is the only one
 * that is simultaneously an identity and a way to be paid.
 */
const auth = useAuthStore()
const wallet = useWalletStore()

const emit = defineEmits<{ close: [] }>()
const props = withDefaults(defineProps<{ dismissible?: boolean }>(), { dismissible: false })

type Mode = 'wallet' | 'email' | 'phone'
const mode = ref<Mode>('wallet')

const email = ref('')
const password = ref('')
const phone = ref('')
const otp = ref('')
const otpSent = ref(false)
const signUp = ref(false)
const notice = ref<string | null>(null)
const busy = ref(false)

const panel = useTemplateRef<HTMLElement>('panel')

/** Anything that finished with a session in hand ends the same way. */
function settled() {
  notice.value = null
  emit('close')
}

async function guard(run: () => Promise<void>) {
  notice.value = null
  busy.value = true
  try {
    await run()
  } catch {
    // Every failure path already wrote to `auth.error`; rethrowing here would
    // only produce an unhandled rejection in the console.
  } finally {
    busy.value = false
  }
}

const onPhantom = () =>
  guard(async () => {
    await auth.signInWithPhantom()
    settled()
  })

const onMetaMask = () =>
  guard(async () => {
    await auth.signInWithMetaMask()
    settled()
  })

const onOAuth = (provider: 'google' | 'github') =>
  guard(async () => {
    // Redirects away; `settled` is never reached, and /auth/callback finishes it.
    await auth.signInWithOAuth(provider)
  })

const onEmail = () =>
  guard(async () => {
    if (signUp.value) {
      await auth.signUpWithEmail(email.value, password.value)
      notice.value = 'Check your inbox to confirm the address.'
      return
    }
    await auth.signInWithEmail(email.value, password.value)
    settled()
  })

const onPhone = () =>
  guard(async () => {
    if (!otpSent.value) {
      await auth.signInWithPhone(phone.value)
      otpSent.value = true
      notice.value = 'Code sent.'
      return
    }
    await auth.verifyPhone(phone.value, otp.value)
    settled()
  })

function onBackdrop() {
  if (props.dismissible) emit('close')
}

onMounted(() => {
  // Focus lands inside the panel so a keyboard user is not tabbing through the
  // arena behind the overlay to reach the form in front of them.
  panel.value?.focus()
})

onKeyStroke('Escape', () => {
  if (props.dismissible) emit('close')
})
</script>

<template>
  <div class="gate">
    <KwamiField :count="9" :tempo="0.9" />

    <div class="gate__scrim" @click="onBackdrop" />

    <section
      ref="panel"
      class="glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
      tabindex="-1"
    >
      <button v-if="dismissible" class="glass__close" aria-label="Close" @click="emit('close')">
        &times;
      </button>

      <header class="stack gap-2 glass__head">
        <KwamiMark :size="34" />
        <h2 id="gate-title">Talk your way into the pot.</h2>
        <p class="muted">
          Every Kwami is hiding one phrase and holding real money. Sign in, pick one, and try to talk it out
          of both.
        </p>
      </header>

      <div class="tabs" role="tablist">
        <button
          v-for="tab in ['wallet', 'email', 'phone'] as Mode[]"
          :key="tab"
          role="tab"
          class="tab"
          :class="{ 'tab--on': mode === tab }"
          :aria-selected="mode === tab"
          @click="mode = tab"
        >
          {{ tab === 'wallet' ? 'Wallet' : tab === 'email' ? 'Email' : 'Phone' }}
        </button>
      </div>

      <!-- Wallet -->
      <div v-if="mode === 'wallet'" class="stack gap-2">
        <button
          class="btn btn--primary btn--lg btn--block"
          :disabled="busy || auth.loading"
          @click="onPhantom"
        >
          <span class="dot dot--sol" />
          Continue with Phantom
        </button>
        <button class="btn btn--block" :disabled="busy || auth.loading" @click="onMetaMask">
          Continue with MetaMask
        </button>
        <p class="hint">
          Phantom is a full account — it holds your Kwamis and receives your winnings. MetaMask signs you in
          only; every pot settles on Solana, so you will be asked for a Phantom wallet before any money moves.
        </p>
        <p v-if="wallet.status === 'unavailable'" class="hint">
          No Phantom detected.
          <a href="https://phantom.app/download" target="_blank" rel="noopener" class="linkish">Install it</a>
          — or use email below.
        </p>
      </div>

      <!-- Email -->
      <form v-else-if="mode === 'email'" class="stack gap-2" @submit.prevent="onEmail">
        <div class="field">
          <label class="label" for="gate-email">Email</label>
          <input id="gate-email" v-model="email" class="input" type="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label class="label" for="gate-password">Password</label>
          <input
            id="gate-password"
            v-model="password"
            class="input"
            type="password"
            :autocomplete="signUp ? 'new-password' : 'current-password'"
            required
            minlength="8"
          />
        </div>
        <button class="btn btn--primary btn--block" type="submit" :disabled="busy || auth.loading">
          {{ signUp ? 'Create account' : 'Sign in' }}
        </button>
        <button class="linkish" type="button" @click="signUp = !signUp">
          {{ signUp ? 'I already have an account' : 'Create an account instead' }}
        </button>
      </form>

      <!-- Phone -->
      <form v-else class="stack gap-2" @submit.prevent="onPhone">
        <div class="field">
          <label class="label" for="gate-phone">Phone</label>
          <input
            id="gate-phone"
            v-model="phone"
            class="input"
            type="tel"
            placeholder="+34600000000"
            autocomplete="tel"
            required
          />
        </div>
        <div v-if="otpSent" class="field">
          <label class="label" for="gate-otp">Code</label>
          <input
            id="gate-otp"
            v-model="otp"
            class="input input--mono"
            inputmode="numeric"
            autocomplete="one-time-code"
            required
          />
        </div>
        <button class="btn btn--primary btn--block" type="submit" :disabled="busy || auth.loading">
          {{ otpSent ? 'Verify' : 'Send code' }}
        </button>
      </form>

      <div class="oauth">
        <span class="oauth__rule"><span>or</span></span>
        <div class="oauth__row">
          <button class="btn btn--block" :disabled="busy" @click="onOAuth('google')">Google</button>
          <button class="btn btn--block" :disabled="busy" @click="onOAuth('github')">GitHub</button>
        </div>
      </div>

      <p v-if="notice" class="hint">{{ notice }}</p>
      <p v-if="auth.error" class="error-text">{{ auth.error }}</p>
    </section>
  </div>
</template>

<style scoped>
.gate {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 24px;
  overflow-y: auto;
}

.gate__scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.glass {
  position: relative;
  z-index: 2;
  width: min(440px, 100%);
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 30px 28px;
  border-radius: 26px;
  /* The glass itself: a translucent pane the Kwamis move behind, not a solid
     card that happens to sit on a picture. The saturation boost is what keeps
     their colour visible through the blur instead of washing to grey. */
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03)),
    /* An opaque floor under the translucency. Glass alone is not a background:
       the Kwamis behind it are bright and saturated, and small text over a
       moving one fails every contrast check the moment it drifts past. */
    rgba(10, 11, 17, 0.72);
  backdrop-filter: blur(30px) saturate(150%);
  -webkit-backdrop-filter: blur(30px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow:
    0 30px 80px -30px rgba(0, 0, 0, 0.95),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
  animation: rise 0.42s cubic-bezier(0.16, 1, 0.3, 1);
}

.glass:focus-visible {
  outline: none;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .glass {
    animation: none;
  }
}

.glass__close {
  position: absolute;
  top: 12px;
  right: 16px;
  background: none;
  border: none;
  color: var(--fg-dim);
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}

.glass__close:hover {
  color: var(--fg);
  background: var(--panel-strong);
}

.glass__head h2 {
  font-size: 1.5rem;
  letter-spacing: -0.02em;
}

/* Lifted off `--fg-dim`, which is tuned for a solid panel rather than one with
   a lit object moving behind it. */
.glass :deep(.hint) {
  color: #8b93a7;
}
.glass__head p {
  font-size: 0.92rem;
  margin: 0;
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid var(--border);
}

.tab {
  flex: 1;
  padding: 7px 0;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--fg-muted);
  font-size: 0.88rem;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.tab:hover {
  color: var(--fg);
}
.tab--on {
  background: var(--panel-strong);
  color: var(--fg);
}

.dot--sol {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  margin-right: 8px;
}

.oauth {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.oauth__rule {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--fg-dim);
  font-size: 0.78rem;
}

.oauth__rule::before,
.oauth__rule::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.oauth__row {
  display: flex;
  gap: 8px;
}

@media (max-width: 480px) {
  .gate {
    padding: 12px;
    align-items: start;
  }
  .glass {
    padding: 24px 20px;
  }
}
</style>
