<script setup lang="ts">
import { validateSecret } from '#shared/game/secret'
import {
  AUTHOR_ROYALTY_BPS_OF_FEE,
  BPS_DENOMINATOR,
  DEFAULT_PAYOUT_BPS,
  DEFAULT_SESSION_DURATION_SECS,
  LAMPORTS_PER_SOL,
  MAX_PAYOUT_BPS,
  MIN_PAYOUT_BPS,
  PROTOCOL_FEE_BPS,
  USDC_BASE_UNITS,
  commissionToLamports,
} from '#shared/game/constants'
import {
  KWAMI_PALETTES,
  TUNING_RANGES,
  isHexColor,
  suggestPalette,
  toAppearance,
  type KwamiTuning,
} from '#shared/kwami/appearance'
import { DEFAULT_VOICE_CONFIG, KWAMI_GAMES, KWAMI_VOICES } from '#shared/kwami/voice'
import { NEUTRAL_TRAITS, type TraitVector } from '#shared/kwami/traits'
import { KWAMI_LOOKS, paletteOfLook } from '#shared/kwami/looks'
import { randomKwami } from '#shared/kwami/random'
import type { KwamiPersona } from '#shared/kwami/personas'
import { energyFromLamports, toEnergy } from '#shared/energy/cost'
import type { KwamiRenderer, ResolutionMode } from '#shared/types/kwami'

definePageMeta({ title: 'Mint a Kwami' })

const wallet = useWalletStore()
const auth = useAuthStore()
const config = useRuntimeConfig()
const { phase, busy, error, mint, mintAddress } = useMintKwami()
const studio = useStudioPreview()

type Tab = 'identity' | 'form' | 'voice' | 'secret' | 'economics'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'identity', label: 'Identity' },
  { id: 'form', label: 'Form' },
  { id: 'voice', label: 'Voice' },
  { id: 'secret', label: 'Secret' },
  { id: 'economics', label: 'Economics' },
]
const tab = ref<Tab>('identity')

const form = reactive({
  name: '',
  tagline: '',
  persona: '',
  personaId: null as string | null,
  traits: { ...NEUTRAL_TRAITS } as TraitVector,
  renderer: 'blob-xyz' as KwamiRenderer,
  colorA: KWAMI_PALETTES[0]!.a,
  colorB: KWAMI_PALETTES[0]!.b,
  /** null once the creator picks colours by hand rather than by preset. */
  paletteId: KWAMI_PALETTES[0]!.id as string | null,
  lookId: null as string | null,
  tuning: {} as Partial<KwamiTuning>,
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
  fuelSol: 0.2,
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
  form.lookId = null
}

function onCustomColor() {
  touchedPalette.value = true
  form.paletteId = null
  form.lookId = null
}

/** A whole visual identity at once — body, palette and the tuning that suits it. */
function chooseLook(id: string) {
  const look = KWAMI_LOOKS.find((l) => l.id === id)
  if (!look) return
  const palette = paletteOfLook(look)
  touchedPalette.value = true
  form.lookId = look.id
  form.renderer = look.renderer
  form.paletteId = palette.id
  form.colorA = palette.a
  form.colorB = palette.b
  form.tuning = { ...look.tuning }
}

function choosePersona(persona: KwamiPersona) {
  form.personaId = persona.id
  form.persona = persona.persona
  form.traits = { ...persona.traits }
}

/**
 * Roll the whole thing.
 *
 * The fastest route from an empty form to something worth reacting to. It
 * leaves the name, the phrase and the economics alone: those are the creator's
 * actual decisions, and a dice that overwrote a phrase someone had thought
 * about for ten minutes would be a hostile button.
 */
function roll() {
  const rolled = randomKwami(Math.random)
  touchedPalette.value = true
  form.renderer = rolled.renderer
  form.colorA = rolled.colorA
  form.colorB = rolled.colorB
  form.paletteId = rolled.paletteId
  form.lookId = rolled.look.id
  form.tuning = { ...rolled.look.tuning }
  form.persona = rolled.persona.persona
  form.personaId = rolled.persona.id
  form.traits = rolled.traits
  form.voiceId = rolled.voiceId
  form.gameId = rolled.gameId
}

function setTuning(key: keyof KwamiTuning, value: number) {
  form.tuning = { ...form.tuning, [key]: value }
  // The look described a specific combination; once a slider moves it is no
  // longer that combination, and leaving the card highlighted would say it is.
  form.lookId = null
}

function clearTuning() {
  form.tuning = {}
  form.lookId = null
}

const tuningCount = computed(() => Object.keys(form.tuning).length)

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
 * Shown as line items rather than buried in the Phantom prompt: a creator who
 * only discovers the platform fee when their wallet asks them to approve it has
 * been ambushed, and will read every later prompt with suspicion. The same goes
 * for the fuel — it is the one charge here that is genuinely optional, so it
 * has to be legible enough to decline.
 */
const commissionSol = computed(
  () => Number(commissionToLamports(config.public.mintCommissionSol as string)) / 1e9,
)
const treasuryConfigured = computed(() => Boolean(config.public.platformTreasury))
const commissionCharged = computed(() => commissionSol.value > 0 && treasuryConfigured.value)

const energyPerSol = computed(() => {
  const configured = Number(config.public.energyPerSol)
  return Number.isFinite(configured) && configured > 0 ? configured : 20_000
})

const fuelLamports = computed(() =>
  treasuryConfigured.value ? BigInt(Math.round(Math.max(0, form.fuelSol) * Number(LAMPORTS_PER_SOL))) : 0n,
)
const fuelEnergy = computed(() => toEnergy(energyFromLamports(fuelLamports.value, energyPerSol.value)))

const dueSol = computed(() => (commissionCharged.value ? commissionSol.value : 0) + form.fuelSol + 0.004)

/** The ticket split, derived rather than written out — the constants can move. */
const split = computed(() => {
  const feePct = (PROTOCOL_FEE_BPS / BPS_DENOMINATOR) * 100
  const authorPct = feePct * (AUTHOR_ROYALTY_BPS_OF_FEE / BPS_DENOMINATOR)
  return {
    vault: (100 - feePct).toFixed(1),
    protocol: (feePct - authorPct).toFixed(1),
    author: authorPct.toFixed(1),
  }
})

const chosenGame = computed(() => KWAMI_GAMES.find((g) => g.id === form.gameId)!)
const chosenVoice = computed(() => KWAMI_VOICES.find((v) => v.id === form.voiceId)!)

/**
 * The stage's vitality is the energy balance, not the pot.
 *
 * Before a Kwami is minted it has no pot at all, so the shader's dying-Kwami
 * behaviour is free to mean something else here — and what it means is the
 * thing the creator actually needs to see: a Kwami running low visibly deflates
 * and desaturates while they are still designing it.
 */
const stageVitality = computed(() => {
  if (studio.balance.value === null) return 1
  if (studio.balance.value <= 0n) return 0.12
  const full = 40_000n
  const capped = studio.balance.value > full ? full : studio.balance.value
  return 0.25 + 0.75 * (Number((capped * 1000n) / full) / 1000)
})

/** Guard strength reads as tension on the surface, so the slider has a visible effect. */
const stageArousal = computed(() => form.guardStrength * 0.5)

const testBlocked = computed(() =>
  secretCheck.value.valid
    ? null
    : 'Write the phrase first — the whole character is built around having something to protect, and it cannot rehearse without one.',
)

function testDraft() {
  return {
    persona: form.persona.trim(),
    gameId: form.gameId,
    guardStrength: form.guardStrength,
    traits: form.traits,
    secret: form.secret,
  }
}

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

/**
 * Keep the work in progress across a reload — except the phrase.
 *
 * Losing twenty minutes of design to a refresh is the kind of thing that makes
 * someone not come back. The secret is the one field deliberately excluded: it
 * is worth real money the moment the Kwami is live, and leaving it in a browser
 * store after the tab closes would be storing it somewhere the creator never
 * agreed to.
 */
const DRAFT_KEY = 'kwami.studio.draft.v1'

onMounted(() => {
  void studio.loadBalance()
  try {
    const saved = localStorage.getItem(DRAFT_KEY)
    if (!saved) return
    const parsed = JSON.parse(saved) as Partial<typeof form>
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'secret' || value === undefined) continue
      ;(form as Record<string, unknown>)[key] = value
    }
    if (parsed.paletteId !== undefined || parsed.colorA) touchedPalette.value = true
  } catch {
    // A corrupt or unreadable draft is not worth a broken page.
  }
})

watchDebounced(
  () => ({ ...form, secret: '' }),
  (snapshot) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot))
    } catch {
      // Private mode, or a full quota. Neither is worth interrupting anyone for.
    }
  },
  { debounce: 400, deep: true },
)

async function onSubmit() {
  const result = await mint({
    name: form.name.trim(),
    tagline: form.tagline.trim(),
    persona: form.persona.trim(),
    renderer: form.renderer,
    appearance: toAppearance(palette.value, form.tuning) as Record<string, string>,
    voice: {
      voiceId: form.voiceId,
      gameId: form.gameId,
      language: DEFAULT_VOICE_CONFIG.language,
      guardStrength: form.guardStrength,
      traits: form.traits,
      ...(form.personaId ? { personaId: form.personaId } : {}),
    },
    secret: form.secret,
    hints: form.hints.map((h) => h.trim()).filter(Boolean),
    ticketPriceLamports: ticketPreview.value.lamports,
    ticketPriceUsdc: ticketPreview.value.usdc,
    sessionDuration: form.sessionDuration,
    payoutBps: form.payoutBps,
    resolutionMode: form.resolutionMode,
    fuelLamports: fuelLamports.value,
  })
  if (result) {
    // The draft is spent — it describes something that now exists on chain, and
    // restoring it on the next visit would invite an accidental duplicate.
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* nothing to clean up */
    }
    await navigateTo(`/kwami/${result.mint}`)
  }
}
</script>

<template>
  <div class="wrap studio">
    <!-- ── The Kwami itself ──────────────────────────────────────────────── -->
    <section class="studio__left stack gap-3">
      <div class="stage">
        <KwamiAvatar
          :renderer="form.renderer"
          :color-a="palette.a"
          :color-b="palette.b"
          :vitality="stageVitality"
          :arousal="stageArousal"
          :activity="studio.activity.value"
          :tuning="form.tuning"
        />

        <div class="stage__top">
          <div class="stage__name">
            <strong>{{ form.name || 'Unnamed' }}</strong>
            <span class="dim">{{ form.tagline || 'It is not saying.' }}</span>
          </div>
          <button type="button" class="btn btn--sm stage__dice" title="Roll a whole Kwami" @click="roll">
            🎲
          </button>
        </div>

        <!--
          The promises the Kwami is making, on the object itself.
          These are the same four facts a challenger reads on the profile before
          paying, so the creator should be looking at them while they set them
          rather than finding them on another screen afterwards.
        -->
        <dl class="stage__facts">
          <div>
            <dt>Voice</dt>
            <dd>{{ chosenVoice.label }}</dd>
          </div>
          <div>
            <dt>Game</dt>
            <dd>{{ chosenGame.label }}</dd>
          </div>
          <div>
            <dt>Ticket</dt>
            <dd class="num">
              {{ form.ticketAsset === 'USDC' ? `${form.ticketUsdc} USDC` : `${form.ticketSol} SOL` }}
            </dd>
          </div>
          <div>
            <dt>Payout</dt>
            <dd class="num gold">{{ (form.payoutBps / 100).toFixed(0) }}%</dd>
          </div>
        </dl>

        <div class="stage__meter">
          <EnergyMeter :balance="studio.balance.value" compact />
        </div>
      </div>

      <div class="card stack gap-2">
        <div class="row gap-2">
          <span class="eyebrow grow">Test drive</span>
          <span v-if="studio.source.value === 'trial'" class="dim stage__src">free trial</span>
          <span v-else-if="studio.source.value === 'demo'" class="dim stage__src">demo</span>
        </div>
        <TestDrive
          :turns="studio.turns.value"
          :thinking="studio.thinking.value"
          :error="studio.error.value"
          :exhausted="studio.exhausted.value"
          :blocked="testBlocked"
          @say="studio.say($event, testDraft())"
          @reset="studio.reset()"
          @fuel="tab = 'economics'"
        />
      </div>
    </section>

    <!-- ── What it is ───────────────────────────────────────────────────── -->
    <section class="studio__panel stack gap-3">
      <header class="stack gap-1">
        <span class="eyebrow">Build</span>
        <h1>Hide a phrase. Let people pay to find it.</h1>
        <p class="muted">
          Everything below is written to the chain once and can never be changed — not by you, not by us. Talk
          to it first.
        </p>
      </header>

      <nav class="tabs">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          class="tab"
          :class="{ 'tab--on': tab === t.id }"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>

      <!-- Identity -->
      <div v-show="tab === 'identity'" class="card stack gap-3">
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
          <span class="label">Character</span>
          <PersonaPicker :selected="form.personaId" @pick="choosePersona" />
          <span class="hint">
            A starting point, not a menu. Picking one writes the description and the dials below, and
            everything stays editable afterwards.
          </span>
        </div>

        <div class="field">
          <label class="label" for="persona">How it talks</label>
          <textarea
            id="persona"
            v-model="form.persona"
            class="textarea"
            placeholder="Socratic and cold. Answers questions with questions. Treats every challenger as a student."
            @input="form.personaId = null"
          />
          <span class="hint">
            This steers how it talks. It will never be told to reveal the phrase — that part is enforced
            separately.
          </span>
        </div>

        <div class="field">
          <span class="label">Temperament</span>
          <TraitSliders v-model="form.traits" />
        </div>
      </div>

      <!-- Form -->
      <div v-show="tab === 'form'" class="card stack gap-3">
        <div class="field">
          <span class="label">Looks</span>
          <div class="chips">
            <button
              v-for="l in KWAMI_LOOKS"
              :key="l.id"
              type="button"
              class="chip"
              :class="{ 'chip--on': form.lookId === l.id }"
              @click="chooseLook(l.id)"
            >
              {{ l.label }}
            </button>
          </div>
          <span class="hint">Body, palette and motion together — the combinations worth starting from.</span>
        </div>

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

        <details class="tune">
          <summary>
            Fine tune
            <span v-if="tuningCount" class="num dim">{{ tuningCount }} changed</span>
          </summary>
          <div class="stack gap-3 tune__body">
            <p class="hint">
              The five bodies are presets over one shader, so these are the real controls. Anything you do not
              touch keeps whatever the body says.
            </p>
            <div class="tune__grid">
              <div v-for="(range, key) in TUNING_RANGES" :key="key" class="field">
                <label class="label tune__head" :for="`tune-${key}`">
                  <span>{{ key }}</span>
                  <span class="num" :class="{ dim: form.tuning[key] === undefined }">
                    {{ form.tuning[key] ?? 'preset' }}
                  </span>
                </label>
                <input
                  :id="`tune-${key}`"
                  type="range"
                  :min="range.min"
                  :max="range.max"
                  :step="range.step"
                  :value="form.tuning[key] ?? range.min"
                  @input="setTuning(key, Number(($event.target as HTMLInputElement).value))"
                />
              </div>
            </div>
            <button v-if="tuningCount" type="button" class="btn btn--sm btn--ghost" @click="clearTuning">
              Back to the preset
            </button>
          </div>
        </details>
      </div>

      <!-- Voice -->
      <div v-show="tab === 'voice'" class="card stack gap-3">
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
      </div>

      <!-- Secret -->
      <div v-show="tab === 'secret'" class="card stack gap-3">
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
            who genuinely says it will not lose on a technicality. It is never saved in your browser.
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
      </div>

      <!-- Economics -->
      <div v-show="tab === 'economics'" class="card stack gap-3">
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
            <span
              ><span class="num success">{{ split.vault }}%</span> <span class="dim">pot</span></span
            >
            <span
              ><span class="num">{{ split.protocol }}%</span> <span class="dim">protocol</span></span
            >
            <span
              ><span class="num">{{ split.author }}%</span> <span class="dim">you, forever</span></span
            >
          </div>
        </div>

        <hr class="divider" />

        <div class="field">
          <label class="label" for="fuel">
            Fuel <span class="num gold">{{ form.fuelSol }} SOL</span>
            <span class="dim">→ {{ fuelEnergy.toLocaleString() }} energy</span>
          </label>
          <input id="fuel" v-model.number="form.fuelSol" type="range" min="0" max="2" step="0.05" />
          <span class="hint">
            Energy is what it costs your Kwami to answer — the model calls and the speech. It is entirely
            separate from the pot, which is escrow and can never be spent on running costs. Run out and it
            stops selling tickets until you top it up; nothing is lost, and it comes straight back.
          </span>
          <p v-if="!treasuryConfigured" class="hint dim">
            No platform treasury is configured, so no fuel is charged and none is bought. See
            <NuxtLink to="/docs/setup" class="gold">setup</NuxtLink>.
          </p>
        </div>
      </div>

      <!-- ── Mint ──────────────────────────────────────────────────────── -->
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
          <div class="costs">
            <div v-if="commissionCharged">
              <span class="dim">Platform fee</span><span class="num">{{ commissionSol }} SOL</span>
            </div>
            <div v-if="fuelLamports > 0n">
              <span class="dim">Fuel · {{ fuelEnergy.toLocaleString() }} energy</span
              ><span class="num">{{ form.fuelSol }} SOL</span>
            </div>
            <div>
              <span class="dim">Mint, metadata, vault rent</span><span class="num dim">~0.004 SOL</span>
            </div>
            <div class="costs__total">
              <span>Due on approval</span><span class="num gold">~{{ dueSol.toFixed(3) }} SOL</span>
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
    </section>
  </div>
</template>

<style scoped>
.studio {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 460px;
  gap: 28px;
  align-items: start;
}

.studio__left {
  position: sticky;
  top: calc(var(--header-h) + 20px);
}

/* ── The stage ─────────────────────────────────────────────────────────── */

.stage {
  position: relative;
  height: min(52vh, 460px);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--border);
  background:
    radial-gradient(circle at 50% 55%, rgba(255, 255, 255, 0.05), transparent 70%), var(--bg-sunken);
}

.stage__top {
  position: absolute;
  inset: 14px 14px auto 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  pointer-events: none;
}

.stage__name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  font-size: 0.9rem;
}

.stage__name span {
  font-size: 0.8rem;
}

.stage__dice {
  pointer-events: auto;
  flex: none;
  font-size: 1rem;
  line-height: 1;
  padding: 7px 10px;
}

.stage__facts {
  position: absolute;
  right: 16px;
  bottom: 78px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: rgba(4, 5, 10, 0.6);
  border: 1px solid var(--border);
  backdrop-filter: blur(10px);
  font-size: 0.78rem;
  pointer-events: none;
}

.stage__facts > div {
  display: flex;
  justify-content: space-between;
  gap: 14px;
}

.stage__facts dt {
  color: var(--fg-dim);
}

.stage__facts dd {
  margin: 0;
}

.stage__meter {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 14px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: rgba(4, 5, 10, 0.72);
  border: 1px solid var(--border);
  backdrop-filter: blur(10px);
}

.stage__src {
  font-size: 0.74rem;
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--bg-sunken);
}

.tab {
  flex: 1;
  padding: 7px 12px;
  border: none;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 0.84rem;
  transition: all 0.15s ease;
}

.tab:hover {
  color: var(--fg);
}

.tab--on {
  background: var(--accent-soft);
  color: var(--fg);
}

/* ── Controls ──────────────────────────────────────────────────────────── */

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

.tune {
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-sunken);
  padding: 11px 13px;
}

.tune summary {
  cursor: pointer;
  font-size: 0.85rem;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.tune__body {
  padding-top: 12px;
}

.tune__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px 20px;
}

.tune__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  text-transform: capitalize;
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

input[type='range'] {
  accent-color: var(--accent);
  width: 100%;
}

@media (max-width: 1080px) {
  .studio {
    grid-template-columns: 1fr;
  }
  .studio__left {
    position: static;
  }
  .modes {
    grid-template-columns: 1fr;
  }
}
</style>
