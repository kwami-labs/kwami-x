-- =============================================================================
-- Read models
--
-- The app's hot paths are "show me live Kwamis ranked by pot" and "show me one
-- Kwami". Both need derived numbers — vitality, USD value, win rate — that are
-- expensive to compute per row in the client and easy to get subtly wrong in
-- two places. They are defined once, here.
-- =============================================================================

-- The most recent valuation per Kwami, used to price mixed SOL/USDC vaults.
create or replace view public.latest_valuations as
select distinct on (kwami_id)
  kwami_id,
  value_cents,
  sol_usd,
  recorded_at
from public.valuations
order by kwami_id, recorded_at desc;

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

/** A player's own history, including outcomes and payouts. */
create or replace view public.my_sessions
with (security_invoker = true)
as
select
  s.id,
  s.kwami_mint,
  k.name as kwami_name,
  k.renderer,
  s.asset,
  s.ticket_amount,
  s.ticket_usd,
  s.started_at,
  s.expires_at,
  s.outcome,
  s.payout_lamports,
  s.payout_usdc,
  s.tx_claim
from public.game_sessions s
join public.kwamis k on k.id = s.kwami_id
where s.player_id = auth.uid()
order by s.created_at desc;
