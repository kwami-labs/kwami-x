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
        // WebGL and WebAudio, neither of which happy-dom implements. Covered
        // instead by asserting the preset table in tests/integration.
        'app/utils/kwami-renderer.ts',
        'app/utils/audio-meter.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
})
