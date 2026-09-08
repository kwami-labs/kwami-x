<script setup lang="ts">
/**
 * The account page.
 *
 * Three things in one place, because they are the three questions someone has
 * about their account: who am I here, how do I get back in, and where does my
 * money go. Splitting them across routes would bury the last one, which is the
 * only one that costs anything to get wrong.
 */
import { BIO_MAX, DISPLAY_NAME_MAX } from '#shared/auth/profile'

definePageMeta({ title: 'Account' })

const auth = useAuthStore()
const wallet = useWalletStore()

// Destructured so the template sees plain refs. Reached through the returned
// object they would render as `[object Object]` — Vue only unwraps top-level
// setup bindings.
const {
  draft,
  loaded: profileLoaded,
  saving: profileSaving,
  error: profileError,
  notice: profileNotice,
  load: loadProfile,
  save: saveProfile,
} = useProfile()

const providers = computed(() => (auth.user?.app_metadata?.providers as string[] | undefined) ?? [])
const otherProviders = computed(() => providers.value.filter((p) => p !== 'email'))

const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const emailBusy = ref(false)
const passwordBusy = ref(false)
const emailNotice = ref<string | null>(null)
const passwordNotice = ref<string | null>(null)
const credentialError = ref<string | null>(null)

/** Which address is mid-operation, so only its own row shows a spinner. */
const busyAddress = ref<string | null>(null)
const linking = ref(false)

const connectedIsLinked = computed(() =>
  Boolean(wallet.address && auth.boundAddresses.includes(wallet.address)),
)

watch(
  () => auth.user?.id,
  (id) => {
    if (id) void loadProfile()
  },
  { immediate: true },
)

watch(
  () => auth.recoveryEmail,
  (current) => {
    email.value = current ?? ''
  },
  { immediate: true },
)

async function onSaveEmail() {
  credentialError.value = null
  emailNotice.value = null
  const next = email.value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
    credentialError.value = 'That does not look like an email address.'
    return
  }
  emailBusy.value = true
  try {
    await auth.updateEmail(next)
    emailNotice.value = `Confirm the link we sent to ${next} to finish.`
  } catch {
    credentialError.value = auth.error
  } finally {
    emailBusy.value = false
  }
}

async function onSavePassword() {
  credentialError.value = null
  passwordNotice.value = null
  if (password.value.length < 8) {
    credentialError.value = 'Use at least 8 characters.'
    return
  }
  if (password.value !== passwordConfirm.value) {
    credentialError.value = 'Passwords do not match.'
    return
  }
  passwordBusy.value = true
  try {
    await auth.updatePassword(password.value)
    passwordNotice.value = 'Password set. Email is now a way back in.'
    password.value = ''
    passwordConfirm.value = ''
  } catch {
    credentialError.value = auth.error
  } finally {
    passwordBusy.value = false
  }
}

async function onLinkConnected() {
  linking.value = true
  try {
    if (!wallet.isConnected) await wallet.connect()
    if (wallet.isConnected) await auth.bindWallet()
  } finally {
    linking.value = false
  }
}

/**
 * Move the payout address.
 *
 * Needs the wallet in hand, because the server re-checks the signature before
 * it will point money somewhere new — a page the user was tricked into loading
 * cannot redirect their winnings.
 */
async function onMakePrimary(address: string) {
  if (wallet.address !== address) {
    auth.error = 'Switch to that wallet in Phantom first — moving the payout address needs its signature.'
    return
  }
  busyAddress.value = address
  try {
    await auth.bindWallet(true)
  } finally {
    busyAddress.value = null
  }
}

async function onUnlink(address: string) {
  busyAddress.value = address
  try {
    await auth.unlinkWallet(address)
  } finally {
    busyAddress.value = null
  }
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-6)}`
</script>

<template>
  <div class="wrap stack gap-3">
    <header class="row gap-2">
      <div class="stack gap-1 grow">
        <span class="eyebrow">Account</span>
        <h1>{{ auth.displayName ?? 'Your account' }}</h1>
      </div>
      <NuxtLink to="/me" class="btn btn--ghost">My Kwamis</NuxtLink>
    </header>

    <!-- Who you are in the arena -->
    <section class="card stack gap-2">
      <div class="stack gap-1">
        <h3>Public profile</h3>
        <p class="muted">
          Your handle is what every Kwami you mint is credited to. Without one they are signed with a
          truncated wallet address.
        </p>
      </div>

      <div class="grid grid--2">
        <label class="field">
          <span class="label">Handle</span>
          <div class="row gap-1 handle">
            <span class="dim">@</span>
            <input
              v-model="draft.handle"
              class="input grow"
              placeholder="kwami_labs"
              autocomplete="username"
            />
          </div>
        </label>

        <label class="field">
          <span class="label">Display name</span>
          <input
            v-model="draft.displayName"
            class="input"
            :maxlength="DISPLAY_NAME_MAX"
            placeholder="How you want to be called"
          />
        </label>
      </div>

      <label class="field">
        <span class="label">Avatar URL</span>
        <input v-model="draft.avatarUrl" class="input" placeholder="https://…" inputmode="url" />
      </label>

      <label class="field">
        <span class="row gap-1">
          <span class="label grow">Bio</span>
          <span class="dim">{{ draft.bio.length }}/{{ BIO_MAX }}</span>
        </span>
        <textarea v-model="draft.bio" class="textarea" :maxlength="BIO_MAX" rows="3" />
      </label>

      <p v-if="profileError" class="error-text">{{ profileError }}</p>
      <p v-else-if="profileNotice" class="hint">{{ profileNotice }}</p>

      <button
        class="btn btn--primary self-start"
        :disabled="profileSaving || !profileLoaded"
        @click="saveProfile"
      >
        {{ profileSaving ? 'Saving…' : 'Save profile' }}
      </button>
    </section>

    <!-- How you get back in -->
    <section class="card stack gap-2">
      <div class="stack gap-1">
        <h3>Sign-in</h3>
        <p v-if="!auth.recoveryEmail" class="muted">
          This account has no email on it. Lose the wallet you signed in with and you lose the account — add
          an address and a password so there is another way back.
        </p>
        <p v-else class="muted">Adding a method never removes another one.</p>
      </div>

      <div class="row gap-1 methods">
        <span v-if="auth.recoveryEmail" class="badge">Email</span>
        <span v-for="p in otherProviders" :key="p" class="badge">{{ p }}</span>
        <span v-if="auth.boundAddresses.length" class="badge badge--gold">Phantom</span>
      </div>

      <div class="grid grid--2">
        <label class="field">
          <span class="label">{{ auth.recoveryEmail ? 'Email' : 'Add an email' }}</span>
          <input
            v-model="email"
            class="input"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
          />
        </label>
        <div class="field field--action">
          <button class="btn" :disabled="emailBusy || !email" @click="onSaveEmail">
            {{ emailBusy ? 'Sending…' : auth.recoveryEmail ? 'Change email' : 'Add email' }}
          </button>
        </div>

        <label class="field">
          <span class="label">New password</span>
          <input v-model="password" class="input" type="password" autocomplete="new-password" />
        </label>
        <label class="field">
          <span class="label">Repeat it</span>
          <input v-model="passwordConfirm" class="input" type="password" autocomplete="new-password" />
        </label>
      </div>

      <button class="btn self-start" :disabled="passwordBusy || !password" @click="onSavePassword">
        {{ passwordBusy ? 'Saving…' : 'Set password' }}
      </button>

      <p v-if="credentialError" class="error-text">{{ credentialError }}</p>
      <p v-if="emailNotice" class="hint">{{ emailNotice }}</p>
      <p v-if="passwordNotice" class="hint">{{ passwordNotice }}</p>
    </section>

    <!-- Where the money goes -->
    <section class="card stack gap-2">
      <div class="stack gap-1">
        <h3>Linked wallets</h3>
        <p class="muted">
          A linked wallet is one you have signed for, so the Kwamis it holds and the pots it wins are matched
          to this account. The primary one is where payouts go.
        </p>
      </div>

      <p v-if="auth.wallets.length === 0" class="hint">
        Nothing linked yet — link a wallet and your Kwamis follow you across devices.
      </p>

      <ul v-else class="wallets">
        <li v-for="w in auth.wallets" :key="w.address" class="wallets__row">
          <div class="stack gap-1 grow">
            <span class="num">{{ short(w.address) }}</span>
            <span class="dim">
              {{ w.chain === 'solana' ? 'Solana' : 'Ethereum' }}
              <template v-if="w.address === wallet.address"> · connected now</template>
            </span>
          </div>
          <span v-if="w.isPrimary" class="badge badge--gold">Payout</span>
          <button
            v-else-if="w.chain === 'solana'"
            class="btn btn--sm btn--ghost"
            :disabled="busyAddress === w.address"
            @click="onMakePrimary(w.address)"
          >
            {{ busyAddress === w.address ? 'Waiting…' : 'Pay me here' }}
          </button>
          <button
            class="btn btn--sm btn--danger"
            :disabled="busyAddress === w.address"
            @click="onUnlink(w.address)"
          >
            Unlink
          </button>
        </li>
      </ul>

      <button
        v-if="!connectedIsLinked"
        class="btn btn--primary self-start"
        :disabled="linking"
        @click="onLinkConnected"
      >
        {{ linking ? 'Waiting for Phantom…' : wallet.isConnected ? 'Link this wallet' : 'Connect and link' }}
      </button>

      <p v-if="auth.error" class="error-text" @click="auth.error = null">{{ auth.error }}</p>
    </section>
  </div>
</template>

<style scoped>
.self-start {
  align-self: flex-start;
}

.field--action {
  justify-content: flex-end;
}
.field--action .btn {
  align-self: flex-start;
}

.handle {
  align-items: center;
}

.methods {
  flex-wrap: wrap;
}

.wallets {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wallets__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel);
}
</style>
