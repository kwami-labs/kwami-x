<script setup lang="ts">
definePageMeta({ title: 'Leaderboard' })

const { data, pending } = await useFetch('/api/kwami', { query: { state: 'all', limit: 60, sort: 'pot' } })
const rows = computed(() => data.value?.kwamis ?? [])

const tab = ref<'pot' | 'contested' | 'fallen'>('pot')

const shown = computed(() => {
  const all = [...rows.value]
  if (tab.value === 'contested') return all.sort((a, b) => b.sessions_played - a.sessions_played)
  if (tab.value === 'fallen') return all.filter((k) => k.state === 'dead' || k.state === 'cracked')
  return all
    .filter((k) => k.state === 'live' || k.state === 'paused')
    .sort((a, b) => b.value_cents - a.value_cents)
})
</script>

<template>
  <div class="wrap stack gap-3">
    <header class="stack gap-1">
      <span class="eyebrow">Leaderboard</span>
      <h1>Who is holding what.</h1>
    </header>

    <div class="row gap-1">
      <button class="chip" :class="{ 'chip--on': tab === 'pot' }" @click="tab = 'pot'">Biggest pots</button>
      <button class="chip" :class="{ 'chip--on': tab === 'contested' }" @click="tab = 'contested'">
        Most attempts
      </button>
      <button class="chip" :class="{ 'chip--on': tab === 'fallen' }" @click="tab = 'fallen'">
        The fallen
      </button>
    </div>

    <div v-if="pending" class="card"><p class="dim">Loading…</p></div>

    <div v-else-if="shown.length === 0" class="card">
      <p class="dim">Nothing here yet.</p>
    </div>

    <div v-else class="card board">
      <table>
        <thead>
          <tr>
            <th class="board__rank">#</th>
            <th>Kwami</th>
            <th class="board__num">Pot</th>
            <th class="board__num">Prize</th>
            <th class="board__num">Beaten</th>
            <th class="board__vit">Vitality</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(k, i) in shown" :key="k.mint">
            <td class="board__rank num dim">{{ i + 1 }}</td>
            <td>
              <NuxtLink :to="`/kwami/${k.mint}`" class="board__name">
                <span>{{ k.name }}</span>
                <span v-if="k.state !== 'live'" class="badge" :class="`badge--${k.state}`">{{
                  k.state
                }}</span>
              </NuxtLink>
            </td>
            <td class="board__num num">{{ formatCents(k.value_cents) }}</td>
            <td class="board__num num gold">{{ formatCents(k.value_cents * (k.payout_bps / 10000)) }}</td>
            <td class="board__num num">{{ k.sessions_won }} / {{ k.sessions_played }}</td>
            <td class="board__vit"><VitalityBar :value="k.vitality" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.chip {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
  font-size: 0.87rem;
}
.chip--on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}

.board {
  padding: 0;
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

th {
  text-align: left;
  padding: 12px 16px;
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--fg-dim);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

td {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
tbody tr:last-child td {
  border-bottom: 0;
}
tbody tr:hover {
  background: var(--panel);
}

.board__rank {
  width: 48px;
}
.board__num {
  text-align: right;
  white-space: nowrap;
}
.board__vit {
  width: 130px;
}

.board__name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.board__name:hover span:first-child {
  color: var(--accent);
}
</style>
