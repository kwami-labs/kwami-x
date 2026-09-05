/**
 * The wire format between the codegen route and the browser.
 *
 * Generating an Anchor program takes a minute or more, most of which the model
 * spends reasoning before it emits a single line of Rust. A route that answers
 * with the finished source shows the owner a spinner for that whole minute, and
 * a spinner is indistinguishable from a hang — so the route streams, and this
 * module is the vocabulary both ends speak.
 *
 * Newline-delimited JSON, one record per line. NDJSON rather than
 * `text/event-stream` because the payload is Rust source with blank lines in it:
 * SSE frames are delimited by a blank line, so every empty line in a generated
 * program would have to be escaped or would silently split a frame. JSON escapes
 * newlines for free, and a record can therefore never be mistaken for the
 * boundary between two records.
 *
 * DOM-free and SDK-free, so the Nitro route and the browser transport share one
 * definition rather than two that drift.
 */

/** What the builder is doing right now, for the live status line. */
export type CodegenPhase = 'idle' | 'thinking' | 'writing' | 'checking' | 'done' | 'error'

export type CodegenEvent =
  /** A phase transition. Drives the status line, nothing else. */
  | { t: 'phase'; phase: CodegenPhase }
  /**
   * A chunk of the model's summarised reasoning.
   *
   * Rendered as a live account of what it is working out. This is the whole
   * reason the route streams: without it the first forty seconds of a
   * generation produce no output at all.
   */
  | { t: 'thinking'; d: string }
  /** A chunk of generated Rust, appended to whatever has arrived so far. */
  | { t: 'source'; d: string }
  /**
   * The finished program.
   *
   * Sent as a whole rather than left as the concatenation of the deltas, so a
   * client that dropped a chunk converges on the right source instead of
   * persisting a program with a hole in it.
   */
  | { t: 'result'; id: string; source: string; rules: string[] }
  /**
   * A terminal failure that happened *after* the response headers went out.
   *
   * A streaming route answers 200 the moment it opens the stream, so from then
   * on an upstream failure has no status code left to travel in. Without this
   * record the browser cannot tell "the model finished" from "the connection
   * died before it said anything" — and the difference decides whether the
   * owner should retry.
   */
  | { t: 'error'; message: string }
  /** The stream reached its natural end. Always last on a successful run. */
  | { t: 'done' }

/** Serialise one event as a line. */
export function encodeEvent(event: CodegenEvent): string {
  return `${JSON.stringify(event)}\n`
}

/**
 * Split a growing buffer into whole events, returning the unparsed remainder.
 *
 * The caller keeps the remainder and passes it back with the next chunk: a
 * network read can land mid-record, and parsing a half-line throws away
 * everything after the split point.
 */
export function decodeEvents(buffer: string): { events: CodegenEvent[]; rest: string } {
  const lines = buffer.split('\n')
  // The trailing element is whatever followed the last newline — an empty
  // string when the buffer ended cleanly, a partial record otherwise.
  const rest = lines.pop() ?? ''
  const events: CodegenEvent[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed) as CodegenEvent)
    } catch {
      // A malformed line is a bug on the writing end, not a reason to abandon
      // a generation the user has already waited a minute for.
    }
  }

  return { events, rest }
}

/**
 * Strip the markdown fence a model wraps code in when asked not to.
 *
 * Belt and braces: the prompt says to return bare Rust, and models mostly
 * comply. "Mostly" is not good enough for a value that gets written to the
 * database and later handed to `anchor build`, where the fence is a syntax
 * error in the first line.
 */
export function stripCodeFence(source: string): string {
  return source
    .replace(/^\s*```(?:rust)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()
}
