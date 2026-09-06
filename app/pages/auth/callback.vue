<script setup lang="ts">
definePageMeta({ layout: false })

/**
 * OAuth landing page.
 *
 * Supabase parses the PKCE code out of the URL on client init, so all this has
 * to do is wait for the session to materialise and get out of the way. It
 * renders a bare screen rather than the full layout because a flash of header
 * and navigation before an immediate redirect looks like a broken page load.
 */
const auth = useAuthStore()
const status = ref<'working' | 'ok' | 'fail'>('working')
const message = ref('Finishing sign-in…')

onMounted(async () => {
  await auth.init()
  if (auth.isSignedIn) {
    status.value = 'ok'
    message.value = 'You are in — taking you back.'
    await navigateTo('/', { replace: true })
  } else {
    status.value = 'fail'
    message.value = 'That sign-in did not complete.'
  }
})

async function retry() {
  await navigateTo('/auth', { replace: true })
}
</script>

<template>
  <div class="callback">
    <KwamiField :count="5" :tempo="0.7" />
    <div class="callback__panel">
      <KwamiMark :size="36" />
      <div class="callback__body">
        <span v-if="status === 'working'" class="spinner" aria-hidden="true" />
        <span v-else-if="status === 'ok'" class="ok" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 12.5l4 4 8-9"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <p>{{ message }}</p>
      </div>
      <button v-if="status === 'fail'" class="btn btn--primary" type="button" @click="retry">
        Try again
      </button>
    </div>
  </div>
</template>

<style scoped>
.callback {
  position: relative;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  overflow: hidden;
}

.callback__panel {
  position: relative;
  z-index: 2;
  width: min(360px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 28px 24px;
  border-radius: 24px;
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03)), rgba(10, 11, 17, 0.78);
  backdrop-filter: blur(28px) saturate(150%);
  -webkit-backdrop-filter: blur(28px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.95);
  text-align: center;
}

.callback__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--fg-muted);
}

.callback__body p {
  margin: 0;
  font-size: 0.95rem;
}

.spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--fg-dim);
  border-right-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

.ok {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: var(--success);
  background: rgba(61, 220, 151, 0.12);
  border: 1px solid rgba(61, 220, 151, 0.3);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
    border-right-color: var(--fg-dim);
  }
}
</style>
