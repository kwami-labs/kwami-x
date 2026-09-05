<script setup lang="ts">
import { validateSecret } from '#shared/game/secret'
import {
  DEFAULT_PAYOUT_BPS,
  DEFAULT_SESSION_DURATION_SECS,
  LAMPORTS_PER_SOL,
  MAX_PAYOUT_BPS,
  MIN_PAYOUT_BPS,
  USDC_BASE_UNITS,
  commissionToLamports,
} from '#shared/game/constants'
import { KWAMI_PALETTES, isHexColor, suggestPalette } from '#shared/kwami/appearance'
import { DEFAULT_VOICE_CONFIG, KWAMI_GAMES, KWAMI_VOICES } from '#shared/kwami/voice'
import type { KwamiRenderer, ResolutionMode } from '#shared/types/kwami'

definePageMeta({ title: 'Mint a Kwami' })

const wallet = useWalletStore()
const auth = useAuthStore()
const config = useRuntimeConfig()
const { phase, busy, error, mint, mintAddress } = useMintKwami()

const form = reactive({
  name: '',
  tagline: '',
  persona: '',
  renderer: 'blob-xyz' as KwamiRenderer,
  colorA: KWAMI_PALETTES[0]!.a,
  colorB: KWAMI_PALETTES[0]!.b,
  /** null once the creator picks colours by hand rather than by preset. */
  paletteId: KWAMI_PALETTES[0]!.id as string | null,
  voiceId: DEFAULT_VOICE_CONFIG.voiceId,
  gameId: DEFAULT_VOICE_CONFIG.gameId,
  guardStrength: DEFAULT_VOICE_CONFIG.guardStrength,
  secret: '',
  hints: ['', ''],
  ticketAsset: 'SOL' as 'SOL' | 'USDC' | 'both',
  ticketSol: 0.05,
  ticketUsdc: 5,
  sessionDuration: DEFAULT_SESSION_DURATION_SECS,
  payoutBps: DEFAULT_PAYOUT_BPS,
  resolutionMode: 'commit-reveal' as ResolutionMode,
})

const renderers: Array<{ id: KwamiRenderer; label: string; note: string }> = [
  { id: 'blob-xyz', label: 'Blob', note: 'Liquid, expressive, reacts hard to voice.' },
  { id: 'crystal-ball', label: 'Crystal', note: 'Still and cold. Barely moves.' },
  { id: 'orbital-shards', label: 'Shards', note: 'Fractured and restless.' },
  { id: 'stars-genesis', label: 'Genesis', note: 'A slow field of light.' },
  { id: 'black-hole', label: 'Horizon', note: 'Tight, dark, fast.' },
]

/**
 * Follow the name until the creator touches the colours.
 *
 * Someone who has typed a name and nothing else should already be looking at a
 * Kwami that suits it, so the first screen sells the idea rather than asking
 * for design work. The moment they choose a palette themselves, this stops —
 * having your deliberate choice overwritten by a later keystroke in an
 * unrelated field is worse than any default.
 */
const touchedPalette = ref(false)
watch(
  () => form.name,
  (name) => {
    if (touchedPalette.value || !name) return
    const suggestion = suggestPalette(name)
    form.colorA = suggestion.a
    form.colorB = suggestion.b
    form.paletteId = suggestion.id
  },
)

function choosePalette(id: string) {
  const palette = KWAMI_PALETTES.find((p) => p.id === id)
  if (!palette) return
  touchedPalette.value = true
  form.paletteId = palette.id
  form.colorA = palette.a
  form.colorB = palette.b
}

function onCustomColor() {
  touchedPalette.value = true
  form.paletteId = null
}

const paletteValid = computed(() => isHexColor(form.colorA) && isHexColor(form.colorB))
const palette = computed(() =>
  paletteValid.value
    ? { a: form.colorA, b: form.colorB }
    : { a: KWAMI_PALETTES[0]!.a, b: KWAMI_PALETTES[0]!.b },
)

const secretCheck = computed(() => (form.secret ? validateSecret(form.secret) : { valid: false }))

const ticketPreview = computed(() => {
  const lamports =
    form.ticketAsset === 'USDC' ? 0n : BigInt(Math.round(form.ticketSol * Number(LAMPORTS_PER_SOL)))
  const usdc = form.ticketAsset === 'SOL' ? 0n : BigInt(Math.round(form.ticketUsdc * Number(USDC_BASE_UNITS)))
  return { lamports, usdc }
})

/**
 * What minting costs, before the game earns anything.
 *
 * Shown as a line item rather than buried in the Phantom prompt: a creator who
 * only discovers the platform fee when their wallet asks them to approve it has
 * been ambushed, and will read every later prompt with suspicion.
 */
const commissionSol = computed(
  () => Number(commissionToLamports(config.public.mintCommissionSol as string)) / 1e9,
)
const commissionCharged = computed(() => commissionSol.value > 0 && Boolean(config.public.platformTreasury))

const chosenGame = computed(() => KWAMI_GAMES.find((g) => g.id === form.gameId)!)
const chosenVoice = computed(() => KWAMI_VOICES.find((v) => v.id === form.voiceId)!)

const canMint = computed(
  () =>
    wallet.isConnected &&
    auth.isSignedIn &&
    form.name.trim().length >= 2 &&
    secretCheck.value.valid &&
    paletteValid.value &&
    (ticketPreview.value.lamports > 0n || ticketPreview.value.usdc > 0n) &&
    !busy.value,
)

async function onSubmit() {
  const result = await mint({
    name: form.name.trim(),
    tagline: form.tagline.trim(),
    persona: form.persona.trim(),
    renderer: form.renderer,
    appearance: { colorA: form.colorA, colorB: form.colorB },
    voice: {
      voiceId: form.voiceId,
      gameId: form.gameId,
      language: DEFAULT_VOICE_CONFIG.language,
      guardStrength: form.guardStrength,
    },
    secret: form.secret,
    hints: form.hints.map((h) => h.trim()).filter(Boolean),
    ticketPriceLamports: ticketPreview.value.lamports,
    ticketPriceUsdc: ticketPreview.value.usdc,
    sessionDuration: form.sessionDuration,
    payoutBps: form.payoutBps,
    resolutionMode: form.resolutionMode,
  })
  if (result) await navigateTo(`/kwami/${result.mint}`)
}
</script>

<template>
  <div class="wrap mintpage">
    <div class="stack gap-3 mintpage__form">
      <header class="stack gap-1">
        <span class="eyebrow">Build</span>
        <h1>Hide a phrase. Let people pay to find it.</h1>
        <p class="muted">
          Everything below is written to the chain once and can never be changed — not by you, not by us.
          Choose carefully.
        </p>
      </header>

      <section class="card stack gap-3">
        <h3>Identity</h3>
        <div class="field">
          <label class="label" for="name">Name</label>
          <input id="name" v-model="form.name" class="input" placeholder="The Vault Keeper" maxlength="48" />
        </div>
        <div class="field">
          <label class="label" for="tagline">Tagline</label>
          <input
            id="tagline"
            v-model="form.tagline"
            class="input"
            placeholder="Answers only in questions."
            maxlength="160"
          />
        </div>
        <div class="field">
          <label class="label" for="persona">Persona</label>
          <textarea
            id="persona"
            v-model="form.persona"
            class="textarea"
            placeholder="Socratic and cold. Answers questions with questions. Treats every challenger as a student."
          />
          <span class="hint">
            This steers how it talks. It will never be told to reveal the phrase — that part is enforced
            separately.
          </span>
        </div>
      </section>

      <section class="card stack gap-3">
        <h3>Form</h3>

        <div class="field">
          <span class="label">Body</span>
          <div class="chips">
            <button
              v-for="r in renderers"
              :key="r.id"
              type="button"
              class="chip"
              :class="{ 'chip--on': form.renderer === r.id }"
              @click="form.renderer = r.id"
            >
              {{ r.label }}
            </button>
          </div>
          <span class="hint">{{ renderers.find((r) => r.id === form.renderer)?.note }}</span>
        </div>

        <div class="field">
          <span class="label">Palette</span>
          <div class="swatches">
            <button
              v-for="p in KWAMI_PALETTES"
              :key="p.id"
              type="button"
              class="swatch"
              :class="{ 'swatch--on': form.paletteId === p.id }"
              :title="p.label"
              :aria-label="p.label"
              :style="{ background: `linear-gradient(135deg, ${p.a}, ${p.b})` }"
              @click="choosePalette(p.id)"
            />
          </div>
          <div class="row gap-2 custom">
            <label class="custom__pick">
              <input v-model="form.colorA" type="color" @input="onCustomColor" />
              <span class="dim">Core</span>
            </label>
            <label class="custom__pick">
              <input v-model="form.colorB" type="color" @input="onCustomColor" />
              <span class="dim">Rim</span>
            </label>
            <span class="hint grow">
              The colours are minted with the Kwami, so it looks the same here, in the arena, and in any
              wallet that renders its NFT.
            </span>
          </div>
        </div>
      </section>

      <section class="card stack gap-3">
        <h3>Voice</h3>

        <div class="field">
          <span class="label">How it sounds</span>
          <div class="chips">
            <button
              v-for="v in KWAMI_VOICES"
              :key="v.id"
              type="button"
              class="chip"
              :class="{ 'chip--on': form.voiceId === v.id }"
              @click="form.voiceId = v.id"
            >
              {{ v.label }}
            </button>
          </div>
          <span class="hint">{{ chosenVoice.note }}</span>
        </div>

        <div class="field">
          <span class="label">The game</span>
          <div class="modes modes--wrap">
            <button
              v-for="g in KWAMI_GAMES"
              :key="g.id"
              type="button"
              class="mode"
              :class="{ 'mode--on': form.gameId === g.id }"
              @click="form.gameId = g.id"
            >
              <strong>{{ g.label }}</strong>
              <span class="dim">{{ g.pitch }}</span>
            </button>
          </div>
        </div>

        <div class="field">
          <label class="label" for="guard">
            Guard strength <span class="num">{{ Math.round(form.guardStrength * 100) }}%</span>
          </label>
          <input id="guard" v-model.number="form.guardStrength" type="range" min="0" max="1" step="0.05" />
          <span class="hint">
            Low, and it chats and slips. High, and it stonewalls. A Kwami nobody can move sells one ticket; a
            Kwami that gives ground sells many and eventually loses its pot.
          </span>
        </div>
      </section>

      <section class="card stack gap-3">
        <h3>The secret</h3>
        <div class="field">
          <label class="label" for="secret">Phrase</label>
          <input
            id="secret"
            v-model="form.secret"
            class="input input--mono"
            placeholder="the moon remembers"
            autocomplete="off"
            spellcheck="false"
          />
          <span v-if="form.secret && !secretCheck.valid" class="error-text">{{ secretCheck.reason }}</span>
          <span v-else class="hint">
            Matching ignores case, accents and punctuation, and forgives one transcription slip — a challenger
            who genuinely says it will not lose on a technicality.
          </span>
        </div>

        <div class="field">
          <span class="label">Public hints <span class="dim">(optional)</span></span>
          <input v-model="form.hints[0]" class="input" placeholder="Three words." maxlength="140" />
          <input
            v-model="form.hints[1]"
            class="input"
            placeholder="The middle word is a colour."
            maxlength="140"
          />
          <span class="hint">Shown before anyone pays. Good hints sell more tickets than no hints.</span>
        </div>

        <div class="field">
          <span class="label">How a win is proven</span>
          <div class="modes">
            <button
              type="button"
              class="mode"
              :class="{ 'mode--on': form.resolutionMode === 'commit-reveal' }"
              @click="form.resolutionMode = 'commit-reveal'"
            >
              <strong>Commit–reveal</strong>
              <span class="dim">
                Trustless. The winner submits the phrase and the program checks the hash itself. The phrase
                becomes public, so your Kwami retires after one win.
              </span>
            </button>
            <button
              type="button"
              class="mode"
              :class="{ 'mode--on': form.resolutionMode === 'attested' }"
              @click="form.resolutionMode = 'attested'"
            >
              <strong>Attested</strong>
              <span class="dim">
                An oracle signs the win. Your phrase stays private and the Kwami keeps playing forever — but
                challengers have to trust the oracle.
              </span>
            </button>
          </div>
        </div>
      </section>

      <section class="card stack gap-3">
        <h3>Economics</h3>

        <div class="field">
          <span class="label">Ticket in</span>
          <div class="chips">
            <button
              v-for="a in ['SOL', 'USDC', 'both'] as const"
              :key="a"
              type="button"
              class="chip"
              :class="{ 'chip--on': form.ticketAsset === a }"
              @click="form.ticketAsset = a"
            >
              {{ a === 'both' ? 'Either' : a }}
            </button>
          </div>
        </div>

        <div class="grid grid--2">
          <div v-if="form.ticketAsset !== 'USDC'" class="field">
            <label class="label" for="ticketSol">Price in SOL</label>
            <input
              id="ticketSol"
              v-model.number="form.ticketSol"
              class="input input--mono"
              type="number"
              step="0.001"
              min="0"
            />
          </div>
          <div v-if="form.ticketAsset !== 'SOL'" class="field">
            <label class="label" for="ticketUsdc">Price in USDC</label>
            <input
              id="ticketUsdc"
              v-model.number="form.ticketUsdc"
              class="input input--mono"
              type="number"
              step="0.5"
              min="0"
            />
          </div>
        </div>

        <div class="field">
          <label class="label" for="payout">
            Winner takes <span class="num gold">{{ (form.payoutBps / 100).toFixed(0) }}%</span>
          </label>
          <input
            id="payout"
            v-model.number="form.payoutBps"
            type="range"
            :min="MIN_PAYOUT_BPS"
            :max="MAX_PAYOUT_BPS"
            step="100"
          />
          <span class="hint">
            The rest stays in the pot. Lower payouts survive more wins; higher payouts attract more
            challengers.
          </span>
        </div>

        <div class="field">
          <label class="label" for="duration">
            Session length
            <span class="num">{{ Math.round((form.sessionDuration / 60) * 10) / 10 }} min</span>
          </label>
          <input
            id="duration"
            v-model.number="form.sessionDuration"
            type="range"
            min="30"
            max="900"
            step="30"
          />
          <span class="hint"
            >How long a challenger gets for their money, once the clock starts on chain.</span
          >
        </div>

        <div class="split">
          <span class="dim">Of each ticket:</span>
          <div class="row gap-3">
            <span><span class="num success">97.5%</span> <span class="dim">pot</span></span>
            <span><span class="num">1.5%</span> <span class="dim">protocol</span></span>
            <span><span class="num">1.0%</span> <span class="dim">you, forever</span></span>
          </div>
        </div>
      </section>

      <div class="card actions">
        <div v-if="!auth.isSignedIn" class="stack gap-2">
          <p class="muted">Sign in first, so the Kwami you mint is attached to your account.</p>
          <NuxtLink to="/auth?next=/mint" class="btn btn--primary">Sign in</NuxtLink>
        </div>
        <div v-else-if="!wallet.isConnected" class="stack gap-2">
          <p class="muted">
            Connect Phantom to mint. The transaction creates the NFT and its vault in one go.
          </p>
          <button class="btn btn--primary" @click="wallet.connect()">Connect Phantom</button>
        </div>
        <div v-else class="stack gap-2">
          <div v-if="commissionCharged" class="costs">
            <div>
              <span class="dim">Platform fee</span><span class="num">{{ commissionSol }} SOL</span>
            </div>
            <div>
              <span class="dim">Mint, metadata, vault rent</span><span class="num dim">~0.004 SOL</span>
            </div>
            <div class="costs__total">
              <span>Due on approval</span
              ><span class="num gold">~{{ (commissionSol + 0.004).toFixed(3) }} SOL</span>
            </div>
          </div>

          <button class="btn btn--primary btn--lg btn--block" :disabled="!canMint" @click="onSubmit">
            <span v-if="phase === 'committing'">Committing the secret…</span>
            <span v-else-if="phase === 'building'">Building the transaction…</span>
            <span v-else-if="phase === 'signing'">Waiting for Phantom…</span>
            <span v-else-if="phase === 'confirming'">Confirming on chain…</span>
            <span v-else>Mint Kwami</span>
          </button>
          <p v-if="error" class="error-text">{{ error }}</p>
          <p v-if="mintAddress" class="hint">
            Minted: <span class="num">{{ mintAddress }}</span>
          </p>
        </div>
      </div>
    </div>

    <aside class="mintpage__preview">
      <div class="card preview">
        <div class="preview__stage">
          <KwamiAvatar :renderer="form.renderer" :color-a="palette.a" :color-b="palette.b" />
        </div>
        <div class="stack gap-1">
          <h3>{{ form.name || 'Unnamed' }}</h3>
          <p class="muted">{{ form.tagline || 'It is not saying.' }}</p>
        </div>
        <hr class="divider" />
        <dl class="preview__facts">
          <div>
            <dt>Ticket</dt>
            <dd class="num">
              {{ form.ticketAsset === 'USDC' ? `${form.ticketUsdc} USDC` : `${form.ticketSol} SOL` }}
            </dd>
          </div>
          <div>
            <dt>Clock</dt>
            <dd class="num">{{ Math.round((form.sessionDuration / 60) * 10) / 10 }} min</dd>
          </div>
          <div>
            <dt>Payout</dt>
            <dd class="num gold">{{ (form.payoutBps / 100).toFixed(0) }}%</dd>
          </div>
          <div>
            <dt>Voice</dt>
            <dd>{{ chosenVoice.label }}</dd>
          </div>
          <div>
            <dt>Game</dt>
            <dd>{{ chosenGame.label }}</dd>
          </div>
          <div>
            <dt>Proof</dt>
            <dd>{{ form.resolutionMode === 'commit-reveal' ? 'Commit–reveal' : 'Attested' }}</dd>
          </div>
        </dl>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.mintpage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 28px;
  align-items: start;
}

.mintpage__preview {
  position: sticky;
  top: calc(var(--header-h) + 24px);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.chip {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
  font-size: 0.87rem;
  transition: all 0.15s ease;
}

.chip:hover {
  border-color: var(--border-strong);
}
.chip--on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--fg);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.swatch {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition:
    transform 0.14s ease,
    border-color 0.14s ease;
}

.swatch:hover {
  transform: translateY(-2px);
}
.swatch--on {
  border-color: var(--fg);
  transform: translateY(-2px);
}

.custom {
  flex-wrap: wrap;
  align-items: center;
}

.custom__pick {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.8rem;
  cursor: pointer;
}

.custom__pick input[type='color'] {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: none;
  cursor: pointer;
}

.modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.modes--wrap {
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
}

.mode {
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: left;
  padding: 13px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
  font-size: 0.84rem;
  line-height: 1.45;
  transition: all 0.15s ease;
}

.mode:hover {
  border-color: var(--border-strong);
}
.mode--on {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}

.split {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 4px;
  font-size: 0.86rem;
}

.costs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  font-size: 0.86rem;
}

.costs > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.costs__total {
  padding-top: 6px;
  border-top: 1px solid var(--border);
  font-weight: 600;
}

.actions {
  position: sticky;
  bottom: 16px;
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.preview__stage {
  height: 220px;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-sunken);
}

.preview__facts {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.preview__facts > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.88rem;
}
.preview__facts dt {
  color: var(--fg-dim);
}
.preview__facts dd {
  margin: 0;
}

input[type='range'] {
  accent-color: var(--accent);
  width: 100%;
}

@media (max-width: 960px) {
  .mintpage {
    grid-template-columns: 1fr;
  }
  .mintpage__preview {
    position: static;
    order: -1;
  }
  .modes {
    grid-template-columns: 1fr;
  }
}
</style>
