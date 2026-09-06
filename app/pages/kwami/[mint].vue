<script setup lang="ts">
import type { KwamiDetailResponse } from '#shared/types/api'
import type { Cluster } from '#shared/solana/constants'
import { explorerUrl } from '#shared/solana/constants'
import { gameById, readVoiceConfig, voiceById } from '#shared/kwami/voice'

const route = useRoute()
const mint = computed(() => route.params.mint as string)

const { data, error } = await useFetch<KwamiDetailResponse>(`/api/kwami/${mint.value}`)
const kwami = computed(() => data.value?.kwami)
const sessions = computed(() => data.value?.recentSessions ?? [])
const wallet = useWalletStore()
const cluster = computed(() => useRuntimeConfig().public.solanaCluster as Cluster)

/**
 * Every account this Kwami is made of.
 *
 * The vault is the one that matters and the one nobody would otherwise be able
 * to find: it is the address actually holding the pot, and a challenger who
 * wants to verify the headline number before paying has to be able to open it
 * on an explorer. The rest are here because "who owns this" and "who made it"
 * are questions with on-chain answers, and paraphrasing them into a handle
 * would hide the only version that can be checked.
 */
/**
 * What the challenger is actually buying.
 *
 * The game mode is a promise, not decoration: it governs what the Kwami's brain
 * is allowed to do with the phrase, and it is the difference between three
 * minutes that can be won and three minutes of stonewalling. Someone deciding
 * whether to pay has to see it before they pay, not discover it afterwards.
 */
const contest = computed(() => {
  const cfg = readVoiceConfig(kwami.value?.voice)
  return { game: gameById(cfg.gameId), voice: voiceById(cfg.voiceId), guard: cfg.guardStrength }
})

const accounts = computed(() => {
  const k = kwami.value
  if (!k) return []
  return [
    { label: 'Pot (vault)', address: k.vault, note: 'Holds the money' },
    { label: 'NFT mint', address: k.mint, note: 'The Kwami itself' },
    { label: 'Owner', address: k.owner_wallet, note: 'Sets the rules, takes the royalty' },
    ...(k.author_wallet && k.author_wallet !== k.owner_wallet
      ? [{ label: 'Creator', address: k.author_wallet, note: 'Minted it' }]
      : []),
  ].filter((a): a is { label: string; address: string; note: string } => Boolean(a.address))
})

const palette = computed(() => paletteFor(kwami.value ?? { mint: mint.value }))
const isOwner = computed(() => wallet.address && kwami.value?.owner_wallet === wallet.address)

const embedSnippet = computed(
  () =>
    `<iframe src="${useRuntimeConfig().public.siteUrl}/embed/${mint.value}" width="360" height="360" frameborder="0" allowtransparency="true" title="${kwami.value?.name ?? 'Kwami'}"></iframe>`,
)

const copied = ref(false)
async function copyEmbed() {
  await navigator.clipboard.writeText(embedSnippet.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1800)
}

useSeoMeta({
  title: () => (kwami.value ? `${kwami.value.name} — Kwami` : 'Kwami'),
  description: () => kwami.value?.tagline ?? '',
})
</script>

<template>
  <div v-if="error" class="wrap card">
    <h2>That Kwami does not exist.</h2>
    <p class="muted">It may never have been minted, or it may be on another cluster.</p>
    <NuxtLink to="/" class="btn btn--ghost">Back to the arena</NuxtLink>
  </div>

  <div v-else-if="kwami" class="wrap detail">
    <section class="detail__stage card">
      <KwamiAvatar
        :renderer="kwami.renderer as never"
        :color-a="palette.a"
        :color-b="palette.b"
        :vitality="kwami.vitality"
      />
      <span class="badge detail__state" :class="`badge--${kwami.state}`">
        <span v-if="kwami.state === 'live'" class="dot dot--pulse" />
        {{ kwami.state }}
      </span>
    </section>

    <section class="detail__body stack gap-3">
      <header class="stack gap-2">
        <h1>{{ kwami.name }}</h1>
        <p class="muted detail__tagline">{{ kwami.tagline }}</p>
        <div class="row gap-2 detail__meta dim">
          <span
            >by
            {{ kwami.author_handle ? `@${kwami.author_handle}` : shortAddress(kwami.author_wallet) }}</span
          >
          <span>·</span>
          <span class="num">{{ shortAddress(kwami.mint, 6, 6) }}</span>
        </div>
      </header>

      <div class="card pot">
        <div class="stack gap-1">
          <span class="eyebrow">If you win</span>
          <span class="num num--xl gold">{{
            formatCents(kwami.value_cents * (kwami.payout_bps / 10000))
          }}</span>
          <span class="dim">
            {{ formatSol(kwami.prize_lamports) }}
            <template v-if="kwami.prize_usdc > 0"> + {{ formatUsdc(kwami.prize_usdc) }}</template>
          </span>
        </div>

        <VitalityBar :value="kwami.vitality" show-label />

        <div class="pot__facts">
          <div>
            <span class="eyebrow">Ticket</span>
            <span class="num">
              <template v-if="kwami.ticket_price_lamports > 0">{{
                formatSol(kwami.ticket_price_lamports)
              }}</template>
              <template v-if="kwami.ticket_price_lamports > 0 && kwami.ticket_price_usdc > 0"> or </template>
              <template v-if="kwami.ticket_price_usdc > 0">{{
                formatUsdc(kwami.ticket_price_usdc)
              }}</template>
            </span>
          </div>
          <div>
            <span class="eyebrow">Clock</span
            ><span class="num">{{ Math.round((kwami.session_duration / 60) * 10) / 10 }} min</span>
          </div>
          <div>
            <span class="eyebrow">Beaten</span
            ><span class="num">{{ kwami.sessions_won }} / {{ kwami.sessions_played }}</span>
          </div>
        </div>

        <NuxtLink
          v-if="kwami.state === 'live'"
          :to="`/play/${kwami.mint}`"
          class="btn btn--gold btn--lg btn--block"
        >
          Challenge it
        </NuxtLink>
        <button v-else class="btn btn--lg btn--block" disabled>
          {{
            kwami.state === 'dead'
              ? 'This Kwami is dead'
              : kwami.state === 'cracked'
                ? 'Already cracked'
                : kwami.state === 'starving'
                  ? 'Out of energy — it cannot answer'
                  : 'Not accepting challengers'
          }}
        </button>
        <!--
          This is the layer that actually protects a challenger. A ticket is
          paid on chain before any server sees it, so refusing in
          `/api/session/start` would mean refusing someone who is already out of
          pocket — saying so here, before the button, is what prevents it.
        -->
        <p v-if="kwami.state === 'starving'" class="hint">
          Its owner has to top it up before it can take another challenger. Nothing has been lost — the pot is
          untouched, and it comes straight back.
        </p>
      </div>

      <div class="card stack gap-2">
        <h3>{{ contest.game.label }}</h3>
        <p class="muted">{{ contest.game.pitch }}</p>
        <div class="contest">
          <div>
            <span class="eyebrow">Voice</span><span>{{ contest.voice.label }}</span>
          </div>
          <div>
            <span class="eyebrow">Guard</span><span class="num">{{ Math.round(contest.guard * 100) }}%</span>
          </div>
          <div>
            <span class="eyebrow">Clock</span
            ><span class="num">{{ Math.round((kwami.session_duration / 60) * 10) / 10 }} min</span>
          </div>
        </div>
        <p class="hint">{{ contest.voice.note }}</p>
      </div>

      <div v-if="kwami.hints?.length" class="card stack gap-2">
        <h3>What it has let slip</h3>
        <ul class="hints">
          <li v-for="(hint, i) in kwami.hints" :key="i">{{ hint }}</li>
        </ul>
      </div>

      <div class="card stack gap-2">
        <h3>How this one settles</h3>
        <p class="muted">
          <template v-if="kwami.resolution_mode === 'commit-reveal'">
            <strong>Commit–reveal.</strong> Its phrase was hashed at mint and written to the chain. If you say
            it, you submit the phrase yourself and the program checks the hash — nothing off chain can deny
            you the pot or hand it to someone else. The phrase becomes public afterwards, so this Kwami
            retires the moment it is beaten.
          </template>
          <template v-else>
            <strong>Attested.</strong> A registered oracle signs your win and the program verifies that
            signature. The phrase stays private, so this Kwami can be played indefinitely — but you are
            trusting the oracle to certify a genuine win.
          </template>
        </p>
      </div>

      <div class="card stack gap-2">
        <h3>Put it on your site</h3>
        <p class="muted">
          Anyone can embed this Kwami. It stays live, it keeps its pot, and it links back here.
        </p>
        <code class="snippet">{{ embedSnippet }}</code>
        <button class="btn btn--sm btn--ghost" @click="copyEmbed">
          {{ copied ? 'Copied' : 'Copy embed code' }}
        </button>
      </div>

      <ActivityFeed :sessions="sessions" :payout-bps="kwami.payout_bps" />

      <div class="card stack gap-2">
        <h3>Accounts</h3>
        <p class="muted">Everything above is checkable. These are the addresses it is checkable at.</p>
        <ul class="accounts">
          <li v-for="a in accounts" :key="a.label">
            <div class="stack">
              <span class="eyebrow">{{ a.label }}</span>
              <span class="dim accounts__note">{{ a.note }}</span>
            </div>
            <a
              :href="explorerUrl(a.address, cluster, 'address')"
              target="_blank"
              rel="noopener"
              class="num accounts__addr"
            >
              {{ shortAddress(a.address, 6, 6) }} ↗
            </a>
          </li>
        </ul>
      </div>

      <div v-if="isOwner" class="card stack gap-2">
        <h3>You own this</h3>
        <div class="row gap-2" style="flex-wrap: wrap">
          <NuxtLink :to="`/builder/${kwami.mint}`" class="btn btn--ghost">Open program builder</NuxtLink>
          <NuxtLink :to="`/kwami/${kwami.mint}/manage`" class="btn btn--ghost">Publish / pause</NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.detail {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  gap: 28px;
  align-items: start;
}

.detail__stage {
  position: relative;
  height: min(62vh, 560px);
  padding: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 55%, rgba(255, 255, 255, 0.05), transparent 70%), var(--bg-sunken);
  position: sticky;
  top: calc(var(--header-h) + 24px);
}

.detail__state {
  position: absolute;
  top: 14px;
  right: 14px;
  text-transform: capitalize;
}
.detail__tagline {
  font-size: 1.05rem;
}
.detail__meta {
  font-size: 0.85rem;
}

.pot {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pot__facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.pot__facts > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pot__facts .num {
  font-size: 0.92rem;
}

.contest {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.contest > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.9rem;
}

.accounts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.accounts li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border);
}

.accounts li:last-child {
  border-bottom: none;
}
.accounts__note {
  font-size: 0.76rem;
}
.accounts__addr {
  font-size: 0.82rem;
  color: var(--fg-muted);
}
.accounts__addr:hover {
  color: var(--fg);
}

.hints {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hints li {
  color: var(--fg-muted);
}

.snippet {
  display: block;
  padding: 11px 13px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: 0.76rem;
  overflow-x: auto;
  white-space: pre;
  color: var(--fg-muted);
}

@media (max-width: 980px) {
  .detail {
    grid-template-columns: 1fr;
  }
  .detail__stage {
    position: static;
    height: 320px;
  }
}
</style>
