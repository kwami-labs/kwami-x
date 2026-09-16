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
  isHexColor,
  suggestPalette,
  toAppearance,
  type KwamiTuning,
} from '#shared/kwami/appearance'
import { DEFAULT_SKIN, tuningForSkin } from '#shared/kwami/skins'
import type { FormPatch, KwamiFormState } from '#shared/kwami/form'
import { DEFAULT_VOICE_CONFIG, KWAMI_GAMES, KWAMI_VOICES } from '#shared/kwami/voice'
import { NEUTRAL_TRAITS, type TraitVector } from '#shared/kwami/traits'
import { randomKwami } from '#shared/kwami/random'
import type { KwamiPersona } from '#shared/kwami/personas'
import { energyFromLamports, toEnergy } from '#shared/energy/cost'
import type { KwamiRenderer, KwamiSkin, ResolutionMode } from '#shared/types/kwami'

definePageMeta({ title: 'Mint a Kwami' })

const wallet = useWalletStore()
const auth = useAuthStore()
const config = useRuntimeConfig()
const { phase, busy, error, mint, mintAddress } = useMintKwami()
const studio = useStudioPreview()

/**
 * The build, as one continuous scroll rather than five tabs.
 *
 * Tabs hid four fifths of the decisions behind a click, which is why creators
 * minted Kwamis with a default voice and an untouched payout: a control you
 * never scroll past is a control you never consider. One column that runs top
 * to bottom past a Kwami that never leaves the screen makes the whole shape of
 * the thing visible, and every change lands on a model you are already looking
 * at.
 */
const STEPS = [
  { id: 'identity', label: 'Identity', note: 'Who it is' },
  { id: 'form', label: 'Form', note: 'What it looks like' },
  { id: 'voice', label: 'Voice', note: 'How it plays' },
  { id: 'secret', label: 'Secret', note: 'What it guards' },
  { id: 'rehearse', label: 'Rehearse', note: 'Hear it first' },
  { id: 'economics', label: 'Economics', note: 'What it earns' },
  { id: 'mint', label: 'Mint', note: 'Write it to the chain' },
] as const
type StepId = (typeof STEPS)[number]['id']

const activeStep = ref<StepId>('identity')
const panel = useTemplateRef<HTMLElement>('panel')

function goTo(id: StepId) {
  // A scoped stylesheet cannot reach `html`, so the reduced-motion check lives
  // here rather than in a `scroll-behavior` rule that would never apply.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document
    .getElementById(`step-${id}`)
    ?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
}

const form = reactive({
  name: '',
  tagline: '',
  persona: '',
  personaId: null as string | null,
  traits: { ...NEUTRAL_TRAITS } as TraitVector,
  renderer: 'blob-xyz' as KwamiRenderer,
  skin: DEFAULT_SKIN as KwamiSkin,
  colorA: KWAMI_PALETTES[0]!.a,
  colorB: KWAMI_PALETTES[0]!.b,
  colorC: KWAMI_PALETTES[0]!.c,
  /** null once the creator picks colours by hand rather than by preset. */
  paletteId: KWAMI_PALETTES[0]!.id as string | null,
  lookId: null as string | null,
  /** The colour relationship last rolled, so the button can re-roll the same one. */
  harmonyId: null as string | null,
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
    form.colorC = suggestion.c
    form.paletteId = suggestion.id
  },
)

/**
 * What the Form section edits, as it wants it.
 *
 * A projection rather than a second copy: `form` also carries the phrase, the
 * economics and the voice, none of which the appearance panel has any business
 * seeing, and handing it the whole object would let a bug in a colour picker
 * write to the ticket price.
 */
const formState = computed<KwamiFormState>(() => ({
  renderer: form.renderer,
  skin: form.skin,
  colorA: form.colorA,
  colorB: form.colorB,
  colorC: form.colorC,
  paletteId: form.paletteId,
  lookId: form.lookId,
  harmonyId: form.harmonyId,
  tuning: form.tuning,
}))

function applyForm(patch: FormPatch) {
  // Any patch that carries a colour is the creator making a colour decision,
  // which is what stops the name watcher above from overwriting it later.
  if (patch.colorA || patch.paletteId !== undefined || patch.harmonyId) touchedPalette.value = true
  Object.assign(form, patch)
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
  form.skin = rolled.skin
  form.colorA = rolled.colorA
  form.colorB = rolled.colorB
  form.colorC = rolled.colorC
  form.paletteId = rolled.paletteId
  form.harmonyId = null
  form.lookId = rolled.look.id
  form.tuning = { ...tuningForSkin(rolled.skin), ...rolled.look.tuning }
  form.persona = rolled.persona.persona
  form.personaId = rolled.persona.id
  form.traits = rolled.traits
  form.voiceId = rolled.voiceId
  form.gameId = rolled.gameId
}

const paletteValid = computed(
  () => isHexColor(form.colorA) && isHexColor(form.colorB) && isHexColor(form.colorC),
)
const palette = computed(() =>
  paletteValid.value
    ? { a: form.colorA, b: form.colorB, c: form.colorC }
    : { a: KWAMI_PALETTES[0]!.a, b: KWAMI_PALETTES[0]!.b, c: KWAMI_PALETTES[0]!.c },
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
 *
 * It only means that once a rehearsal has actually spent something, though.
 * `/api/studio/energy` answers 0 for anyone who has not signed in, and reading
 * that as vitality showed every first-time visitor a grey deflated lump and
 * called it their Kwami — the shader working exactly as written, on a number
 * that was never about this Kwami. A draft nobody has run yet is alive.
 */
const stageVitality = computed(() => {
  const balance = studio.balance.value
  if (balance === null || studio.source.value === null) return 1
  if (balance <= 0n) return 0.12
  const full = 40_000n
  const capped = balance > full ? full : balance
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
    name: form.name.trim(),
    persona: form.persona.trim(),
    gameId: form.gameId,
    guardStrength: form.guardStrength,
    traits: form.traits,
    secret: form.secret,
    // Only the voice path reads these; `/api/studio/preview` ignores the extra
    // keys. The worker needs to know which voice to speak in, and the studio is
    // the one place that choice exists without a row to read it from.
    voiceId: form.voiceId,
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
 * How far down the build we are, in [0, 1].
 *
 * One number, published to CSS as `--p`, which every parallax layer reads. A
 * transform per layer written from JavaScript would put five style writes on
 * the scroll path for an effect the compositor can do on its own; this puts
 * one custom property on the container and lets CSS multiply it out.
 *
 * `useWindowScroll` rather than `useElementBounding`, which also reports a
 * scroll-relative `top` and looked like it would do the job in one call: its
 * recalculation never fired here, so `--p` sat at whatever it had been at the
 * first measurement and the parallax was a still image. The scroll position is
 * what this actually depends on, and asking for it directly is both shorter and
 * the thing that works.
 */
const { y: scrollY } = useWindowScroll()
const { height: viewportH } = useWindowSize()
/** Read off the document rather than the panel: the header and footer scroll too. */
const documentH = ref(0)
useResizeObserver(panel, () => {
  documentH.value = document.documentElement.scrollHeight
})
const scrolled = computed(() => {
  const travel = documentH.value - viewportH.value
  if (travel < 40) return 0
  return Math.min(1, Math.max(0, scrollY.value / travel))
})

/**
 * Which step the creator is reading, and the reveal as each one arrives.
 *
 * Two observers rather than one: the rail wants the section crossing the middle
 * of the screen, the reveal wants the first pixel of any section, and a single
 * `rootMargin` cannot mean both without the rail lighting up a step that is
 * still off the bottom of the screen.
 */
let spy: IntersectionObserver | null = null
let reveal: IntersectionObserver | null = null
/**
 * Only hide the steps once there is something running that can show them again.
 * Server-rendered markup with `opacity: 0` and no hydration is a blank page.
 */
const revealArmed = ref(false)

onMounted(() => {
  void studio.loadBalance()
  revealArmed.value = true
  const sections = Array.from(panel.value?.querySelectorAll<HTMLElement>('[data-step]') ?? [])

  spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activeStep.value = entry.target.getAttribute('data-step') as StepId
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  )
  reveal = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('step--in')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  )
  for (const section of sections) {
    spy.observe(section)
    reveal.observe(section)
  }
})

onBeforeUnmount(() => {
  spy?.disconnect()
  reveal?.disconnect()
})

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
    appearance: toAppearance(palette.value, form.tuning, form.skin) as Record<string, string>,
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
  <div class="wrap studio" :style="{ '--accent': palette.a, '--p': scrolled }">
    <!--
      The page retints itself to the Kwami being built. One inline custom property;
      everything downstream is `color-mix` off it, so a palette click repaints the
      rail, the focus rings and the primary button without a second stylesheet.
    -->
    <!-- ── The Kwami itself. Fixed; the build scrolls past it. ─────────────── -->
    <aside class="stage">
      <div class="stage__aura" aria-hidden="true" />
      <div class="stage__ring stage__ring--far" aria-hidden="true" />
      <div class="stage__ring stage__ring--near" aria-hidden="true" />

      <div class="stage__avatar">
        <KwamiAvatar
          :renderer="form.renderer"
          :skin="form.skin"
          :color-a="palette.a"
          :color-b="palette.b"
          :color-c="palette.c"
          :vitality="stageVitality"
          :arousal="stageArousal"
          :activity="studio.activity.value"
          :tuning="form.tuning"
        />
      </div>

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
    </aside>

    <!-- ── The build ──────────────────────────────────────────────────────── -->
    <div ref="panel" class="build stack gap-3" :class="{ 'build--reveal': revealArmed }">
      <header class="build__intro stack gap-1">
        <span class="eyebrow">Build</span>
        <h1>Hide a phrase. Let people pay to find it.</h1>
        <p class="muted">
          Everything below is written to the chain once and can never be changed — not by you, not by us. Talk
          to it first.
        </p>
      </header>

      <nav class="rail" aria-label="Build steps">
        <div class="rail__track">
          <button
            v-for="s in STEPS"
            :key="s.id"
            type="button"
            class="rail__step"
            :class="{ 'rail__step--on': activeStep === s.id }"
            :aria-current="activeStep === s.id ? 'step' : undefined"
            :title="s.note"
            @click="goTo(s.id)"
          >
            {{ s.label }}
          </button>
        </div>
        <div class="rail__bar"><span class="rail__fill" /></div>
      </nav>

      <!-- Identity -->
      <section id="step-identity" data-step="identity" class="step">
        <div class="step__head">
          <span class="step__num">01</span>
          <div>
            <h2>Identity</h2>
            <span class="hint">Who it is</span>
          </div>
        </div>
        <div class="card stack gap-3">
          <div class="field">
            <label class="label" for="name">Name</label>
            <input
              id="name"
              v-model="form.name"
              class="input"
              placeholder="The Vault Keeper"
              maxlength="48"
            />
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
      </section>

      <!-- Form -->
      <section id="step-form" data-step="form" class="step">
        <div class="step__head">
          <span class="step__num">02</span>
          <div>
            <h2>Form</h2>
            <span class="hint">What it looks like — every change lands on the Kwami to your left</span>
          </div>
        </div>
        <div class="card stack gap-3">
          <KwamiForm :state="formState" @patch="applyForm" />
        </div>
      </section>

      <!-- Voice -->
      <section id="step-voice" data-step="voice" class="step">
        <div class="step__head">
          <span class="step__num">03</span>
          <div>
            <h2>Voice</h2>
            <span class="hint">How it plays</span>
          </div>
        </div>
        <div class="card stack gap-3">
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
              Low, and it chats and slips. High, and it stonewalls. A Kwami nobody can move sells one ticket;
              a Kwami that gives ground sells many and eventually loses its pot.
            </span>
          </div>
        </div>
      </section>

      <!-- Secret -->
      <section id="step-secret" data-step="secret" class="step">
        <div class="step__head">
          <span class="step__num">04</span>
          <div>
            <h2>Secret</h2>
            <span class="hint">What it guards</span>
          </div>
        </div>
        <div class="card stack gap-3">
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
              Matching ignores case, accents and punctuation, and forgives one transcription slip — a
              challenger who genuinely says it will not lose on a technicality. It is never saved in your
              browser.
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
      </section>

      <!-- Rehearse -->
      <section id="step-rehearse" data-step="rehearse" class="step">
        <div class="step__head">
          <span class="step__num">05</span>
          <div>
            <h2>Rehearse</h2>
            <span class="hint">Hear it before it is permanent</span>
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
            :draft-config="testDraft"
            @say="studio.say($event, testDraft())"
            @turn="studio.pushTurn"
            @exhausted="studio.markExhausted"
            @balance="studio.noteBalance"
            @reset="studio.reset()"
            @fuel="goTo('economics')"
          />
        </div>
      </section>

      <!-- Economics -->
      <section id="step-economics" data-step="economics" class="step">
        <div class="step__head">
          <span class="step__num">06</span>
          <div>
            <h2>Economics</h2>
            <span class="hint">What it earns, and what it costs to run</span>
          </div>
        </div>
        <div class="card stack gap-3">
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
      </section>

      <!-- Mint -->
      <section id="step-mint" data-step="mint" class="step">
        <div class="step__head">
          <span class="step__num">07</span>
          <div>
            <h2>Mint</h2>
            <span class="hint">One transaction, and none of it can be edited afterwards</span>
          </div>
        </div>
        <div class="card">
          <div v-if="!auth.isSignedIn" class="stack gap-2">
            <p class="muted">Sign in first, so the Kwami you mint is attached to your account.</p>
            <NuxtLink to="/auth?next=/mint" class="btn btn--primary">Sign in</NuxtLink>
          </div>
          <div v-else-if="!wallet.isConnected" class="stack gap-2">
            <p class="muted">
              Connect Phantom to mint. The transaction creates the NFT and its vault in one go.
            </p>
            <ConnectWallet />
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
  </div>
</template>

<style scoped>
.studio {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 470px;
  gap: 36px;
  align-items: start;

  /* Retint from the Kwami's own core colour, so one bound property repaints the
     rail, the focus rings and the primary button. */
  --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent);
  --accent-line: color-mix(in srgb, var(--accent) 42%, transparent);
}

/* ── The stage: fixed while the build scrolls past ─────────────────────── */

.stage {
  position: sticky;
  top: calc(var(--header-h) + 20px);
  height: calc(100dvh - var(--header-h) - 44px);
  min-height: 420px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-sunken);
  isolation: isolate;
}

/*
  Parallax, as three planes at three speeds.

  Each layer reads the same `--p` and moves by a different amount, which is what
  gives a sticky element depth: the Kwami holds near the centre while the light
  behind it climbs and the rings fall, so the stage reads as a window into
  something rather than a panel that happens not to scroll.
*/
.stage__aura,
.stage__ring,
.stage__avatar {
  will-change: transform;
}

.stage__aura {
  position: absolute;
  inset: -25% -10%;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(closest-side, color-mix(in srgb, var(--accent) 30%, transparent), transparent 72%),
    radial-gradient(closest-side at 70% 65%, rgba(255, 255, 255, 0.05), transparent 70%);
  opacity: 0.85;
}

.stage__ring {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 0;
  pointer-events: none;
  border-radius: 50%;
  border: 1px solid var(--border);
  translate: -50% -50%;
}

.stage__ring--far {
  width: 128%;
  aspect-ratio: 1;
  border-color: color-mix(in srgb, var(--accent) 18%, transparent);
}

.stage__ring--near {
  width: 74%;
  aspect-ratio: 1;
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.07);
}

.stage__avatar {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.stage__top {
  position: absolute;
  z-index: 2;
  inset: 16px 16px auto 18px;
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
  z-index: 2;
  right: 18px;
  bottom: 86px;
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
  z-index: 2;
  left: 18px;
  right: 18px;
  bottom: 16px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: rgba(4, 5, 10, 0.72);
  border: 1px solid var(--border);
  backdrop-filter: blur(10px);
}

.stage__src {
  font-size: 0.74rem;
}

/*
  Motion is opt-in.

  The reveal and the parallax are both defined only here rather than being
  disabled by the global reduce-motion rule, because that rule shortens
  transitions and cannot unset a transform bound to a scroll position.
*/
@media (prefers-reduced-motion: no-preference) {
  .stage__aura {
    transform: translate3d(0, calc(var(--p) * -72px), 0) scale(calc(1 + var(--p) * 0.28));
    opacity: calc(0.85 - var(--p) * 0.28);
  }

  .stage__ring--far {
    transform: translate3d(0, calc(var(--p) * 96px), 0) rotate(calc(var(--p) * 26deg));
  }

  .stage__ring--near {
    transform: translate3d(0, calc(var(--p) * 52px), 0) rotate(calc(var(--p) * -40deg));
  }

  .stage__avatar {
    transform: translate3d(0, calc(var(--p) * -26px), 0) scale(calc(1 - var(--p) * 0.04));
  }

  .stage__top {
    transform: translate3d(0, calc(var(--p) * -16px), 0);
  }

  .stage__facts {
    transform: translate3d(0, calc(var(--p) * 22px), 0);
  }

  .build--reveal .step {
    opacity: 0;
    transform: translate3d(0, 26px, 0);
    transition:
      opacity 0.5s ease,
      transform 0.5s cubic-bezier(0.2, 0.8, 0.25, 1);
  }

  .build--reveal .step--in {
    opacity: 1;
    transform: none;
  }
}

/* ── The build column ──────────────────────────────────────────────────── */

.build {
  min-width: 0;
}

.build__intro {
  padding-bottom: 4px;
}

.step {
  scroll-margin-top: calc(var(--header-h) + 78px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  /* Enough that a step reaches the middle of the screen before the next one
     arrives — otherwise the rail flickers between two steps on one flick. */
  padding-block: 26px;
}

.step__head {
  display: flex;
  align-items: baseline;
  gap: 14px;
}

.step__num {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  color: var(--accent);
  padding-top: 4px;
}

.step__head h2 {
  font-size: 1.35rem;
}

/* ── The rail ──────────────────────────────────────────────────────────── */

.rail {
  position: sticky;
  /* Flush under the site header. An eight-pixel gap here is a letterbox that
     section headings slide through on their way past, which reads as the rail
     failing to cover them rather than as breathing room. */
  top: var(--header-h);
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 5px 5px 7px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: rgba(7, 8, 12, 0.78);
  backdrop-filter: blur(18px) saturate(140%);
}

.rail__track {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.rail__track::-webkit-scrollbar {
  display: none;
}

.rail__step {
  flex: 1 0 auto;
  padding: 6px 11px;
  border: none;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 0.82rem;
  white-space: nowrap;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.rail__step:hover {
  color: var(--fg);
}

.rail__step--on {
  background: var(--accent-soft);
  color: var(--fg);
}

.rail__bar {
  height: 2px;
  margin-inline: 6px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
}

.rail__fill {
  display: block;
  height: 100%;
  width: calc(var(--p) * 100%);
  border-radius: inherit;
  background: var(--accent);
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

input[type='range'] {
  accent-color: var(--accent);
  width: 100%;
}

/* ── Narrow: the Kwami stays on screen, smaller, above the build ────────── */

@media (max-width: 1080px) {
  .studio {
    grid-template-columns: 1fr;
    gap: 20px;
  }

  /* Two sticky elements competing for the top of a phone screen leaves room
     for neither. The stage scrolls away and the rail stays, because the rail is
     the only way back up a page this long. */
  .stage {
    position: static;
    height: 46vh;
    min-height: 300px;
  }

  .modes {
    grid-template-columns: 1fr;
  }

  .step {
    padding-block: 18px;
  }
}
</style>
