-- =============================================================================
-- Energy in the read models
--
-- Every read route goes through `kwamis_public`, never the base table, so a
-- column that does not reach this view is invisible to the arena, the cards,
-- the profile and the embed — which is where an owner would actually notice
-- their Kwami was running out.
--
-- Separate from the migration that created the column because `alter type ...
-- add value` cannot have its new value *used* in the same transaction, and
-- keeping the two apart means neither has to know whether the other ran in one.
-- =============================================================================

/**
 * Everything the gallery and detail pages need, with no secret columns.
 *
 * `security_invoker` matters: without it the view would run as its owner and
 * quietly bypass the row level security on `kwamis`, exposing drafts.
 */
create or replace view public.kwamis_public
with (security_invoker = true)
as
select
  k.id,
  k.mint,
  k.vault,
  k.name,
  k.tagline,
  k.persona,
  k.renderer,
  k.appearance,
  k.voice,
  k.hints,
  k.state,
  k.resolution_mode,
  k.author_wallet,
  k.owner_wallet,
  k.ticket_price_lamports,
  k.ticket_price_usdc,
  k.session_duration,
  k.payout_bps,
  k.balance_lamports,
  k.balance_usdc,
  k.high_water_mark_cents,
  k.sessions_played,
  k.sessions_won,
  k.created_at,
  k.published_at,
  k.died_at,
  coalesce(v.value_cents, 0) as value_cents,

  -- Prepaid compute credit. Exposed as the raw balance and nothing else: the
  -- full/low/starving thresholds live in `shared/energy/state.ts`, and deriving
  -- them a second time here in SQL is exactly how the two would drift apart.
  -- The one piece of energy state the database *does* own is `k.state`, because
  -- reaching zero has to take a Kwami off the arena in the same statement that
  -- spent the last of it.
  k.energy_micro,
  k.energy_updated_at,

  -- Vitality: current value over the all-time peak. A Kwami that has never
  -- been funded reads as 1.0 — it has not lost anything yet, so the 99%
  -- drawdown rule cannot have fired.
  case
    when k.high_water_mark_cents = 0 then 1.0
    else least(1.0, greatest(0.0, coalesce(v.value_cents, 0)::numeric / k.high_water_mark_cents))
  end as vitality,

  -- What a challenger stands to win right now, in each asset.
  (k.balance_lamports * k.payout_bps) / 10000 as prize_lamports,
  (k.balance_usdc * k.payout_bps) / 10000     as prize_usdc,

  case when k.sessions_played = 0 then 0.0
       else k.sessions_won::numeric / k.sessions_played
  end as win_rate,

  p.handle       as author_handle,
  p.display_name as author_name,
  p.avatar_url   as author_avatar
from public.kwamis k
left join public.latest_valuations v on v.kwami_id = k.id
left join public.profiles p on p.id = k.author_id;

/**
 * Public leaderboard.
 *
 * Ranked by pot rather than by win rate: a Kwami nobody has beaten is only
 * interesting if there is something to take from it.
 *
 * Starving Kwamis are absent, and deliberately not by a new clause — the filter
 * is still `live` or `paused`, and a Kwami that ran out of energy is neither.
 * It comes back the moment it is topped up, holding whatever rank its pot
 * earns, because nothing about the pot changed while it was asleep.
 */
create or replace view public.leaderboard
with (security_invoker = true)
as
select
  mint,
  name,
  renderer,
  state,
  value_cents,
  prize_lamports,
  prize_usdc,
  sessions_played,
  sessions_won,
  vitality,
  author_handle,
  rank() over (order by value_cents desc) as rank
from public.kwamis_public
where state in ('live', 'paused')
order by value_cents desc;
