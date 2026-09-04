<script setup lang="ts">
const { data, pending } = await useFetch('/api/kwami', { query: { state: 'live', limit: 24 } })

const kwamis = computed(() => data.value?.kwamis ?? [])
const totals = computed(() => data.value?.totals ?? { pot: 0, live: 0, sessions: 0 })

useSeoMeta({
  title: 'Kwami — talk your way into the pot',
  ogTitle: 'Kwami — talk your way into the pot',
  description:
    'Each Kwami guards a secret and a pot. Buy three minutes, talk to it, and if you say the phrase it is hiding you take 80% of everything it holds.',
})
</script>

<template>
  <div class="wrap stack gap-4">
    <section class="hero">
      <div class="hero__copy stack gap-3">
        <span class="eyebrow">Solana · voice · winner takes 80%</span>
        <h1>
          Every Kwami is<br >
          hiding one phrase.
        </h1>
        <p class="hero__lede muted">
          Buy three minutes with someone else's Kwami. Talk to it, push it, trick it. Say the phrase it is
          guarding before the clock runs out and 80% of its pot is yours. Miss, and your ticket makes the pot
          bigger for whoever comes next.
        </p>
        <div class="row gap-2 hero__cta">
          <NuxtLink to="#arena" class="btn btn--primary btn--lg">Find a Kwami</NuxtLink>
          <NuxtLink to="/mint" class="btn btn--ghost btn--lg">Mint your own</NuxtLink>
        </div>
      </div>

      <div class="hero__stats card">
        <div class="stat">
          <span class="eyebrow">Total pots</span>
          <span class="num num--xl gold">{{ formatCents(totals.pot) }}</span>
        </div>
        <hr class="divider" >
        <div class="row gap-4">
          <div class="stat">
            <span class="eyebrow">Live</span>
            <span class="num num--lg">{{ totals.live }}</span>
          </div>
          <div class="stat">
            <span class="eyebrow">Challenges</span>
            <span class="num num--lg">{{ totals.sessions }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="rules card">
      <ol class="rules__list">
        <li>
          <span class="rules__n">1</span>
          <div>
            <strong>Pay the ticket</strong>
            <p class="muted">In SOL or USDC. 97.5% of it goes straight into that Kwami's pot.</p>
          </div>
        </li>
        <li>
          <span class="rules__n">2</span>
          <div>
            <strong>Three minutes of voice</strong>
            <p class="muted">Talk to it. It knows its phrase and it does not want to give it up.</p>
          </div>
        </li>
        <li>
          <span class="rules__n">3</span>
          <div>
            <strong>Say the phrase, take 80%</strong>
            <p class="muted">Settled on chain against a hash committed when the Kwami was minted.</p>
          </div>
        </li>
      </ol>
    </section>

    <section id="arena" class="stack gap-3">
      <div class="row gap-2">
        <h2 class="grow">The arena</h2>
        <NuxtLink to="/leaderboard" class="btn btn--sm btn--ghost">Leaderboard</NuxtLink>
      </div>

      <div v-if="pending" class="grid grid--cards">
        <div v-for="i in 6" :key="i" class="card skeleton" />
      </div>

      <div v-else-if="kwamis.length === 0" class="card empty">
        <h3>No Kwami is live yet.</h3>
        <p class="muted">Be the first — mint one, hide a phrase in it, and let the arena come to you.</p>
        <NuxtLink to="/mint" class="btn btn--primary">Mint the first Kwami</NuxtLink>
      </div>

      <div v-else class="grid grid--cards">
        <KwamiCard v-for="k in kwamis" :key="k.mint" :kwami="k" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 32px;
  align-items: center;
  padding-block: 28px 12px;
}

.hero__lede { max-width: 52ch; font-size: 1.05rem; }
.hero__cta { flex-wrap: wrap; }

.hero__stats {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.stat { display: flex; flex-direction: column; gap: 2px; }

.rules__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 26px;
}

.rules__list li { display: flex; gap: 13px; align-items: flex-start; }
.rules__list strong { display: block; margin-bottom: 3px; }
.rules__list p { font-size: 0.9rem; margin: 0; }

.rules__n {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.8rem;
  font-weight: 640;
  font-family: var(--font-mono);
}

.empty {
  text-align: center;
  padding: 56px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.skeleton {
  height: 250px;
  background: linear-gradient(100deg, var(--panel) 30%, var(--panel-strong) 50%, var(--panel) 70%);
  background-size: 220% 100%;
  animation: shimmer 1.5s infinite linear;
}

@keyframes shimmer {
  to { background-position: -220% 0; }
}

@media (max-width: 880px) {
  .hero { grid-template-columns: 1fr; }
}
</style>
