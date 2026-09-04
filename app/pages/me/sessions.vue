<script setup lang="ts">
definePageMeta({ title: 'Session history' })

const auth = useAuthStore()
const supabase = useSupabase()

const sessions = ref<Array<Record<string, unknown>>>([])
const loading = ref(false)

async function load() {
  if (!auth.isSignedIn) return
  loading.value = true
  // Reads `my_sessions`, a view that filters on `auth.uid()` — so this query
  // cannot be made to return someone else's history by changing the filter.
  const { data } = await supabase.from('my_sessions').select('*').limit(50)
  sessions.value = data ?? []
  loading.value = false
}

watch(() => auth.isSignedIn, (signedIn) => { if (signedIn) load() }, { immediate: true })

function outcomeTone(outcome: string) {
  if (outcome === 'won') return 'gold'
  if (outcome === 'pending') return 'muted'
  return 'dim'
}
</script>

<template>
  <div class="wrap stack gap-3">
    <header class="stack gap-1">
      <span class="eyebrow">History</span>
      <h1>Everything you have tried.</h1>
    </header>

    <div v-if="!auth.isSignedIn" class="card"><p class="muted">Sign in to see your challenges.</p></div>
    <div v-else-if="loading" class="card"><p class="dim">Loading…</p></div>
    <div v-else-if="sessions.length === 0" class="card">
      <p class="muted">You have not challenged anyone yet.</p>
      <NuxtLink to="/" class="btn btn--ghost" style="align-self: flex-start">Find a Kwami</NuxtLink>
    </div>

    <div v-else class="stack gap-2">
      <div v-for="s in sessions" :key="s.id as string" class="card card--tight row gap-3 histrow">
        <div class="stack gap-1 grow">
          <strong>{{ s.kwami_name }}</strong>
          <span class="dim">{{ relativeTime(s.started_at as string) }}</span>
        </div>
        <div class="stack gap-1 histrow__num">
          <span class="eyebrow">Ticket</span>
          <span class="num">
            {{ s.asset === 'SOL' ? formatSol(s.ticket_amount as number) : formatUsdc(s.ticket_amount as number) }}
          </span>
        </div>
        <div class="stack gap-1 histrow__num">
          <span class="eyebrow">Outcome</span>
          <span class="num" :class="outcomeTone(s.outcome as string)">{{ s.outcome }}</span>
        </div>
        <div v-if="s.outcome === 'won'" class="stack gap-1 histrow__num">
          <span class="eyebrow">Won</span>
          <span class="num gold">{{ formatSol(s.payout_lamports as number) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.histrow { align-items: center; }
.histrow__num { align-items: flex-end; text-align: right; min-width: 96px; }
.histrow__num .num { font-size: 0.92rem; }
</style>
