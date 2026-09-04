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
NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NUXT_PUBLIC_SUPABASE_ANON_KEY=...
NUXT_SUPABASE_SERVICE_KEY=...
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
```

The bootstrap script creates the protocol config account, a USDC-like mint and a funded treasury.

### 4. Voice

Nothing is required. Without any configuration the game uses the browser's own Web Speech API for recognition and synthesis, which works in Chrome and Edge and needs no keys.

For a real conversational Kwami:

```env
NUXT_ANTHROPIC_API_KEY=sk-ant-...
```

Without it, the Kwami is a scripted deflector — impossible to beat by argument, which is the wrong difficulty curve for real play but exactly right for checking the loop end to end.

### 5. On-ramp

```env
NUXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY=pk_test_...
NUXT_MOONPAY_SECRET_KEY=sk_test_...
```

A `pk_test_` key automatically routes to MoonPay's sandbox.

## Known gotcha

If you add a Solana library that is only needed in the browser, import it **dynamically at its point of use** rather than at module scope. `@solana/spl-token` pulls in `bigint-buffer`, whose native addon hard-panics under Bun instead of falling back to JavaScript, and a module-scope import puts it in the SSR graph where it will kill the production server on its first page render. See [Architecture](/docs/architecture#why-bun).

## Commands

| Command | What it does |
|---------|-------------|
| `bun run dev` | Development server on :3000 |
| `bun run build` | Production build (Bun preset) |
| `bun run test` | Full Vitest suite |
| `bun run test:watch` | Watch mode |
| `bun run test:coverage` | Coverage, with thresholds |
| `bun run typecheck` | `vue-tsc` over the whole project |
| `bun run lint` | ESLint |
| `bun run anchor:build` | Build the Solana program |
| `bun run db:push` | Apply migrations |
