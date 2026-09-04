-- =============================================================================
-- Kwami v3 — initial schema
--
-- Design rule: the chain is the ledger, Postgres is the index. Anything that
-- decides who gets paid lives in the Anchor program; the tables below exist to
-- make the app fast to query and to hold the things a blockchain must never
-- see — plaintext secrets, transcripts, personas.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Profiles
-- -----------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  handle       text unique,
  display_name text,
  avatar_url   text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint handle_format check (handle is null or handle ~ '^[a-z0-9_]{3,24}$')
);

comment on table public.profiles is 'Public identity. One row per auth user, created by trigger on signup.';

-- -----------------------------------------------------------------------------
-- Wallet identities
--
-- A user may bind several wallets: a Solana one that holds Kwamis and receives
-- payouts, and optionally an Ethereum one used purely to sign in. `address_lower`
-- exists because Ethereum addresses are checksummed for display but must be
-- looked up case-insensitively.
-- -----------------------------------------------------------------------------

create type public.wallet_chain as enum ('solana', 'ethereum');

create table public.wallet_identities (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  chain         public.wallet_chain not null,
  address       text not null,
  address_lower text not null,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (chain, address_lower)
);

create index wallet_identities_user_idx on public.wallet_identities (user_id);

-- -----------------------------------------------------------------------------
-- Kwamis
--
-- Mirrors the on-chain `Kwami` account plus the presentation layer. The mirror
-- is eventually consistent by design: `state` and the counters are refreshed
-- from chain by the indexer, and a stale row is never allowed to authorise a
-- payout.
-- -----------------------------------------------------------------------------

create type public.kwami_state as enum ('draft', 'minted', 'live', 'paused', 'cracked', 'dead');
create type public.resolution_mode as enum ('commit-reveal', 'attested');
create type public.kwami_renderer as enum ('blob-xyz', 'crystal-ball', 'orbital-shards', 'stars-genesis', 'black-hole');

create table public.kwamis (
  id                    uuid primary key default gen_random_uuid(),
  mint                  text unique,
  vault                 text,
  author_id             uuid references auth.users (id) on delete set null,
  author_wallet         text not null,
  owner_wallet          text not null,

  name                  text not null,
  tagline               text not null default '',
  persona               text not null default '',
  renderer              public.kwami_renderer not null default 'blob-xyz',
  appearance            jsonb not null default '{}'::jsonb,
  voice                 jsonb not null default '{}'::jsonb,
  hints                 text[] not null default '{}',

  state                 public.kwami_state not null default 'draft',
  resolution_mode       public.resolution_mode not null default 'commit-reveal',
  secret_hash           text not null,
  ticket_price_lamports bigint not null default 0,
  ticket_price_usdc     bigint not null default 0,
  session_duration      integer not null default 180,
  payout_bps            integer not null default 8000,

  -- Cached from chain by the indexer. Display only.
  balance_lamports      bigint not null default 0,
  balance_usdc          bigint not null default 0,
  high_water_mark_cents bigint not null default 0,
  sessions_played       integer not null default 0,
  sessions_won          integer not null default 0,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  published_at          timestamptz,
  died_at               timestamptz,

  constraint payout_range check (payout_bps between 5000 and 9500),
  constraint duration_range check (session_duration between 30 and 900),
  constraint has_a_price check (ticket_price_lamports > 0 or ticket_price_usdc > 0)
);

create index kwamis_state_idx on public.kwamis (state) where state = 'live';
create index kwamis_owner_idx on public.kwamis (owner_wallet);
create index kwamis_author_idx on public.kwamis (author_id);

-- -----------------------------------------------------------------------------
-- Secrets
--
-- Split into its own table rather than a column on `kwamis` so that no policy
-- mistake on the main table can ever leak a secret: this table has RLS enabled
-- and *no* policies at all, which denies every request that is not service role.
-- -----------------------------------------------------------------------------

create table public.kwami_secrets (
  kwami_id     uuid primary key references public.kwamis (id) on delete cascade,
  -- AES-256-GCM envelope: v1.<iv>.<tag>.<ciphertext>
  ciphertext   text not null,
  salt         text not null,
  created_at   timestamptz not null default now()
);

comment on table public.kwami_secrets is
  'Encrypted plaintext secrets. RLS on with zero policies: service role only, forever.';

-- -----------------------------------------------------------------------------
-- Sessions and transcripts
-- -----------------------------------------------------------------------------

create type public.session_asset as enum ('SOL', 'USDC');
create type public.session_outcome as enum ('pending', 'won', 'lost', 'expired', 'aborted');

create table public.game_sessions (
  id              uuid primary key default gen_random_uuid(),
  kwami_id        uuid not null references public.kwamis (id) on delete cascade,
  kwami_mint      text not null,
  player_id       uuid references auth.users (id) on delete set null,
  player_wallet   text not null,
  account         text not null,
  nonce           bigint not null,
  asset           public.session_asset not null,
  ticket_amount   bigint not null,
  ticket_usd      numeric(12, 2) not null default 0,
  started_at      timestamptz not null,
  expires_at      timestamptz not null,
  outcome         public.session_outcome not null default 'pending',
  payout_lamports bigint not null default 0,
  payout_usdc     bigint not null default 0,
  matched_text    text,
  match_score     real,
  room            text,
  tx_start        text,
  tx_claim        text,
  created_at      timestamptz not null default now(),
  unique (kwami_mint, player_wallet, nonce)
);

create index game_sessions_kwami_idx on public.game_sessions (kwami_id, created_at desc);
create index game_sessions_player_idx on public.game_sessions (player_wallet, created_at desc);
create index game_sessions_open_idx on public.game_sessions (expires_at) where outcome = 'pending';

create table public.transcript_turns (
  id         bigserial primary key,
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  role       text not null check (role in ('player', 'kwami')),
  text       text not null,
  at_ms      integer not null,
  confidence real,
  created_at timestamptz not null default now()
);

create index transcript_turns_session_idx on public.transcript_turns (session_id, at_ms);

-- -----------------------------------------------------------------------------
-- Valuations — the death-rule audit trail
-- -----------------------------------------------------------------------------

create table public.valuations (
  id           bigserial primary key,
  kwami_id     uuid not null references public.kwamis (id) on delete cascade,
  value_cents  bigint not null,
  sol_usd      numeric(12, 4) not null,
  recorded_at  timestamptz not null default now(),
  tx           text
);

create index valuations_kwami_idx on public.valuations (kwami_id, recorded_at desc);

-- -----------------------------------------------------------------------------
-- AI-generated sub-programs
-- -----------------------------------------------------------------------------

create type public.program_status as enum ('draft', 'generating', 'built', 'failed', 'deployed', 'registered');

create table public.kwami_programs (
  id          uuid primary key default gen_random_uuid(),
  kwami_id    uuid not null references public.kwamis (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,
  name        text not null,
  brief       text not null,
  source      text,
  idl         jsonb,
  code_hash   text,
  program_id  text,
  status      public.program_status not null default 'draft',
  build_log   text,
  hooks       smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index kwami_programs_kwami_idx on public.kwami_programs (kwami_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.wallet_identities enable row level security;
alter table public.kwamis            enable row level security;
alter table public.kwami_secrets     enable row level security; -- no policies: deny all
alter table public.game_sessions     enable row level security;
alter table public.transcript_turns  enable row level security;
alter table public.valuations        enable row level security;
alter table public.kwami_programs    enable row level security;

-- Profiles are public; you may only edit your own.
create policy profiles_read on public.profiles for select using (true);
create policy profiles_write on public.profiles for update using (auth.uid() = id);
create policy profiles_insert on public.profiles for insert with check (auth.uid() = id);

-- You can only see your own wallet bindings.
create policy wallets_own on public.wallet_identities for select using (auth.uid() = user_id);
create policy wallets_insert on public.wallet_identities for insert with check (auth.uid() = user_id);
create policy wallets_delete on public.wallet_identities for delete using (auth.uid() = user_id);

-- A Kwami is visible once it leaves draft; drafts are visible to their author.
create policy kwamis_read_published on public.kwamis
  for select using (state <> 'draft' or auth.uid() = author_id);
create policy kwamis_insert_own on public.kwamis
  for insert with check (auth.uid() = author_id);
-- Only presentation columns are ever updated from the client; the game rules
-- are immutable on chain, and the cached chain columns are written by the
-- indexer under service role.
create policy kwamis_update_own on public.kwamis
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- A session is visible to its player and to the Kwami's author.
create policy sessions_read on public.game_sessions
  for select using (
    auth.uid() = player_id
    or exists (select 1 from public.kwamis k where k.id = kwami_id and k.author_id = auth.uid())
  );

-- Transcripts are private to the player. The author never sees how challengers
-- probed their Kwami — otherwise a popular Kwami's owner could farm the
-- attempts and pre-empt every future line of attack.
create policy transcripts_read on public.transcript_turns
  for select using (
    exists (
      select 1 from public.game_sessions s
      where s.id = session_id and s.player_id = auth.uid()
    )
  );

create policy valuations_read on public.valuations for select using (true);

create policy programs_read_own on public.kwami_programs
  for select using (auth.uid() = author_id);
create policy programs_write_own on public.kwami_programs
  for all using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger kwamis_touch before update on public.kwamis
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger programs_touch before update on public.kwami_programs
  for each row execute function public.touch_updated_at();
