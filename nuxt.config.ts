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
    /**
     * Supabase secret key (`sb_secret_…`). Bypasses RLS.
     * Server-only — never nest under `public` or prefix with `NUXT_PUBLIC_`.
     */
    supabaseSecretKey: '',
    solanaRpcUrl: '',
    /** Base58 secret key of the win-attestation oracle. Never leaves the server. */
    oracleSecretKey: '',
    /** Encrypts Kwami secrets at rest so a database dump does not hand over every pot. */
    secretEncryptionKey: '',
    moonpaySecretKey: '',
    livekitApiKey: '',
    livekitApiSecret: '',
    /**
     * The named LiveKit agent to dispatch into a Kwami's room.
     *
     * Empty dispatches nothing, which is the right posture for a deployment
     * with LiveKit keys but no worker running: a room the player can talk into
     * and nothing that answers is worse than the browser path.
     */
    livekitAgentName: 'kwami-agent',
    /**
     * Shared key the voice worker presents to read a session's persona and
     * secret. Server-to-server only — see `server/api/internal/kwamis/[id]/runtime.get.ts`.
     */
    agentApiKey: '',
    openaiApiKey: '',
    anthropicApiKey: '',

    public: {
      /** Hosted project ref; URL becomes `https://{id}.supabase.co` when `supabaseUrl` is empty. */
      supabaseProjectId: '',
      /** Optional override (local `supabase start` → `http://127.0.0.1:54321`). */
      supabaseUrl: '',
      /** Publishable key (`sb_publishable_…`). Safe in the browser with RLS. */
      supabasePublishableKey: '',
      solanaCluster: 'devnet',
      solanaRpcUrl: 'https://api.devnet.solana.com',
      kwamiProgramId: 'DoQubWtmNa4WZTLWxe1iptCDrwf81M8LHDrZDP7pEBbL',
      usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      moonpayPublishableKey: '',
      livekitUrl: '',
      siteUrl: 'http://localhost:3000',
      /**
       * Where the mint commission is paid. Public because the browser builds
       * the mint transaction and the user has to see the destination in
       * Phantom's preview before approving it.
       *
       * Left empty by default, and an empty treasury means no commission
       * instruction at all — a fresh clone pointed at devnet should be able to
       * mint without first inventing an address to pay.
       */
      platformTreasury: '',
      /** Flat SOL commission per mint. Decimal string; see commissionToLamports. */
      mintCommissionSol: '0.5',
      /**
       * How much energy one SOL buys.
       *
       * Public because the studio quotes the fuel a creator is about to buy
       * before they approve the transaction, and a number the browser had to
       * ask the server for would be a number the page could not show while the
       * slider was moving.
       *
       * A deployment setting rather than a constant: the real cost of a reply
       * is denominated in dollars and SOL is not, so an operator has to be able
       * to move this without a release.
       */
      energyPerSol: '20000',
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
     * Inline the `@noble/*` packages instead of leaving them external.
     *
     * `@solana/web3.js` pins these at v1 and gets its own nested copies,
     * because the top level is on v2 — which renamed every export
     * (`./ed25519` became `./ed25519.js`). Externalising writes the bare v1
     * specifier into `.output/server/chunks/`, outside web3.js's directory, so
     * at runtime it resolves against the hoisted v2 and dies on the first
     * request with `Cannot find module '@noble/curves/ed25519'` — then
     * `@noble/hashes/sha256` behind it.
     *
     * The build succeeds either way and no test catches it: it is a resolution
     * failure at request time, in the bundle only. Inlining pins the nested v1
     * into the chunk that actually uses it.
     */
    externals: { inline: ['@noble/curves', '@noble/hashes'] },
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
     * literal, and a crash while building a payment transaction is the worst
     * possible place for one.
     *
     * Only `build.target` is set. Vite 8 transforms with oxc rather than
     * esbuild and warns that a `vite.esbuild` block is being ignored outright —
     * so leaving one here would read as a guarantee the build no longer makes.
     * `build.target` is the setting that actually governs downlevelling, and
     * the output does carry `0n` literals through unchanged.
     */
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
