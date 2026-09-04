<script setup lang="ts">
const route = useRoute()
const mint = computed(() => route.params.mint as string)

const { data, error } = await useFetch(`/api/kwami/${mint.value}`)
const kwami = computed(() => data.value?.kwami)
const wallet = useWalletStore()

const palette = computed(() => paletteFromMint(mint.value))
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
          <span>by {{ kwami.author_handle ? `@${kwami.author_handle}` : shortAddress(kwami.author_wallet) }}</span>
          <span>·</span>
          <span class="num">{{ shortAddress(kwami.mint, 6, 6) }}</span>
        </div>
      </header>

      <div class="card pot">
        <div class="stack gap-1">
          <span class="eyebrow">If you win</span>
          <span class="num num--xl gold">{{ formatCents(kwami.value_cents * (kwami.payout_bps / 10000)) }}</span>
          <span class="dim">
            {{ formatSol(kwami.prize_lamports) }}
            <template v-if="kwami.prize_usdc > 0"> + {{ formatUsdc(kwami.prize_usdc) }}</template>
          </span>
        </div>

        <VitalityBar :value="kwami.vitality" show-label />

        <div class="pot__facts">
          <div><span class="eyebrow">Ticket</span>
            <span class="num">
              <template v-if="kwami.ticket_price_lamports > 0">{{ formatSol(kwami.ticket_price_lamports) }}</template>
              <template v-if="kwami.ticket_price_lamports > 0 && kwami.ticket_price_usdc > 0"> or </template>
              <template v-if="kwami.ticket_price_usdc > 0">{{ formatUsdc(kwami.ticket_price_usdc) }}</template>
            </span>
          </div>
          <div><span class="eyebrow">Clock</span><span class="num">{{ Math.round(kwami.session_duration / 60 * 10) / 10 }} min</span></div>
          <div><span class="eyebrow">Beaten</span><span class="num">{{ kwami.sessions_won }} / {{ kwami.sessions_played }}</span></div>
        </div>

        <NuxtLink
          v-if="kwami.state === 'live'"
          :to="`/play/${kwami.mint}`"
          class="btn btn--gold btn--lg btn--block"
        >
          Challenge it
        </NuxtLink>
        <button v-else class="btn btn--lg btn--block" disabled>
          {{ kwami.state === 'dead' ? 'This Kwami is dead' : kwami.state === 'cracked' ? 'Already cracked' : 'Not accepting challengers' }}
        </button>
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
            <strong>Commit–reveal.</strong> Its phrase was hashed at mint and written to the chain. If you say it, you
            submit the phrase yourself and the program checks the hash — nothing off chain can deny you the pot or hand
            it to someone else. The phrase becomes public afterwards, so this Kwami retires the moment it is beaten.
          </template>
          <template v-else>
            <strong>Attested.</strong> A registered oracle signs your win and the program verifies that signature. The
            phrase stays private, so this Kwami can be played indefinitely — but you are trusting the oracle to certify
            a genuine win.
          </template>
        </p>
      </div>

      <div class="card stack gap-2">
        <h3>Put it on your site</h3>
        <p class="muted">Anyone can embed this Kwami. It stays live, it keeps its pot, and it links back here.</p>
        <code class="snippet">{{ embedSnippet }}</code>
        <button class="btn btn--sm btn--ghost" @click="copyEmbed">{{ copied ? 'Copied' : 'Copy embed code' }}</button>
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
  background: radial-gradient(circle at 50% 55%, rgba(255, 255, 255, 0.05), transparent 70%), var(--bg-sunken);
  position: sticky;
  top: calc(var(--header-h) + 24px);
}

.detail__state { position: absolute; top: 14px; right: 14px; text-transform: capitalize; }
.detail__tagline { font-size: 1.05rem; }
.detail__meta { font-size: 0.85rem; }

.pot { display: flex; flex-direction: column; gap: 16px; }

.pot__facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.pot__facts > div { display: flex; flex-direction: column; gap: 2px; }
.pot__facts .num { font-size: 0.92rem; }

.hints { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
.hints li { color: var(--fg-muted); }

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
  .detail { grid-template-columns: 1fr; }
  .detail__stage { position: static; height: 320px; }
}
</style>
