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
     * Force `bigint-buffer` onto its pure-JavaScript implementation.
     *
     * `@solana/spl-token` pulls it in transitively. Its Node build tries to
     * load a native NAPI addon and falls back to JS on failure — but under Bun
     * that load is a hard panic (`unsupported uv function: uv_version_string`),
     * so the `catch` never runs and the server dies on boot rather than
     * degrading. `dist/browser.js` is the byte-identical JS implementation
     * minus the binding attempt. The native path is a micro-optimisation on
     * buffer conversions; nothing here is hot enough to notice.
     *
     * Track: https://github.com/oven-sh/bun/issues/18546
     */
    alias: {
      'bigint-buffer': 'bigint-buffer/dist/browser.js',
    },
    // The alias only applies to bundled code. By default Nitro externalises
    // node_modules and copies them verbatim, which would ship the native build
    // untouched — so this package is inlined to force it through the alias.
    externals: {
      inline: ['bigint-buffer', '@solana/buffer-layout-utils'],
    },
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
