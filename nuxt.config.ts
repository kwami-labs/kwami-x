import { defineNuxtConfig } from 'nuxt/config'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-09-04',
  future: { compatibilityVersion: 4 },

  modules: ['@pinia/nuxt', '@vueuse/nuxt', '@nuxtjs/color-mode', '@nuxt/eslint'],

  css: ['~/assets/css/main.css'],

  colorMode: { classSuffix: '', preference: 'dark', fallback: 'dark' },

  devtools: { enabled: true },

  typescript: { strict: true, typeCheck: false },

  /**
   * `runtimeConfig` is the only place secrets live. Anything nested under
   * `public` reaches the browser; everything else stays on the Nitro side and
   * is only ever read inside `server/`.
   */
  runtimeConfig: {
    supabaseServiceKey: '',
    solanaRpcUrl: '',
    /** Base58 secret key of the win-attestation oracle. Never leaves the server. */
    oracleSecretKey: '',
    /** Encrypts Kwami secrets at rest so a database dump does not hand over every pot. */
    secretEncryptionKey: '',
    moonpaySecretKey: '',
    livekitApiKey: '',
    livekitApiSecret: '',
    openaiApiKey: '',
    anthropicApiKey: '',

    public: {
      supabaseUrl: '',
      supabaseAnonKey: '',
      solanaCluster: 'devnet',
      solanaRpcUrl: 'https://api.devnet.solana.com',
      kwamiProgramId: 'DoQubWtmNa4WZTLWxe1iptCDrwf81M8LHDrZDP7pEBbL',
      usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      moonpayPublishableKey: '',
      livekitUrl: '',
      siteUrl: 'http://localhost:3000',
    },
  },

  nitro: {
    preset: 'bun',
    /**
     * Nitro runs its own esbuild pass with its own target, so the Vite setting
     * below does not reach it. Every lamport amount here is a `bigint` literal,
     * and under the default es2019 esbuild warns they "may crash at run-time" —
     * which, in a handler that validates ticket prices, would be a crash while
     * money is being committed.
     */
    esbuild: { options: { target: 'es2020' } },
    /**
     * Bundle `docs/` into the server build.
     *
     * The docs route reads markdown at request time. Reading it from
     * `process.cwd()` works in development and 404s in production, because the
     * built output does not carry the repository. Server assets are copied into
     * the bundle, so the same route works in both.
     */
    serverAssets: [{ baseName: 'docs', dir: '../docs' }],
  },

  routeRules: {
    '/': { prerender: false },
    '/embed/**': { ssr: true },
  },

  vite: {
    optimizeDeps: {
      // web3.js reaches for Node globals that Vite does not shim by default.
      include: ['@solana/web3.js', 'bs58', 'tweetnacl'],
    },
    define: { global: 'globalThis' },
    /**
     * ES2020 or later, because every lamport amount in this app is a `bigint`
     * literal. Under the default es2019 target esbuild warns that they "may
     * crash at run-time" — and a crash while building a payment transaction is
     * the worst possible place for one.
     */
    esbuild: { target: 'es2020' },
    build: { target: 'es2020' },
  },

  app: {
    head: {
      title: 'Kwami — talk your way into the pot',
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'Kwami are Solana-native companions guarding a pot. Three minutes, your voice, their secret. Say it and take 80%.',
        },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})
