-- =============================================================================
-- Voice metering
--
-- `VOICE_MICRO_PER_SECOND` and the `voice` ledger reason have existed since the
-- energy migration and nothing has ever spent them, because the only voice path
-- that shipped was the browser's own — free to run, and so free to leave
-- unmetered. A LiveKit room is not free: it is a worker holding streaming STT,
-- an LLM and TTS open for as long as somebody keeps talking.
--
-- Metering a stream needs a clock, and the choice of *whose* clock is the whole
-- design. A session's voice is paid for out of the Kwami's balance — the
-- owner's money — while the person on the microphone is the challenger trying
-- to take that Kwami's pot. Letting the challenger's browser report how many
-- seconds to charge the owner would be handing one player a drain on another
-- player's Kwami. So the session charge is computed here, from `started_at`,
-- which came off the chain and not off anybody's client.
--
-- The studio has no such conflict — a creator rehearsing a draft can only
-- over-report against their own trial allowance — and no session row to hang a
-- clock off, so that path meters in Nitro against a per-tick cap instead.
-- =============================================================================

-- How much of this session's wall clock has already been paid for.
--
-- Milliseconds rather than seconds because the price is per second and the
-- charge rounds up: keeping the counter in whole seconds would round every tick
-- up independently, and a fifteen-second heartbeat would bill sixteen.
alter table public.game_sessions
  add column if not exists voice_charged_ms bigint not null default 0;

alter table public.game_sessions
  drop constraint if exists voice_charged_not_negative;
alter table public.game_sessions
  add constraint voice_charged_not_negative check (voice_charged_ms >= 0);

comment on column public.game_sessions.voice_charged_ms is
  'Milliseconds of this session already billed as voice. Advanced only by charge_session_voice, and only when the debit succeeded.';

-- -----------------------------------------------------------------------------
-- Charge a session for the voice time it has run up since the last tick.
--
-- Takes no duration from the caller. The amount owed is the distance between
-- the session's own start and now (capped at its expiry, so a heartbeat that
-- arrives late cannot bill for time the session did not have), minus whatever
-- has already been paid for.
--
-- Idempotent by construction: the `for update` serialises two ticks that arrive
-- together, and the second one sees nothing owed. A tick that cannot be paid
-- for leaves `voice_charged_ms` alone, so the unpaid seconds stay owed and are
-- charged if the Kwami is topped up rather than quietly written off.
--
-- Returns the new balance, or null when the Kwami could not afford the charge.
-- -----------------------------------------------------------------------------
create or replace function public.charge_session_voice(
  p_session_id uuid
)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  v_kwami_id   uuid;
  v_started    timestamptz;
  v_expires    timestamptz;
  v_charged_ms bigint;
  v_elapsed_ms bigint;
  v_owed_ms    bigint;
  v_cost       bigint;
  v_balance    bigint;
begin
  select kwami_id, started_at, expires_at, voice_charged_ms
    into v_kwami_id, v_started, v_expires, v_charged_ms
  from public.game_sessions
  where id = p_session_id
  for update;

  if v_kwami_id is null then
    return null;
  end if;

  v_elapsed_ms := floor(extract(epoch from (least(now(), v_expires) - v_started)) * 1000)::bigint;
  v_owed_ms := greatest(0, v_elapsed_ms - v_charged_ms);

  if v_owed_ms = 0 then
    return (select energy_micro from public.kwamis where id = v_kwami_id);
  end if;

  -- The same ceiling division `shared/energy/cost.ts` applies, for the same
  -- reason: a debit rounded down lets a caller split one second into ten
  -- tenths and pay nothing for any of them.
  v_cost := ceil(v_owed_ms * 50::numeric / 1000)::bigint;

  v_balance := public.spend_kwami_energy(
    v_kwami_id,
    v_cost,
    'voice',
    jsonb_build_object('session', p_session_id, 'ms', v_owed_ms)
  );

  if v_balance is null then
    return null;
  end if;

  update public.game_sessions
     set voice_charged_ms = v_elapsed_ms
   where id = p_session_id;

  return v_balance;
end;
$$;

-- Service role only, exactly like the three spend/credit functions: a client
-- that could call this could bill somebody else's Kwami for time it never used.
revoke all on function public.charge_session_voice(uuid) from public, anon, authenticated;
