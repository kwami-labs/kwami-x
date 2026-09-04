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
const message = ref('Finishing sign-in…')

onMounted(async () => {
  await auth.init()
  if (auth.isSignedIn) {
    await navigateTo('/', { replace: true })
  } else {
    message.value = 'That sign-in did not complete. Try again.'
    setTimeout(() => navigateTo('/auth', { replace: true }), 2200)
  }
})
</script>

<template>
  <div class="callback">
    <KwamiMark :size="34" />
    <p>{{ message }}</p>
  </div>
</template>

<style scoped>
.callback {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--fg-muted);
}
</style>
