-- =============================================================================
-- Energy
--
-- A Kwami's pot is escrow: it holds challengers' money, and the vault program
-- has no path to spend it on anything but a payout. So the model calls and the
-- speech a Kwami needs in order to answer at all cannot come out of it —
-- charging inference to the pot would be spending the challengers' stake on the
-- owner's running costs.
--
-- Energy is that second balance. Prepaid, owned by the Kwami, bought by its
-- owner with a plain SOL transfer the server verifies against the cluster, and
-- spent every time the thing opens its mouth.
--
-- Running out is NOT a death. `dead` is terminal because a drawdown loss is
-- real and on chain; an empty energy balance is neither, and reverses in one
-- payment. See `shared/energy/state.ts`.
-- =============================================================================

-- `alter type ... add value` cannot run in the same transaction as a statement
-- that uses the new value, which is why this is alone at the top of the file.
alter type public.kwami_state add value if not exists 'starving';

-- -----------------------------------------------------------------------------
-- The balance, on the Kwami itself
--
-- A column rather than a table because it is read on every arena page load,
-- alongside the row it belongs to. The ledger below is the audit trail; this is
-- the cached scalar the UI actually renders — the same split the codebase
-- already uses for `balance_lamports` beside `valuations`.
-- -----------------------------------------------------------------------------

alter table public.kwamis
  add column if not exists energy_micro      bigint not null default 0,
  add column if not exists energy_updated_at timestamptz;

comment on column public.kwamis.energy_micro is
  'Prepaid compute credit in micro-energy (1000 = 1 energy). Never touches the pot.';

-- A balance can reach zero but must never go under it: a negative balance would
-- read as "owes us", and nothing in this system extends credit.
alter table public.kwamis
  drop constraint if exists energy_not_negative;
alter table public.kwamis
  add constraint energy_not_negative check (energy_micro >= 0);

-- -----------------------------------------------------------------------------
-- The ledger
--
-- Append-only, and deliberately shaped like `valuations`: a cached number is
-- only trustworthy if there is a record you can replay it from. `balance_after`
-- is stored rather than derived so a corrupted balance can be *detected*, not
-- merely recomputed into agreeing with itself.
-- -----------------------------------------------------------------------------

create type public.energy_reason as enum (
  'trial_grant',  -- the free allowance a new account gets
  'mint_fuel',    -- the opening balance bought in the mint bundle
  'topup',        -- an owner adding more later
  'reply',        -- one turn of the brain, in a session or the studio
  'voice',        -- synthesised or transcribed speech
  'codegen',      -- one run of the program builder
  'refund'        -- something charged that should not have been
);

create table public.energy_ledger (
  id            bigserial primary key,
  -- Nullable: a creator testing a Kwami that does not exist yet spends their
  -- account's trial allowance, and there is no Kwami to attribute it to.
  kwami_id      uuid references public.kwamis (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete set null,
  delta_micro   bigint not null,
  reason        public.energy_reason not null,
  balance_after bigint not null,
  -- The funding signature, for credits. Unique so a replayed transaction
  -- credits exactly once: this is the whole idempotency story for top-ups.
  tx            text unique,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index energy_ledger_kwami_idx on public.energy_ledger (kwami_id, created_at desc);
create index energy_ledger_user_idx  on public.energy_ledger (user_id, created_at desc);

comment on table public.energy_ledger is
  'Append-only audit trail for every energy credit and debit. Service role writes only.';

-- -----------------------------------------------------------------------------
-- The pre-mint trial
--
-- One row per account, holding the allowance a creator spends testing a Kwami
-- that has no mint address yet. Separate from `kwamis.energy_micro` because at
-- that point there is nothing to hang a balance off, and separate from
-- `profiles` because a profile is public and a balance is not.
-- -----------------------------------------------------------------------------

create table public.account_energy (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  trial_micro  bigint not null default 0 check (trial_micro >= 0),
  granted_at   timestamptz,
  updated_at   timestamptz not null default now()
);

create trigger account_energy_touch before update on public.account_energy
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------

alter table public.energy_ledger  enable row level security;
alter table public.account_energy enable row level security;

-- A Kwami's energy history is readable only by its author. How heavily a Kwami
-- is being talked to is competitive information — the same reasoning that keeps
-- transcripts away from the Kwami's owner, pointed the other way.
create policy energy_ledger_read_own on public.energy_ledger
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.kwamis k
      where k.id = energy_ledger.kwami_id and k.author_id = auth.uid()
    )
  );

create policy account_energy_read_own on public.account_energy
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies anywhere here, by design: every write goes
-- through the service role, exactly like `kwami_secrets`. A client that could
-- credit its own balance would be a client that could print money.

-- -----------------------------------------------------------------------------
-- Spending, atomically
--
-- This has to be one statement. Read-then-write from the application would let
-- two concurrent replies both read the same balance and both succeed, and a
-- balance that cannot actually reach zero under load is not a balance — it is a
-- decoration on an unmetered API.
--
-- Returns the new balance, or null when the Kwami cannot afford the charge.
-- -----------------------------------------------------------------------------

create or replace function public.spend_kwami_energy(
  p_kwami_id uuid,
  p_cost     bigint,
  p_reason   public.energy_reason,
  p_meta     jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_cost < 0 then
    raise exception 'cost must be non-negative';
  end if;

  -- `for update` is the point of the whole function: it serialises concurrent
  -- spenders on this row rather than letting them interleave a read and a write.
  select energy_micro into v_balance
  from public.kwamis
  where id = p_kwami_id
  for update;

  if v_balance is null then
    return null;
  end if;

  if v_balance < p_cost then
    return null;
  end if;

  update public.kwamis
     set energy_micro = energy_micro - p_cost,
         energy_updated_at = now(),
         -- Going to zero takes it off the arena in the same statement that
         -- spent the last of it. A separate update would leave a window in
         -- which a listed Kwami cannot answer.
         state = case
           when energy_micro - p_cost <= 0 and state = 'live' then 'starving'::public.kwami_state
           else state
         end
   where id = p_kwami_id
  returning energy_micro into v_balance;

  insert into public.energy_ledger (kwami_id, user_id, delta_micro, reason, balance_after, meta)
  select p_kwami_id, k.author_id, -p_cost, p_reason, v_balance, p_meta
  from public.kwamis k where k.id = p_kwami_id;

  return v_balance;
end;
$$;

/**
 * Credit energy against a verified transaction.
 *
 * The uniqueness of `tx` is what makes this idempotent: a caller replaying the
 * same signature hits the constraint and credits nothing the second time. The
 * caller is responsible for having actually verified the transfer on chain —
 * this function trusts its arguments, which is why it is service-role only.
 */
create or replace function public.credit_kwami_energy(
  p_kwami_id uuid,
  p_amount   bigint,
  p_reason   public.energy_reason,
  p_tx       text default null,
  p_meta     jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_amount <= 0 then
    raise exception 'credit must be positive';
  end if;

  if p_tx is not null and exists (select 1 from public.energy_ledger where tx = p_tx) then
    -- Already credited. Report the balance rather than raising: a client
    -- retrying a confirmation it never saw the response to is not an error.
    select energy_micro into v_balance from public.kwamis where id = p_kwami_id;
    return v_balance;
  end if;

  update public.kwamis
     set energy_micro = energy_micro + p_amount,
         energy_updated_at = now(),
         -- A top-up revives a starving Kwami in the same statement. Terminal
         -- states are untouched: fuelling a dead Kwami must not undo a
         -- drawdown death, and fuelling a cracked one must not make a
         -- published phrase secret again.
         state = case
           when state = 'starving' then 'live'::public.kwami_state
           else state
         end
   where id = p_kwami_id
  returning energy_micro into v_balance;

  if v_balance is null then
    return null;
  end if;

  insert into public.energy_ledger (kwami_id, user_id, delta_micro, reason, balance_after, tx, meta)
  select p_kwami_id, k.author_id, p_amount, p_reason, v_balance, p_tx, p_meta
  from public.kwamis k where k.id = p_kwami_id;

  return v_balance;
end;
$$;

/** Spend an account's pre-mint trial allowance. Null when it cannot afford it. */
create or replace function public.spend_trial_energy(
  p_user_id uuid,
  p_cost    bigint,
  p_reason  public.energy_reason,
  p_meta    jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_cost < 0 then
    raise exception 'cost must be non-negative';
  end if;

  select trial_micro into v_balance
  from public.account_energy
  where user_id = p_user_id
  for update;

  if v_balance is null or v_balance < p_cost then
    return null;
  end if;

  update public.account_energy
     set trial_micro = trial_micro - p_cost
   where user_id = p_user_id
  returning trial_micro into v_balance;

  insert into public.energy_ledger (kwami_id, user_id, delta_micro, reason, balance_after, meta)
  values (null, p_user_id, -p_cost, p_reason, v_balance, p_meta);

  return v_balance;
end;
$$;

revoke all on function public.spend_kwami_energy(uuid, bigint, public.energy_reason, jsonb) from public, anon, authenticated;
revoke all on function public.credit_kwami_energy(uuid, bigint, public.energy_reason, text, jsonb) from public, anon, authenticated;
revoke all on function public.spend_trial_energy(uuid, bigint, public.energy_reason, jsonb) from public, anon, authenticated;
