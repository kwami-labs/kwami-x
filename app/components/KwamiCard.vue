<script setup lang="ts">
import { paletteFromMint } from '~/utils/format'

interface KwamiSummary {
  mint: string
  name: string
  tagline: string
  renderer: string
  state: string
  value_cents: number
  prize_lamports: number
  prize_usdc: number
  ticket_price_lamports: number
  ticket_price_usdc: number
  sessions_played: number
  sessions_won: number
  vitality: number
  session_duration: number
}

const props = defineProps<{ kwami: KwamiSummary }>()

const palette = computed(() => paletteFromMint(props.kwami.mint))

const ticket = computed(() => {
  const { ticket_price_lamports: sol, ticket_price_usdc: usdc } = props.kwami
  // Most Kwamis price in one asset; showing "0.05 SOL / 0 USDC" would read as
  // a bug, so only the funded legs are listed.
  const parts: string[] = []
  if (sol > 0) parts.push(formatSol(sol))
  if (usdc > 0) parts.push(formatUsdc(usdc))
  return parts.join(' or ')
})

const stateLabel = computed(() => {
  switch (props.kwami.state) {
    case 'live': return 'Live'
    case 'paused': return 'Paused'
    case 'cracked': return 'Cracked'
    case 'dead': return 'Dead'
    default: return 'Minted'
  }
})
</script>

<template>
  <NuxtLink :to="`/kwami/${kwami.mint}`" class="card card--interactive kcard">
    <div class="kcard__stage">
      <KwamiAvatar
        :renderer="kwami.renderer as never"
        :color-a="palette.a"
        :color-b="palette.b"
        :vitality="kwami.vitality"
      />
      <span class="badge kcard__state" :class="`badge--${kwami.state}`">
        <span v-if="kwami.state === 'live'" class="dot dot--pulse" />
        {{ stateLabel }}
      </span>
    </div>

    <div class="stack gap-1">
      <h3 class="kcard__name">{{ kwami.name }}</h3>
      <p class="kcard__tag muted">{{ kwami.tagline || 'It is not saying.' }}</p>
    </div>

    <div class="kcard__pot">
      <div class="stack">
        <span class="eyebrow">Prize</span>
        <span class="num num--lg gold">{{ formatCents(kwami.value_cents * 0.8) }}</span>
      </div>
      <div class="stack kcard__ticket">
        <span class="eyebrow">Ticket</span>
        <span class="num">{{ ticket }}</span>
      </div>
    </div>

    <VitalityBar :value="kwami.vitality" />

    <div class="kcard__foot dim">
      <span>{{ kwami.sessions_played }} tried</span>
      <span>·</span>
      <span>{{ kwami.sessions_won }} won</span>
      <span>·</span>
      <span>{{ Math.round(kwami.session_duration / 60) }} min</span>
    </div>
  </NuxtLink>
</template>

<style scoped>
.kcard {
  display: flex;
  flex-direction: column;
  gap: 13px;
  padding: 14px;
}

.kcard__stage {
  position: relative;
  height: 156px;
  border-radius: var(--radius);
  overflow: hidden;
  background: radial-gradient(circle at 50% 55%, rgba(255, 255, 255, 0.05), transparent 70%), var(--bg-sunken);
}

.kcard__state { position: absolute; top: 9px; right: 9px; }

.kcard__name { font-size: 1.05rem; }

.kcard__tag {
  font-size: 0.87rem;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.6em;
}

.kcard__pot {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
}

.kcard__ticket { align-items: flex-end; text-align: right; }
.kcard__ticket .num { font-size: 0.88rem; }

.kcard__foot {
  display: flex;
  gap: 7px;
  font-size: 0.8rem;
}
</style>
