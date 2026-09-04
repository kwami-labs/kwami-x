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
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
})
