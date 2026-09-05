<script setup lang="ts">
/**
 * A Kwami's public ledger.
 *
 * Every row links out to the chain. That is not decoration — a pot is a claim
 * about money in an account someone else controls, and the only reason to
 * believe it is that anyone can go and check. A feed of outcomes with no
 * signatures behind them would be indistinguishable from a number typed into a
 * database, which is exactly what a stranger deciding whether to pay a ticket
 * has to rule out.
 *
 * Transcripts are never here. What was *said* to a Kwami stays private to the
 * player who paid to say it; that a challenge happened, from which address,
 * for how much, and how it ended is already public on chain.
 */
import type { SessionSummary } from '#shared/types/api'
import type { Cluster } from '#shared/solana/constants'
import { explorerUrl } from '#shared/solana/constants'

const props = withDefaults(defineProps<{ sessions: SessionSummary[]; payoutBps?: number }>(), {
  payoutBps: 8000,
})

const cluster = computed(() => useRuntimeConfig().public.solanaCluster as Cluster)

const rows = computed(() =>
  props.sessions.map((s) => {
    const won = s.outcome === 'won'
    return {
      ...s,
      won,
      ticket: s.asset === 'SOL' ? formatSol(s.ticket_amount) : formatUsdc(s.ticket_amount),
      payout: won
        ? s.payout_usdc > 0 && s.payout_lamports === 0
          ? formatUsdc(s.payout_usdc)
          : formatSol(s.payout_lamports)
        : null,
      // A win is the only outcome with two transactions. For everything else the
      // ticket is the whole story, and linking a claim that does not exist would
      // be a dead link on every row.
      tx: won ? (s.tx_claim ?? s.tx_start) : s.tx_start,
    }
  }),
)

const verdict = (outcome: string) =>
  outcome === 'won'
    ? 'Took the pot'
    : outcome === 'expired'
      ? 'Ran out of time'
      : outcome === 'aborted'
        ? 'Walked away'
        : outcome === 'pending'
          ? 'In progress'
          : 'Did not crack it'
</script>

<template>
  <div class="card stack gap-3">
    <div class="row gap-2">
      <h3 class="grow">Every challenge</h3>
      <span class="dim">{{ sessions.length }} shown</span>
    </div>

    <p v-if="rows.length === 0" class="muted">
      Nobody has tried this one yet. Whoever goes first is playing against a Kwami with no idea what works on
      it.
    </p>

    <ul v-else class="feed">
      <li v-for="row in rows" :key="row.id" class="feed__row" :class="{ 'feed__row--won': row.won }">
        <span class="feed__dot" :class="`feed__dot--${row.outcome}`" />

        <div class="feed__who">
          <a
            :href="explorerUrl(row.player_wallet, cluster, 'address')"
            target="_blank"
            rel="noopener"
            class="num feed__addr"
            >{{ shortAddress(row.player_wallet, 4, 4) }}</a
          >
          <span class="dim feed__when">{{ relativeTime(row.started_at) }}</span>
        </div>

        <span class="feed__verdict" :class="{ gold: row.won }">{{ verdict(row.outcome) }}</span>

        <span class="feed__money num">
          <span v-if="row.payout" class="gold">+{{ row.payout }}</span>
          <span v-else class="dim">{{ row.ticket }}</span>
        </span>

        <a
          v-if="row.tx"
          :href="explorerUrl(row.tx, cluster, 'tx')"
          target="_blank"
          rel="noopener"
          class="feed__tx dim"
          :title="row.tx"
          >tx ↗</a
        >
        <span v-else class="feed__tx dim">—</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.feed__row {
  display: grid;
  /* Fixed columns rather than auto: the addresses are all the same width and
     the amounts are numerals, so a content-sized grid would jitter one column
     per row and the whole ledger would read as misaligned. */
  grid-template-columns: 10px minmax(0, 1fr) minmax(0, 1.1fr) auto 34px;
  align-items: center;
  gap: 12px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--border);
  font-size: 0.87rem;
}

.feed__row:last-child {
  border-bottom: none;
}
.feed__row--won {
  background: rgba(245, 196, 81, 0.045);
}

.feed__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--fg-dim);
}

.feed__dot--won {
  background: var(--gold);
  box-shadow: 0 0 10px var(--gold);
}
.feed__dot--pending {
  background: var(--accent);
}
.feed__dot--expired {
  background: var(--warn);
}

.feed__who {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.feed__addr {
  font-size: 0.82rem;
  color: var(--fg-muted);
}
.feed__addr:hover {
  color: var(--fg);
}
.feed__when {
  font-size: 0.74rem;
}

.feed__verdict {
  color: var(--fg-muted);
}
.feed__money {
  text-align: right;
  font-size: 0.85rem;
}
.feed__tx {
  text-align: right;
  font-size: 0.76rem;
}
.feed__tx:hover {
  color: var(--fg);
}

@media (max-width: 560px) {
  .feed__row {
    grid-template-columns: 8px minmax(0, 1fr) auto;
  }
  .feed__verdict {
    display: none;
  }
}
</style>
