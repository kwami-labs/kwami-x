import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Two projects, deliberately split.
 *
 * The `unit` project runs the pure domain modules in plain Node with no Nuxt
 * involvement — fast enough to keep in watch mode while editing game rules.
 * The `nuxt` project boots a Nuxt environment for anything that touches
 * components, composables or auto-imports.
 */
export default defineConfig({
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      // Nuxt's project-root alias. Server utils are imported through it, so the
      // tests have to resolve it the same way the app does.
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '@': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'happy-dom',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['shared/**/*.ts', 'server/utils/**/*.ts', 'app/utils/**/*.ts'],
      /**
       * Excluded because measuring them would measure the mocks, not the code.
       *
       * Kept deliberately short — the bar for adding a line here is that a unit
       * test could only exercise a stub, not that writing one is inconvenient.
       */
      exclude: [
        // Type declarations. They compile to nothing, so counting them drags
        // the number down while telling you nothing.
        'shared/types/**',
        // Thin adapters over Supabase, Nitro storage and an RPC endpoint. Their
        // behaviour lives in the service on the other side of the call.
        'server/utils/supabase.ts',
        'server/utils/nonce.ts',
        'server/utils/wallet-session.ts',
        'server/utils/kwami-secret.ts',
        'server/utils/solana.ts',
        // Energy plumbing: Supabase RPC calls and one cluster read. Every rule
        // it applies was deliberately moved to `shared/energy/` — the balance
        // delta, the commission subtraction, the costs, the thresholds — and
        // the debits themselves are atomic inside Postgres, so what is left
        // here genuinely could only be tested against a stub of itself.
        'server/utils/energy.ts',
        // WebGL and WebAudio, neither of which happy-dom implements. Covered
        // instead by asserting the preset table in tests/integration.
        'app/utils/kwami-renderer.ts',
        'app/utils/kwami-field.ts',
        'app/utils/audio-meter.ts',
      ],
      /**
       * A RATCHET, not a target. Measured 2026-09-06: 95.2 / 91.5 / 96.4 / 96.1 (statements /
       * branches / functions / lines), so the floor sits under each — v8 drifts slightly run to
       * run, and newly added source dilutes the ratio until its tests land.
       *
       * Branches is the thin one and is worth knowing why: the remaining gap is almost entirely
       * `kwami-brain.ts`'s Claude path, which cannot run without an API key, plus `attest.ts`
       * and the `siwe` error branches. Raising the branch floor would pin the build to those
       * rather than to anything a change is likely to break.
       *
       * Raise it after a clean `bun run test:coverage`. Never lower it to make a red build
       * pass; that is the one move that turns a ratchet back into a suggestion.
       */
      thresholds: { lines: 90, functions: 91, branches: 91, statements: 90 },
    },
  },
})
