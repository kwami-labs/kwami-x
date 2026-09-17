# Setup

## Requirements

- [Bun](https://bun.sh) 1.2 or newer
- Node 20+ (Nuxt's toolchain still reaches for it in places)
- Optionally: [Supabase CLI](https://supabase.com/docs/guides/cli), the [Solana toolchain](https://solana.com/docs/intro/installation) and [Anchor](https://www.anchor-lang.com/) 0.31 for the on-chain half

## The two-command version

```bash
bun install
bun run dev
```

That is genuinely all of it. With no `.env` at all, the app runs in **demo mode**: a seeded arena of six Kwamis, full 3D, full navigation, no chain and no database. Nothing can be minted or played, and every mutating route returns a 503 that says exactly which variable is missing.

Demo mode is detected by looking for real credentials, not by a flag — copying `.env.example` to `.env` and leaving the placeholders in place still gives you the demo, rather than a wall of `fetch failed` against `your-project.supabase.co`.

## Going live, one piece at a time

Each block below is independent. Add whichever you need.

### 1. Database and auth (Supabase)

```bash
supabase start           # or point at a hosted project
supabase db push         # applies supabase/migrations/*
```

```env
# Hosted:
NUXT_PUBLIC_SUPABASE_PROJECT_ID=your-project-ref
NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NUXT_SUPABASE_SECRET_KEY=sb_secret_...

# Or local `supabase start` (URL override):
# NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
# NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
# NUXT_SUPABASE_SECRET_KEY=...
```

For Google and GitHub sign-in, enable those providers in the Supabase dashboard and set the callback to `<your-site>/auth/callback`. For phone sign-in, configure an SMS provider.

### 2. Secret encryption

Kwami secrets are stored encrypted. The app refuses to write one without a key.

```bash
bun run scripts/gen-keys.ts
```

```env
NUXT_SECRET_ENCRYPTION_KEY=<64 hex characters>
```

> Losing this key makes every existing Kwami unplayable — the voice agent can no longer tell when a challenger has won. Back it up somewhere real.

### 3. Solana

```bash
solana-test-validator            # a local cluster
cd programs && anchor build && anchor deploy
bun run scripts/bootstrap-localnet.ts
```

```env
NUXT_PUBLIC_SOLANA_CLUSTER=localnet
NUXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899
NUXT_PUBLIC_KWAMI_PROGRAM_ID=<from anchor deploy>
NUXT_ORACLE_SECRET_KEY=<base58 secret key>

# Where the flat mint commission is paid, and how much it is. An empty treasury
# adds no commission instruction at all, so a devnet clone can mint without
# first inventing an address to pay.
NUXT_PUBLIC_PLATFORM_TREASURY=<base58 address>
NUXT_PUBLIC_MINT_COMMISSION_SOL=0.5
```

The bootstrap script creates the protocol config account, a USDC-like mint and a funded treasury.

### 4. Voice

Nothing is required. Without any configuration the game uses the browser's own Web Speech API for recognition and synthesis, which works in Chrome and Edge and needs no keys.

For a real conversational Kwami:

```env
NUXT_ANTHROPIC_API_KEY=sk-ant-...
```

Without it, the Kwami is a scripted deflector — impossible to beat by argument, which is the wrong difficulty curve for real play but exactly right for checking the loop end to end.

For streaming voice over WebRTC instead of the browser API:

```env
NUXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
NUXT_LIVEKIT_API_KEY=
NUXT_LIVEKIT_API_SECRET=
NUXT_LIVEKIT_AGENT_NAME=kwami-agent
NUXT_AGENT_API_KEY=
```

This repository mints the room tokens, dispatches the named agent into the room and bills the connection by the second. The worker itself — the thing that joins and speaks as the Kwami — is a separate service; see [Architecture](/docs/architecture#voice-and-where-it-stops) and [Energy](/docs/energy#metering-a-voice-connection).

`NUXT_LIVEKIT_AGENT_NAME` empty dispatches nothing, which is the right setting for keys without a worker: a room the player can talk into and nothing that answers is worse than the browser path. `NUXT_AGENT_API_KEY` is the shared key that worker presents to read a session's persona and phrase, and without it that callback refuses every caller.

With the LiveKit variables unset, `/api/session/:id/voice-token` and `/api/studio/voice-token` report `transport: "browser"` and the game runs on the Web Speech path — which is also what happens when the balance cannot pay for a second of voice.

#### Running the worker locally

Voice needs three processes, and the studio's rehearsal only works when all of
them are up:

| Process          | Port | What it does                                                 |
| ---------------- | ---- | ------------------------------------------------------------ |
| This app         | 3000 | Mints the room token, meters the connection, holds the draft |
| `kwami-lk-agent` | —    | Joins the room, runs STT/LLM/TTS, speaks as the Kwami        |
| `kwami-lk-api`   | 8080 | What the worker reports usage to (`KWAMI_API_URL`)           |

All three must point at the **same** LiveKit project: `NUXT_PUBLIC_LIVEKIT_URL`
here, `LIVEKIT_URL` in the other two. `NUXT_LIVEKIT_AGENT_NAME` must match the
name the worker registers under (`kwami-agent`, in its `agent/livekit.toml`), or
the token dispatches a worker that does not exist and the room stays silent.

```bash
cd ../kwami-lk-agent && make dev     # registers the worker
cd ../kwami-lk-api   && make dev     # usage + credits on :8080
```

A worker deployed to LiveKit Cloud registers under the same name and will
compete for jobs with a local one, so stop the deployed agent while developing
against it.

#### Configuring a draft over the room

A minted Kwami has a row the worker can read. A draft in the studio does not —
it only exists in the browser — so `useVoiceLink` publishes it over the room's
data channel instead, in the shape `kwami-lk-agent` parses: a `config` message
on join, then a `config_update` on every edit while the room stays open. That
second message is what makes the sliders live: `update_soul` rebuilds the
worker's instructions on the running agent, so the character changes without
dropping the conversation.

Two keys on that message are deliberate. `greeting: false` suppresses the
worker's default introduction, which is an assistant's opening and wrong for
something whose whole character is that it volunteers nothing.
`memory: {enabled: false}` keeps a rehearsal out of the worker's shared
`kwami_default` namespace — a draft has no id to file memory under, and the
studio promises the creator that nothing here is saved.

### 5. On-ramp

```env
NUXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY=pk_test_...
NUXT_MOONPAY_SECRET_KEY=sk_test_...
```

A `pk_test_` key automatically routes to MoonPay's sandbox.

## Known gotcha

If you add a Solana library that is only needed in the browser, import it **dynamically at its point of use** rather than at module scope. `@solana/spl-token` pulls in `bigint-buffer`, whose native addon hard-panics under Bun instead of falling back to JavaScript, and a module-scope import puts it in the SSR graph where it will kill the production server on its first page render. See [Architecture](/docs/architecture#why-bun).

## Commands

| Command                 | What it does                     |
| ----------------------- | -------------------------------- |
| `bun run dev`           | Development server on :3000      |
| `bun run build`         | Production build (Bun preset)    |
| `bun run test`          | Full Vitest suite                |
| `bun run test:watch`    | Watch mode                       |
| `bun run test:coverage` | Coverage, with thresholds        |
| `bun run typecheck`     | `vue-tsc` over the whole project |
| `bun run lint`          | ESLint                           |
| `bun run anchor:build`  | Build the Solana program         |
| `bun run db:push`       | Apply migrations                 |
