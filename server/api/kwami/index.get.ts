import { z } from 'zod'
import { DEMO_KWAMIS, isDemoMode } from '~~/server/utils/demo'
import { serviceClient } from '~~/server/utils/supabase'

const Query = z.object({
  state: z.enum(['live', 'paused', 'starving', 'cracked', 'dead', 'all']).default('live'),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
  owner: z.string().optional(),
  sort: z.enum(['pot', 'new', 'contested']).default('pot'),
})

/**
 * The arena listing.
 *
 * Reads `kwamis_public`, the view that already computes vitality, prize and
 * win rate — doing that arithmetic here would mean maintaining a second
 * implementation of the same rules alongside the SQL one.
 */
export default defineEventHandler(async (event) => {
  const q = Query.parse(getQuery(event))

  if (isDemoMode()) {
    const filtered = DEMO_KWAMIS.filter((k) => q.state === 'all' || k.state === q.state)
    return {
      demo: true,
      kwamis: sortDemo(filtered, q.sort).slice(q.offset, q.offset + q.limit),
      totals: totalsOf(DEMO_KWAMIS),
    }
  }

  const db = serviceClient()
  let query = db
    .from('kwamis_public')
    .select('*')
    .range(q.offset, q.offset + q.limit - 1)

  if (q.state !== 'all') query = query.eq('state', q.state)
  if (q.owner) query = query.eq('owner_wallet', q.owner)

  switch (q.sort) {
    case 'new':
      query = query.order('published_at', { ascending: false, nullsFirst: false })
      break
    case 'contested':
      query = query.order('sessions_played', { ascending: false })
      break
    default:
      query = query.order('value_cents', { ascending: false })
  }

  const { data, error } = await query
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  // The headline totals are over *all* live Kwamis, not just this page, so they
  // stay put while someone scrolls.
  const { data: all } = await db.from('kwamis_public').select('value_cents, state, sessions_played')

  return {
    demo: false,
    kwamis: data ?? [],
    totals: totalsOf(all ?? []),
  }
})

function totalsOf(rows: Array<{ value_cents: number; state: string; sessions_played: number }>) {
  return {
    pot: rows.filter((r) => r.state === 'live').reduce((sum, r) => sum + Number(r.value_cents), 0),
    live: rows.filter((r) => r.state === 'live').length,
    sessions: rows.reduce((sum, r) => sum + Number(r.sessions_played), 0),
  }
}

function sortDemo(rows: typeof DEMO_KWAMIS, sort: 'pot' | 'new' | 'contested') {
  const copy = [...rows]
  if (sort === 'contested') return copy.sort((a, b) => b.sessions_played - a.sessions_played)
  if (sort === 'new') return copy.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return copy.sort((a, b) => b.value_cents - a.value_cents)
}
