import { ref, watch, onBeforeUnmount } from 'vue'
import type { Room, RemoteTrack, RemoteParticipant } from 'livekit-client'
import { VOICE_TICK_SECONDS } from '#shared/energy/constants'
import {
  agentConfigMessage,
  agentSoulUpdate,
  agentVoiceUpdate,
  type KwamiAgentDraft,
} from '#shared/kwami/agent-config'
import { createAudioMeter, type AudioMeter } from '~/utils/audio-meter'

/**
 * The metered LiveKit voice path.
 *
 * The upgrade over `useSpeech`: a worker joins the room, runs streaming
 * recognition and synthesis, and speaks as the Kwami — instead of the browser
 * transcribing, an HTTP round trip generating, and `speechSynthesis` reading
 * the answer back. Better conversation, and unlike the browser path it costs
 * money to run, which is what everything about this file is shaped by.
 *
 * Two rules, and both of them are about the caller rather than this file:
 *
 * **`connect()` returning `'browser'` is a normal outcome, not a failure.** No
 * LiveKit keys, demo mode, no worker, or a balance that cannot pay for a
 * second of it — all of them land here, and every one of them means "use the
 * path that has always worked". A caller that treats it as an error breaks a
 * fresh clone.
 *
 * **The heartbeat is what pays.** An open room bills per second whether or not
 * anyone is talking, so the connection stops when the balance does. The server
 * caps the token's lifetime at what could be afforded when it was issued; this
 * timer is what actually spends it, and what notices when it is gone.
 */

/**
 * How long a slider has to sit still before the worker is told about it.
 *
 * Long enough that a drag is one update rather than sixty; short enough that
 * the change lands inside the same breath the creator is listening to.
 */
const CONFIG_DEBOUNCE_MS = 400

export type VoiceTransport = 'livekit' | 'browser'

interface TokenResponse {
  transport: VoiceTransport
  url?: string
  room?: string
  token?: string
  secondsLeft?: number
  reason?: string
}

/**
 * A route, or a function returning one.
 *
 * The session routes are keyed by an id that does not exist until the ticket
 * has been paid for, which is after this composable is created — so the caller
 * has to be able to hand over a getter rather than a string.
 */
type Route = string | (() => string)

export interface VoiceLinkOptions {
  /** Mints the token and prices the connection. */
  tokenUrl: Route
  /** Billed every `VOICE_TICK_SECONDS` while connected. */
  tickUrl: Route
  /**
   * The draft configuration to hand the worker, for a Kwami that has no row to
   * look up. Studio only — a session's worker reads its own configuration from
   * `/api/internal/kwamis/:id/runtime`, because room data reaches the player too and a
   * session's phrase is the one thing they must not be given.
   *
   * Read again on every edit, not just on connect: the studio's argument is
   * that you tune the character while listening to it, so a slider moved
   * mid-sentence has to reach the worker that is already talking.
   */
  config?: () => KwamiAgentDraft
  /**
   * A turn the worker transcribed or spoke.
   *
   * The worker owns the microphone on this path, so it is the only thing that
   * knows what was said — but it must not be the thing that decides whether
   * that won. It relays the text here and the caller posts it to
   * `/api/session/:id/transcript` exactly as the browser path already does, so
   * `matchSecret` and the claim material stay on the one route that has always
   * held them, and a win still reaches the player rather than the worker.
   */
  onTranscript?: (role: 'player' | 'kwami', text: string, confidence?: number) => void
  /** The balance ran out, or the Kwami went starving. Fall back to `useSpeech`. */
  onExhausted?: () => void
}

function routeOf(route: Route): string {
  return typeof route === 'function' ? route() : route
}

export function useVoiceLink(options: VoiceLinkOptions) {
  // Every route this touches is behind `requireUser`, so a bare `$fetch` gets
  // a 401 — the same reason `usePlaySession` reaches for this.
  const api = useApi()

  const transport = ref<VoiceTransport>('browser')
  const connected = ref(false)
  const secondsLeft = ref<number | null>(null)
  /** Micro-energy left after the last tick, so a meter can move while talking. */
  const balance = ref<bigint | null>(null)
  const error = ref('')

  let room: Room | null = null
  let meter: AudioMeter | null = null
  let ticker: ReturnType<typeof setInterval> | null = null
  let lastTick = 0
  /** The worker's audio, attached to the document so it plays. */
  const speakers: HTMLMediaElement[] = []
  /** Set once the worker has joined; nothing can be configured before that. */
  let agentPresent = false
  /** The voice last sent, so a soul edit does not needlessly respin the TTS. */
  let sentVoiceId: string | undefined
  let configTimer: ReturnType<typeof setTimeout> | null = null

  /** Microphone level in [0, 1], for the avatar. Zero when not connected. */
  function level(): number {
    return meter ? meter.level() : 0
  }

  async function tick() {
    const now = Date.now()
    const seconds = (now - lastTick) / 1000
    lastTick = now

    try {
      const result = await api<{ balance: string; secondsLeft: number; starved?: boolean }>(
        routeOf(options.tickUrl),
        { method: 'POST', body: { seconds } },
      )
      secondsLeft.value = result.secondsLeft
      balance.value = BigInt(result.balance)
      // The session tick reports an unaffordable charge as a 200 rather than
      // throwing, because the challenger's paid window must survive the Kwami
      // running dry. Either way the room stops here.
      if (result.starved) await exhaust()
    } catch {
      // A 402 from the studio tick, or a network failure long enough to matter.
      // Both mean stop billing and hand back to the free path rather than
      // holding a room open that nobody is paying for.
      await exhaust()
    }
  }

  async function exhaust() {
    await disconnect()
    options.onExhausted?.()
  }

  /**
   * Open the room, or report that there is nothing to open.
   *
   * Returns the transport actually in use so the caller can start its own
   * browser fallback in the same branch, rather than reading a ref that has not
   * settled yet.
   */
  async function connect(): Promise<VoiceTransport> {
    if (room) return transport.value

    let issued: TokenResponse
    try {
      issued = await api<TokenResponse>(routeOf(options.tokenUrl), { method: 'POST' })
    } catch {
      transport.value = 'browser'
      return 'browser'
    }

    if (issued.transport !== 'livekit' || !issued.url || !issued.token) {
      transport.value = 'browser'
      return 'browser'
    }

    // Imported at point of use, not at module scope. `docs/setup.md` names the
    // rule and the reason: a browser-only library pulled into the SSR graph is
    // a production server that dies on its first page render.
    const { Room: LiveKitRoom, RoomEvent, Track } = await import('livekit-client')

    const next = new LiveKitRoom()
    next.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      // The worker's voice. Attaching the element is what plays it; nothing
      // else in this app renders an <audio> for it.
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach()
        element.style.display = 'none'
        document.body.appendChild(element)
        // Kept so `disconnect` can take it out again. `attach()` puts an
        // element in the document and nothing removes it, so every reconnect
        // left another live audio sink behind — by the third rehearsal the
        // worker was being played through three of them at once. Tracked here
        // rather than cleaned up on `TrackUnsubscribed`, which does not fire
        // reliably when it is this side that closes the room.
        speakers.push(element)
      }
    })
    next.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      // The draft only has to reach the worker, and the worker only exists once
      // it has joined. Sending on connect would publish into an empty room.
      noteWorker(next, participant)
    })
    next.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      if (isWorker(participant)) agentPresent = false
    })
    next.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      if (!options.onTranscript) return
      // Written by the worker, so it is parsed defensively: a malformed frame
      // must not take the room down mid-session.
      try {
        const message = JSON.parse(new TextDecoder().decode(payload))
        if (message?.type !== 'transcript') return
        if (message.role !== 'player' && message.role !== 'kwami') return
        if (typeof message.text !== 'string' || !message.text) return
        options.onTranscript(message.role, message.text, message.confidence)
      } catch {
        // Not ours, or not JSON. Ignore it.
      }
    })
    next.on(RoomEvent.Disconnected, () => {
      connected.value = false
    })

    try {
      await next.connect(issued.url, issued.token)
      await next.localParticipant.setMicrophoneEnabled(true)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not open the voice connection.'
      await next.disconnect()
      transport.value = 'browser'
      return 'browser'
    }

    room = next
    transport.value = 'livekit'
    connected.value = true
    secondsLeft.value = issued.secondsLeft ?? null

    // A dispatch that beat the browser into the room fires no
    // `ParticipantConnected`, and an unconfigured worker is a generic assistant
    // with none of the character the creator is here to audition.
    for (const participant of next.remoteParticipants.values()) noteWorker(next, participant)

    const track = next.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
    const stream = track?.mediaStream
    if (stream) meter = createAudioMeter(stream)

    lastTick = Date.now()
    ticker = setInterval(() => void tick(), VOICE_TICK_SECONDS * 1000)
    return 'livekit'
  }

  /**
   * The worker, as opposed to another person in the room.
   *
   * LiveKit names a dispatched agent `agent-<job id>`. Nothing else in a studio
   * room is remote, but the check is cheap and a configuration message carries
   * the draft's phrase — it must only ever be addressed to the worker.
   */
  function isWorker(participant: RemoteParticipant): boolean {
    return participant.identity.startsWith('agent')
  }

  function send(message: unknown) {
    if (!room || !agentPresent) return
    const payload = new TextEncoder().encode(JSON.stringify(message))
    void room.localParticipant.publishData(payload, { reliable: true })
  }

  /** First contact: rebuild the worker around this draft. */
  function noteWorker(target: Room, participant: RemoteParticipant) {
    if (!isWorker(participant) || !options.config) return
    agentPresent = true
    const draft = options.config()
    sentVoiceId = draft.voiceId
    const payload = new TextEncoder().encode(JSON.stringify(agentConfigMessage(draft)))
    void target.localParticipant.publishData(payload, { reliable: true })
  }

  /**
   * An edit, while the room is open.
   *
   * A soul update patches the running agent's instructions, so the conversation
   * continues through it. A voice change has to respin the TTS, so it is only
   * sent when the voice actually changed — otherwise every nudge of a trait
   * slider would restart the synthesiser mid-word.
   */
  function pushConfigUpdate() {
    if (!options.config) return
    const draft = options.config()
    send(agentSoulUpdate(draft))
    if (draft.voiceId !== sentVoiceId) {
      sentVoiceId = draft.voiceId
      send(agentVoiceUpdate(draft))
    }
  }

  // Coalesced: a creator dragging a slider produces a change per frame, and
  // each one would otherwise rebuild the worker's prompt.
  if (options.config) {
    watch(
      () => JSON.stringify(options.config!()),
      () => {
        if (!agentPresent) return
        if (configTimer) clearTimeout(configTimer)
        configTimer = setTimeout(pushConfigUpdate, CONFIG_DEBOUNCE_MS)
      },
    )
  }

  async function disconnect() {
    if (configTimer) {
      clearTimeout(configTimer)
      configTimer = null
    }
    agentPresent = false
    sentVoiceId = undefined
    if (ticker) {
      clearInterval(ticker)
      ticker = null
      // Pay for the tail before dropping the room, so a connection closed
      // between heartbeats is billed for the seconds it actually held open.
      await tickFinal()
    }
    meter?.stop()
    meter = null
    for (const element of speakers.splice(0)) element.remove()
    if (room) {
      await room.disconnect()
      room = null
    }
    connected.value = false
    transport.value = 'browser'
  }

  /** The closing charge. Failures are ignored — the room is going away regardless. */
  async function tickFinal() {
    const seconds = (Date.now() - lastTick) / 1000
    if (seconds < 1) return
    try {
      await api(routeOf(options.tickUrl), { method: 'POST', body: { seconds } })
    } catch {
      // Nothing useful to do with it: the user is leaving.
    }
  }

  onBeforeUnmount(() => void disconnect())

  return { transport, connected, secondsLeft, balance, error, level, connect, disconnect }
}
