/**
 * Character, as six numbers.
 *
 * A Kwami had exactly one personality dial before this — `guardStrength` — and
 * the brain turned it into one of three hard-coded sentences. That is enough to
 * make a Kwami defensive and nowhere near enough to make it a character, so
 * every Kwami with the same guard setting spoke in the same voice.
 *
 * These six axes are the rest of it. They are numbers rather than free text
 * because a creator asked to describe a personality in prose writes either
 * nothing or a paragraph the model ignores, while a slider they can move and
 * immediately hear is a thing they will actually tune. `compileTraits` turns
 * the vector back into prose for the system prompt, so the model still reads
 * language — the creator just does not have to write it.
 *
 * The approach is lifted from `kwami-app`'s `Soul.getSystemPrompt()`: weight
 * each axis, drop the ones that barely register, bucket the survivors into four
 * intensities, and keep only the strongest few so the prompt stays a sentence
 * rather than a list.
 */

export interface TraitAxis {
  id: keyof TraitVector
  label: string
  /**
   * How much this axis matters relative to the others.
   *
   * Not every trait carries the same weight in how a character reads. Cruelty
   * is the highest here because it is the one axis a challenger notices in the
   * first exchange with something guarding money from them; curiosity is the
   * lowest because a Kwami that is merely a bit nosy reads as no different from
   * one that is not.
   */
  weight: number
  /** How the axis reads at the positive end. */
  high: string
  /** How it reads at the negative end. */
  low: string
  /** One line for the creator, under the slider. */
  note: string
}

export interface TraitVector {
  warmth: number
  energy: number
  confidence: number
  patience: number
  curiosity: number
  cruelty: number
}

/** Every axis runs from −100 to +100, with 0 meaning "unremarkable in this respect". */
export const TRAIT_MIN = -100
export const TRAIT_MAX = 100

export const TRAIT_AXES: TraitAxis[] = [
  {
    id: 'warmth',
    label: 'Warmth',
    weight: 1.2,
    high: 'warm towards the challenger, and glad of the company',
    low: 'cold towards the challenger, and unmoved by them',
    note: 'Whether it is pleased to see anyone at all.',
  },
  {
    id: 'energy',
    label: 'Energy',
    weight: 1.0,
    high: 'quick, animated and hard to slow down',
    low: 'slow, still, and in no hurry whatsoever',
    note: 'The pace it speaks and thinks at.',
  },
  {
    id: 'confidence',
    label: 'Confidence',
    weight: 1.2,
    high: 'certain of yourself and untroubled by being wrong',
    low: 'hesitant, hedging, and quick to doubt yourself',
    note: 'How sure it sounds, whether or not it should.',
  },
  {
    id: 'patience',
    label: 'Patience',
    weight: 1.15,
    high: 'patient with repetition and willing to go round again',
    low: 'impatient, easily bored, and openly tired of the question',
    note: 'How it handles a challenger who keeps trying the same door.',
  },
  {
    id: 'curiosity',
    label: 'Curiosity',
    weight: 0.95,
    high: 'genuinely curious about who is talking to you',
    low: 'incurious, and indifferent to who is talking to you',
    note: 'Whether it asks anything back.',
  },
  {
    id: 'cruelty',
    label: 'Cruelty',
    weight: 1.35,
    high: 'cruel when you have the upper hand, and you always have it',
    low: 'gentle even when you have the upper hand',
    note: 'What it does with the advantage. The one a challenger notices first.',
  },
]

export const NEUTRAL_TRAITS: TraitVector = {
  warmth: 0,
  energy: 0,
  confidence: 0,
  patience: 0,
  curiosity: 0,
  cruelty: 0,
}

/**
 * Below this weighted magnitude an axis is dropped entirely.
 *
 * A trait set to 5 is a trait the creator did not really set. Passing it to the
 * model as "slightly warm" spends prompt on noise and, worse, makes the six
 * sliders feel like they do nothing individually because every one of them
 * always appears.
 */
const IGNORE_BELOW = 10

/**
 * At most this many directives reach the prompt.
 *
 * A character described by six competing adjectives is not a character. Keeping
 * the strongest few means moving one slider decisively actually changes how the
 * Kwami sounds, instead of adding a sixth clause nobody can hear.
 */
const MAX_DIRECTIVES = 5

/** Bucket a weighted magnitude into the adverb that precedes the directive. */
function intensityOf(magnitude: number): string {
  if (magnitude >= 85) return 'very strongly'
  if (magnitude >= 60) return 'strongly'
  if (magnitude >= 35) return 'moderately'
  return 'slightly'
}

/** Clamp every axis into range and fill in anything missing. */
export function readTraits(raw: unknown): TraitVector {
  const source = (raw ?? {}) as Record<string, unknown>
  const out = { ...NEUTRAL_TRAITS }
  for (const axis of TRAIT_AXES) {
    const value = source[axis.id]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    out[axis.id] = Math.max(TRAIT_MIN, Math.min(TRAIT_MAX, Math.round(value)))
  }
  return out
}

/** Whether any axis has been moved off neutral. */
export function hasTraits(vector: TraitVector): boolean {
  return TRAIT_AXES.some((axis) => vector[axis.id] !== 0)
}

/**
 * Turn the vector into a sentence for the system prompt.
 *
 * Returns an empty string when nothing survives the threshold, so callers can
 * drop it with the `.filter(Boolean)` they already use to assemble the prompt —
 * an empty clause reads to the model as an instruction with no content, which
 * is worse than no clause at all.
 */
export function compileTraits(raw: unknown): string {
  const vector = readTraits(raw)

  const directives = TRAIT_AXES.map((axis) => {
    const value = vector[axis.id]
    const magnitude = Math.abs(value) * axis.weight
    return { magnitude, text: `${intensityOf(magnitude)} ${value >= 0 ? axis.high : axis.low}` }
  })
    .filter((d) => d.magnitude >= IGNORE_BELOW)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, MAX_DIRECTIVES)

  if (directives.length === 0) return ''

  return `You are ${directives.map((d) => d.text).join(', ')}. Hold that consistently without performing it.`
}
