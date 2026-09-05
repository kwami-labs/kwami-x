<script setup lang="ts">
/**
 * The sign-in route.
 *
 * Deliberately thin: it renders the same panel the gate overlays everywhere
 * else, so there is one sign-in implementation rather than two that drift.
 * The route still exists because links to it do — from emails, from OAuth
 * error paths, from anyone who bookmarked it — and it is where `?next=` is
 * honoured, which the overlay has no need for since it never navigated away.
 */
definePageMeta({ title: 'Sign in', layout: false })

const route = useRoute()
const auth = useAuthStore()

const next = computed(() => {
  const raw = route.query.next
  // Only same-site paths. A `next` of `https://elsewhere.example` would turn
  // this route into an open redirect that borrows Kwami's domain for a phish.
  return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
})

async function done() {
  await navigateTo(next.value)
}

// Someone who is already signed in has no business on a sign-in screen.
watchEffect(() => {
  if (auth.ready && auth.isSignedIn) void done()
})

useSeoMeta({ title: 'Sign in — Kwami' })
</script>

<template>
  <AuthModal @close="done" />
</template>
