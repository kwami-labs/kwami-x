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
 * Layout is progressive disclosure: Phantom first (identity + payouts), then
 * OAuth, then email/phone as secondary paths. Tabs that show every method at
 * once bury the recommended door under equal-weight chrome.
 */
import { isMobileBrowser, phantomDeeplink, PHANTOM_INSTALL_URL } from '~/utils/phantom'

const auth = useAuthStore()
const wallet = useWalletStore()

const emit = defineEmits<{ close: [] }>()
const props = withDefaults(defineProps<{ dismissible?: boolean }>(), { dismissible: false })

type View = 'home' | 'email' | 'phone' | 'forgot' | 'sent'
const view = ref<View>('home')
const emailMode = ref<'signin' | 'signup'>('signin')

const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const showPassword = ref(false)
const phone = ref('')
const otp = ref('')
const otpSent = ref(false)
const notice = ref<string | null>(null)
const localError = ref<string | null>(null)
const busy = ref(false)
const busyAction = ref<string | null>(null)
const moreWallets = ref(false)
const resendIn = ref(0)

const panel = useTemplateRef<HTMLElement>('panel')
const emailInput = useTemplateRef<HTMLInputElement>('emailInput')
const phoneInput = useTemplateRef<HTMLInputElement>('phoneInput')
const otpInput = useTemplateRef<HTMLInputElement>('otpInput')
const mobile = isMobileBrowser()

let resendTimer: ReturnType<typeof setInterval> | null = null

const pending = computed(() => busy.value || auth.loading)
const feedback = computed(() => localError.value || auth.error)

const titles: Record<View, string> = {
  home: 'Talk your way into the pot.',
  email: 'Continue with email',
  phone: 'Continue with phone',
  forgot: 'Reset your password',
  sent: 'Check your inbox',
}

const subtitles: Record<View, string> = {
  home: 'Every Kwami hides a phrase and holds real money. Sign in, pick one, and talk it out of both.',
  email: 'Same account whether you mint, play, or cash out — password stays with you.',
  phone: 'We text a one-time code. No password to remember.',
  forgot: 'Enter the email on your account and we will send a reset link.',
  sent: 'Confirm the address, then come back — your session will be waiting.',
}

const headline = computed(() => {
  if (view.value === 'email' && emailMode.value === 'signup') return 'Create your account'
  return titles[view.value]
})

const subcopy = computed(() => {
  if (view.value === 'email' && emailMode.value === 'signup') {
    return 'One account for every Kwami you mint, play, or win.'
  }
  return subtitles[view.value]
})

const passwordStrength = computed(() => {
  const p = password.value
  if (!p) return null
  let score = 0
  if (p.length >= 8) score++
  if (p.length >= 12) score++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++
  if (/\d/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  if (score <= 2) return { label: 'Weak', tone: 'weak' as const }
  if (score <= 3) return { label: 'Okay', tone: 'ok' as const }
  return { label: 'Strong', tone: 'strong' as const }
})

function settled() {
  notice.value = null
  localError.value = null
  emit('close')
}

function clearFeedback() {
  notice.value = null
  localError.value = null
  auth.error = null
}

/**
 * Switch between signing in and signing up.
 *
 * A function rather than a multi-statement inline handler. Vue's expression
 * parser needs statements separated by semicolons, and Prettier strips those
 * out of an attribute every time it formats — so the inline form made
 * `bun run format` and `bun run build` mutually exclusive, and whichever ran
 * last decided whether the app compiled.
 *
 * Clearing the confirmation field matters on the way back to sign-in: leaving a
 * half-typed password behind in a hidden input is a surprise the next submit
 * would deliver.
 */
function setEmailMode(mode: 'signin' | 'signup') {
  emailMode.value = mode
  clearFeedback()
  passwordConfirm.value = ''
}

function go(next: View) {
  clearFeedback()
  view.value = next
  if (next === 'home') {
    otpSent.value = false
    otp.value = ''
    moreWallets.value = false
  }
  nextTick(() => {
    if (next === 'email' || next === 'forgot') emailInput.value?.focus()
    else if (next === 'phone') (otpSent.value ? otpInput.value : phoneInput.value)?.focus()
    else panel.value?.focus()
  })
}

function startResendCooldown(seconds = 30) {
  resendIn.value = seconds
  if (resendTimer) clearInterval(resendTimer)
  resendTimer = setInterval(() => {
    resendIn.value -= 1
    if (resendIn.value <= 0 && resendTimer) {
      clearInterval(resendTimer)
      resendTimer = null
    }
  }, 1000)
}

async function guard(run: () => Promise<void>, action?: string) {
  clearFeedback()
  busy.value = true
  busyAction.value = action ?? null
  try {
    await run()
  } catch {
    // Failures already wrote to `auth.error` / `localError`.
  } finally {
    busy.value = false
    busyAction.value = null
  }
}

const onPhantom = () =>
  guard(async () => {
    if (wallet.status === 'unavailable' && mobile) {
      window.location.href = phantomDeeplink()
      return
    }
    await auth.signInWithPhantom()
    settled()
  }, 'phantom')

const onMetaMask = () =>
  guard(async () => {
    await auth.signInWithMetaMask()
    settled()
  }, 'metamask')

const onOAuth = (provider: 'google' | 'github') =>
  guard(async () => {
    await auth.signInWithOAuth(provider)
  }, provider)

const onEmail = () =>
  guard(async () => {
    if (emailMode.value === 'signup') {
      if (password.value.length < 8) {
        localError.value = 'Use at least 8 characters.'
        return
      }
      if (password.value !== passwordConfirm.value) {
        localError.value = 'Passwords do not match.'
        return
      }
      await auth.signUpWithEmail(email.value, password.value)
      notice.value = `We sent a confirmation link to ${email.value}.`
      view.value = 'sent'
      return
    }
    await auth.signInWithEmail(email.value, password.value)
    settled()
  }, 'email')

const onForgot = () =>
  guard(async () => {
    await auth.resetPassword(email.value)
    notice.value = `Reset link sent to ${email.value}.`
    view.value = 'sent'
  }, 'forgot')

const onPhone = () =>
  guard(async () => {
    if (!otpSent.value) {
      await auth.signInWithPhone(phone.value)
      otpSent.value = true
      notice.value = 'Code sent — it expires in a few minutes.'
      startResendCooldown()
      nextTick(() => otpInput.value?.focus())
      return
    }
    await auth.verifyPhone(phone.value, otp.value.trim())
    settled()
  }, 'phone')

const onResendOtp = () =>
  guard(async () => {
    if (resendIn.value > 0) return
    await auth.signInWithPhone(phone.value)
    notice.value = 'New code sent.'
    startResendCooldown()
  }, 'resend')

function onBackdrop() {
  if (props.dismissible) emit('close')
}

function onBack() {
  if (view.value === 'forgot') go('email')
  else if (view.value === 'sent') go(emailMode.value === 'signup' || email.value ? 'email' : 'home')
  else if (view.value === 'phone' && otpSent.value) {
    otpSent.value = false
    otp.value = ''
    clearFeedback()
    nextTick(() => phoneInput.value?.focus())
  } else go('home')
}

onMounted(() => {
  panel.value?.focus()
})

onBeforeUnmount(() => {
  if (resendTimer) clearInterval(resendTimer)
})

onKeyStroke('Escape', () => {
  if (props.dismissible) emit('close')
  else if (view.value !== 'home') onBack()
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
      aria-describedby="gate-desc"
      tabindex="-1"
    >
      <button v-if="dismissible" class="glass__close" aria-label="Close" type="button" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>

      <header class="stack gap-2 glass__head">
        <div class="glass__brand">
          <button
            v-if="view !== 'home'"
            class="back"
            type="button"
            aria-label="Back"
            :disabled="pending"
            @click="onBack"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M10 3L5 8l5 5"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <KwamiMark :size="32" />
        </div>
        <h2 id="gate-title">{{ headline }}</h2>
        <p id="gate-desc" class="muted">{{ subcopy }}</p>
      </header>

      <!-- Home: recommended path first -->
      <div v-if="view === 'home'" class="stack gap-3">
        <div class="stack gap-2">
          <button class="btn btn--primary btn--lg btn--block method" :disabled="pending" @click="onPhantom">
            <span v-if="busyAction === 'phantom'" class="spinner" aria-hidden="true" />
            <span v-else class="method__icon method__icon--phantom" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M12 3c-4.2 0-7.5 2.9-7.5 7.1V14c0 .8.3 1.4.8 1.8.3.3.4.7.3 1.1l-.5 1.7c-.2.6.4 1.1.9.9l2.1-.8c.3-.1.6-.1.9 0 1 .4 2.1.6 3 .6s2-.2 3-.6c.3-.1.6-.1.9 0l2.1.8c.5.2 1.1-.3.9-.9l-.5-1.7c-.1-.4 0-.8.3-1.1.5-.4.8-1 .8-1.8v-3.9C19.5 5.9 16.2 3 12 3zm-2.6 7.4a1.2 1.2 0 110-2.4 1.2 1.2 0 010 2.4zm5.2 0a1.2 1.2 0 110-2.4 1.2 1.2 0 010 2.4z"
                />
              </svg>
            </span>
            <span class="method__label">
              <strong>{{ busyAction === 'phantom' ? 'Waiting on wallet…' : 'Continue with Phantom' }}</strong>
              <small>Sign in and get paid on Solana</small>
            </span>
            <span class="method__tag">Best</span>
          </button>

          <p v-if="wallet.status === 'unavailable'" class="hint hint--box">
            <template v-if="mobile">
              Open this page in
              <a :href="phantomDeeplink()" class="linkish">Phantom</a>
              to use your wallet — or pick email below.
            </template>
            <template v-else>
              No Phantom detected.
              <a :href="PHANTOM_INSTALL_URL" target="_blank" rel="noopener" class="linkish">Install it</a>
              — or continue with email.
            </template>
          </p>
        </div>

        <div class="oauth">
          <span class="oauth__rule"><span>or</span></span>
          <div class="oauth__row">
            <button
              class="btn btn--block social"
              :disabled="pending"
              type="button"
              @click="onOAuth('google')"
            >
              <span v-if="busyAction === 'google'" class="spinner" aria-hidden="true" />
              <svg v-else width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M9 7.2v3.6h5.1c-.2 1.2-.9 2.2-1.9 2.9l3 2.3C16.9 14.3 18 12 18 9c0-.7-.1-1.3-.2-1.8H9z"
                />
                <path
                  fill="#34A853"
                  d="M3.9 10.7l-.6.5-2.1 1.6C2.6 15.7 5.5 18 9 18c2.4 0 4.4-.8 5.9-2.1l-3-2.3c-.8.6-1.9.9-2.9.9-2.2 0-4.1-1.5-4.8-3.5z"
                />
                <path
                  fill="#4A90E2"
                  d="M1.2 5.2C.4 6.7 0 8.3 0 10s.4 3.3 1.2 4.8l3.3-2.6C4.2 11.5 4 10.8 4 10s.2-1.5.5-2.2L1.2 5.2z"
                />
                <path
                  fill="#FBBC05"
                  d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.5-2.5C13.4.9 11.4 0 9 0 5.5 0 2.6 2.3 1.2 5.2l3.3 2.6C5 5.1 6.8 3.6 9 3.6z"
                />
              </svg>
              {{ busyAction === 'google' ? 'Redirecting…' : 'Google' }}
            </button>
            <button
              class="btn btn--block social"
              :disabled="pending"
              type="button"
              @click="onOAuth('github')"
            >
              <span v-if="busyAction === 'github'" class="spinner" aria-hidden="true" />
              <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path
                  d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
                />
              </svg>
              {{ busyAction === 'github' ? 'Redirecting…' : 'GitHub' }}
            </button>
          </div>
        </div>

        <div class="alt">
          <button class="alt__chip" type="button" :disabled="pending" @click="go('email')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 6.5A1.5 1.5 0 015.5 5h13A1.5 1.5 0 0120 6.5v11a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5v-11z"
                stroke="currentColor"
                stroke-width="1.6"
              />
              <path
                d="M5 7l7 5 7-5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            Email
          </button>
          <button class="alt__chip" type="button" :disabled="pending" @click="go('phone')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="7" y="3" width="10" height="18" rx="2.2" stroke="currentColor" stroke-width="1.6" />
              <path d="M10 17.5h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            Phone
          </button>
        </div>

        <div class="more">
          <button
            class="more__toggle linkish"
            type="button"
            :disabled="pending"
            @click="moreWallets = !moreWallets"
          >
            {{ moreWallets ? 'Hide other wallets' : 'Other wallets' }}
          </button>
          <div v-if="moreWallets" class="stack gap-2 more__body">
            <button class="btn btn--block" :disabled="pending" type="button" @click="onMetaMask">
              <span v-if="busyAction === 'metamask'" class="spinner" aria-hidden="true" />
              {{ busyAction === 'metamask' ? 'Waiting on wallet…' : 'Continue with MetaMask' }}
            </button>
            <p class="hint">
              MetaMask signs you in only. Pots settle on Solana — you will connect Phantom before any money
              moves.
            </p>
          </div>
        </div>

        <button v-if="dismissible" class="browse" type="button" :disabled="pending" @click="emit('close')">
          Continue browsing
        </button>
      </div>

      <!-- Email -->
      <form v-else-if="view === 'email'" class="stack gap-3" @submit.prevent="onEmail">
        <div class="tabs" role="tablist" aria-label="Email mode">
          <button
            type="button"
            role="tab"
            class="tab"
            :class="{ 'tab--on': emailMode === 'signin' }"
            :aria-selected="emailMode === 'signin'"
            :disabled="pending"
            @click="setEmailMode('signin')"
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            class="tab"
            :class="{ 'tab--on': emailMode === 'signup' }"
            :aria-selected="emailMode === 'signup'"
            :disabled="pending"
            @click="setEmailMode('signup')"
          >
            Create account
          </button>
        </div>

        <div class="stack gap-2">
          <div class="field">
            <label class="label" for="gate-email">Email</label>
            <input
              id="gate-email"
              ref="emailInput"
              v-model="email"
              class="input"
              type="email"
              autocomplete="email"
              inputmode="email"
              required
              :disabled="pending"
            />
          </div>

          <div class="field">
            <div class="label-row">
              <label class="label" for="gate-password">Password</label>
              <button
                v-if="emailMode === 'signin'"
                class="linkish label-row__action"
                type="button"
                :disabled="pending"
                @click="go('forgot')"
              >
                Forgot?
              </button>
            </div>
            <div class="input-wrap">
              <input
                id="gate-password"
                v-model="password"
                class="input"
                :type="showPassword ? 'text' : 'password'"
                :autocomplete="emailMode === 'signup' ? 'new-password' : 'current-password'"
                required
                minlength="8"
                :disabled="pending"
              />
              <button
                class="input-wrap__toggle"
                type="button"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                :disabled="pending"
                @click="showPassword = !showPassword"
              >
                <svg
                  v-if="!showPassword"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
                    stroke="currentColor"
                    stroke-width="1.6"
                  />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" />
                </svg>
                <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M3 3l18 18M10.5 10.7A3 3 0 0013.3 13.5M9.9 5.1A10.4 10.4 0 0112 5c6.5 0 10 7 10 7a18.4 18.4 0 01-4.2 4.6M6.1 6.2A18 18 0 002 12s3.5 7 10 7c1.3 0 2.5-.3 3.6-.7"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </div>
            <p
              v-if="emailMode === 'signup' && passwordStrength"
              class="strength"
              :data-tone="passwordStrength.tone"
            >
              <span class="strength__bar" /><span class="strength__bar" /><span class="strength__bar" />
              {{ passwordStrength.label }}
            </p>
          </div>

          <div v-if="emailMode === 'signup'" class="field">
            <label class="label" for="gate-password-confirm">Confirm password</label>
            <input
              id="gate-password-confirm"
              v-model="passwordConfirm"
              class="input"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              required
              minlength="8"
              :disabled="pending"
            />
          </div>
        </div>

        <button class="btn btn--primary btn--block btn--lg" type="submit" :disabled="pending">
          <span v-if="pending" class="spinner" aria-hidden="true" />
          <template v-if="pending">{{ emailMode === 'signup' ? 'Creating…' : 'Signing in…' }}</template>
          <template v-else>{{ emailMode === 'signup' ? 'Create account' : 'Sign in' }}</template>
        </button>
      </form>

      <!-- Forgot password -->
      <form v-else-if="view === 'forgot'" class="stack gap-3" @submit.prevent="onForgot">
        <div class="field">
          <label class="label" for="gate-forgot-email">Email</label>
          <input
            id="gate-forgot-email"
            ref="emailInput"
            v-model="email"
            class="input"
            type="email"
            autocomplete="email"
            required
            :disabled="pending"
          />
        </div>
        <button class="btn btn--primary btn--block btn--lg" type="submit" :disabled="pending">
          <span v-if="pending" class="spinner" aria-hidden="true" />
          {{ pending ? 'Sending…' : 'Send reset link' }}
        </button>
      </form>

      <!-- Email sent -->
      <div v-else-if="view === 'sent'" class="stack gap-3 sent">
        <div class="sent__mark" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="var(--success)" stroke-width="1.6" opacity="0.35" />
            <path
              d="M7.5 12.5l3 3 6-7"
              stroke="var(--success)"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <p class="sent__body">{{ notice }}</p>
        <button class="btn btn--block" type="button" @click="go('home')">Back to sign in</button>
        <button v-if="dismissible" class="browse" type="button" @click="emit('close')">
          Continue browsing
        </button>
      </div>

      <!-- Phone -->
      <form v-else class="stack gap-3" @submit.prevent="onPhone">
        <div class="field">
          <label class="label" for="gate-phone">Phone</label>
          <input
            id="gate-phone"
            ref="phoneInput"
            v-model="phone"
            class="input input--mono"
            type="tel"
            placeholder="+1 555 000 0000"
            autocomplete="tel"
            required
            :disabled="pending || otpSent"
          />
          <p class="hint">Include country code, e.g. +34…</p>
        </div>

        <div v-if="otpSent" class="field">
          <div class="label-row">
            <label class="label" for="gate-otp">Verification code</label>
            <button
              class="linkish label-row__action"
              type="button"
              :disabled="pending || resendIn > 0"
              @click="onResendOtp"
            >
              {{ resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code' }}
            </button>
          </div>
          <input
            id="gate-otp"
            ref="otpInput"
            v-model="otp"
            class="input input--mono input--otp"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]*"
            maxlength="8"
            placeholder="••••••"
            required
            :disabled="pending"
          />
        </div>

        <button class="btn btn--primary btn--block btn--lg" type="submit" :disabled="pending">
          <span v-if="pending" class="spinner" aria-hidden="true" />
          <template v-if="pending">{{ otpSent ? 'Verifying…' : 'Sending…' }}</template>
          <template v-else>{{ otpSent ? 'Verify and continue' : 'Send code' }}</template>
        </button>
      </form>

      <div class="status" aria-live="polite">
        <p v-if="notice && view !== 'sent'" class="hint hint--ok">{{ notice }}</p>
        <p v-if="feedback" class="error-text" role="alert">{{ feedback }}</p>
      </div>
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
  background: rgba(4, 5, 10, 0.28);
}

.glass {
  position: relative;
  z-index: 2;
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 28px 26px 24px;
  border-radius: 26px;
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03)), rgba(10, 11, 17, 0.78);
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

.glass__close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  color: var(--fg-muted);
  cursor: pointer;
  border-radius: var(--radius-pill);
  transition:
    color 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease;
}

.glass__close:hover {
  color: var(--fg);
  background: var(--panel-strong);
  border-color: var(--border-strong);
}

.glass__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
}

.back {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-left: -6px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.back:hover:not(:disabled) {
  color: var(--fg);
  background: var(--panel-strong);
}

.back:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.glass__head h2 {
  font-size: 1.45rem;
  letter-spacing: -0.025em;
}

.glass :deep(.hint) {
  color: #8b93a7;
}

.glass__head p {
  font-size: 0.92rem;
  margin: 0;
  line-height: 1.45;
}

.method {
  justify-content: flex-start;
  gap: 12px;
  padding-inline: 16px;
  text-align: left;
  position: relative;
}

.method__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  flex-shrink: 0;
  background: rgba(10, 7, 21, 0.18);
}

.method__icon--phantom {
  color: #0a0715;
}

.method__label {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 0;
  flex: 1;
  line-height: 1.2;
}

.method__label strong {
  font-weight: 650;
  font-size: 0.98rem;
}

.method__label small {
  font-size: 0.74rem;
  font-weight: 500;
  opacity: 0.72;
}

.method__tag {
  position: absolute;
  top: -8px;
  right: 14px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: var(--gold);
  color: #201703;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.hint--box {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid var(--border);
  line-height: 1.4;
}

.hint--ok {
  color: var(--success) !important;
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
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.social {
  gap: 8px;
}

.alt {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.alt__chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 12px;
  border-radius: var(--radius);
  border: 1px dashed var(--border-strong);
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 550;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.alt__chip:hover:not(:disabled) {
  color: var(--fg);
  border-style: solid;
  background: var(--panel);
}

.alt__chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.more {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.more__toggle {
  font-size: 0.82rem;
  color: var(--fg-muted);
}

.more__body {
  width: 100%;
}

.browse {
  display: block;
  width: 100%;
  margin: 0;
  padding: 4px;
  border: none;
  background: none;
  color: var(--fg-dim);
  font: inherit;
  font-size: 0.84rem;
  cursor: pointer;
  text-align: center;
}

.browse:hover:not(:disabled) {
  color: var(--fg-muted);
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
  padding: 8px 0;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--fg-muted);
  font-size: 0.88rem;
  font-weight: 550;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.tab:hover:not(:disabled) {
  color: var(--fg);
}

.tab--on {
  background: var(--panel-strong);
  color: var(--fg);
}

.tab:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.label-row__action {
  font-size: 0.78rem;
  color: var(--fg-muted);
}

.input-wrap {
  position: relative;
}

.input-wrap .input {
  padding-right: 44px;
}

.input-wrap__toggle {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}

.input-wrap__toggle:hover:not(:disabled) {
  color: var(--fg);
  background: var(--panel);
}

.input--otp {
  letter-spacing: 0.28em;
  text-align: center;
  font-size: 1.15rem;
  padding-block: 14px;
}

.strength {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 0.74rem;
  color: var(--fg-dim);
}

.strength__bar {
  width: 18px;
  height: 3px;
  border-radius: 2px;
  background: var(--border-strong);
}

.strength[data-tone='weak'] .strength__bar:nth-child(1) {
  background: var(--danger);
}
.strength[data-tone='ok'] .strength__bar:nth-child(-n + 2) {
  background: var(--warn);
}
.strength[data-tone='strong'] .strength__bar {
  background: var(--success);
}
.strength[data-tone='weak'] {
  color: var(--danger);
}
.strength[data-tone='ok'] {
  color: var(--warn);
}
.strength[data-tone='strong'] {
  color: var(--success);
}

.sent {
  align-items: stretch;
  text-align: center;
}

.sent__mark {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-inline: auto;
  border-radius: 50%;
  background: rgba(61, 220, 151, 0.1);
  border: 1px solid rgba(61, 220, 151, 0.28);
  animation: pop 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.sent__body {
  margin: 0;
  color: var(--fg-muted);
  font-size: 0.95rem;
}

.status:empty {
  display: none;
}

.status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 1.8px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 480px) {
  .gate {
    padding: 12px;
    align-items: end;
  }
  .glass {
    width: 100%;
    padding: 24px 18px 20px;
    border-radius: 22px 22px 18px 18px;
    margin-bottom: env(safe-area-inset-bottom, 0);
  }
  .glass__head h2 {
    font-size: 1.28rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .glass,
  .sent__mark {
    animation: none;
  }
  .spinner {
    animation: none;
    border-right-color: currentColor;
    opacity: 0.7;
  }
}
</style>
