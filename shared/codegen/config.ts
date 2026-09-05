/**
 * The codegen contract: the request shape and the model allow-list.
 *
 * One DOM-free, SDK-free module so the browser transport and the Nitro route
 * agree on the cost-sensitive parameters. Split across the two, they drift — and
 * the way that drift shows up is a request the API rejects with a 400 the user
 * reads as "the builder is broken".
 *
 * Modelled on the same split nexow uses for its widget codegen: a contract
 * module both ends import, a route that owns the key, and a client that owns
 * the rendering.
 */

/** Token cap for one program generation. Anchor programs are long. */
export const CODEGEN_MAX_TOKENS = 16_000

/**
 * The models a generation may run on.
 *
 * An allow-list rather than a passthrough: the model id arrives in a request
 * body, and without this a caller could pin an arbitrary — or arbitrarily
 * expensive — model against the deployment's own API key.
 */
export const CODEGEN_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const

export type CodegenModel = (typeof CODEGEN_MODELS)[number]

export const DEFAULT_CODEGEN_MODEL: CodegenModel = 'claude-sonnet-5'

export function isCodegenModel(model: string): model is CodegenModel {
  return (CODEGEN_MODELS as readonly string[]).includes(model)
}

export function resolveCodegenModel(model: string | undefined): CodegenModel {
  return model && isCodegenModel(model) ? model : DEFAULT_CODEGEN_MODEL
}

/**
 * Models that predate adaptive thinking and reject `output_config.effort`
 * outright — a hard 400, not a silent downgrade. Unknown ids are assumed to be
 * current-generation, which is the safe default as the lineup moves forward.
 */
const PRE_ADAPTIVE_MODELS = new Set<string>(['claude-haiku-4-5'])

export function isAdaptiveModel(model: string): boolean {
  return !PRE_ADAPTIVE_MODELS.has(model)
}

/** Thinking budget for the pre-adaptive models, which need an explicit count. */
export const CODEGEN_THINKING_BUDGET = 6_000

export type ThinkingConfig =
  { type: 'adaptive'; display: 'summarized' } | { type: 'enabled'; budget_tokens: number }

/**
 * The canonical `thinking` config for a model.
 *
 * `display: 'summarized'` is deliberate. The adaptive models default to
 * 'omitted', which streams *empty* thinking blocks — so the model can reason for
 * thirty seconds with nothing to show, and the builder looks frozen. Summarised
 * reasoning is what lets the UI render a live account of what it is working out.
 *
 * The pre-adaptive models take the fixed-budget form instead and have no
 * `display` field; they stream their reasoning in full, which the same feed
 * renders fine.
 */
export function normalizeThinking(enabled: boolean, model: string): ThinkingConfig | undefined {
  if (!enabled) return undefined
  if (!isAdaptiveModel(model)) return { type: 'enabled', budget_tokens: CODEGEN_THINKING_BUDGET }
  return { type: 'adaptive', display: 'summarized' }
}

/**
 * The smallest output budget worth starting a turn with.
 *
 * With thinking on, the turn has to afford the reasoning *and* an answer: the
 * fixed-budget models 400 outright when `max_tokens` lands at or under
 * `budget_tokens`, and the adaptive ones burn a small cap entirely on thinking
 * and emit nothing — a request that succeeds, costs money, and returns an empty
 * program.
 */
export function minOutputTokens(model: string, thinkingOn: boolean): number {
  if (!thinkingOn) return 512
  const budget = isAdaptiveModel(model) ? 0 : CODEGEN_THINKING_BUDGET
  return Math.max(1024, budget + 256)
}

/** How long a generation may run before the route gives up on it. */
export const CODEGEN_TIMEOUT_MS = 180_000

/**
 * How long the client waits for the *first* byte before deciding the stream is
 * dead.
 *
 * Separate from the overall timeout because the two failures look nothing alike:
 * a stream that never opens is a broken deployment, and a stream that opens and
 * then stalls is a model taking its time. Conflating them means either a
 * three-minute wait on a misconfigured key, or a generation killed mid-thought.
 */
export const STREAM_OPEN_TIMEOUT_MS = 30_000
