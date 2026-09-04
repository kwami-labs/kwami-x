/**
 * Browser speech recognition and synthesis.
 *
 * The zero-infrastructure voice path. LiveKit plus a hosted agent gives a far
 * better conversation, but it needs an API key, a deployed worker and a
 * running room — none of which exist on a fresh clone. The Web Speech API
 * needs nothing, so `bun run dev` produces a playable game on the first run
 * and the LiveKit path becomes an upgrade rather than a prerequisite.
 */

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}
interface SpeechRecognitionResult {
  isFinal: boolean
  0: SpeechRecognitionAlternative
  length: number
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { length: number; [i: number]: SpeechRecognitionResult }
}
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => SpeechRecognitionLike

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface SpeechOptions {
  lang?: string
  /** Fires for each finalised utterance. */
  onFinal: (text: string, confidence: number) => void
  /** Fires continuously with the in-progress guess, for the live caption. */
  onInterim?: (text: string) => void
  onError?: (message: string) => void
}

export function useSpeech(options: SpeechOptions) {
  const supported = computed(() => recognitionCtor() !== null)
  const listening = ref(false)
  const interim = ref('')

  let recognition: SpeechRecognitionLike | null = null
  // Chrome ends recognition after a pause even in continuous mode. A session
  // that stops listening 20 seconds in is a lost ticket, so it restarts itself
  // until the caller explicitly stops.
  let wantsToListen = false

  function start() {
    const Ctor = recognitionCtor()
    if (!Ctor) {
      options.onError?.('This browser cannot do speech recognition. Try Chrome or Edge.')
      return
    }
    wantsToListen = true

    recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = options.lang ?? 'en-US'

    recognition.onresult = (event) => {
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result) continue
        const alternative = result[0]
        if (result.isFinal) {
          options.onFinal(alternative.transcript.trim(), alternative.confidence)
        } else {
          interimText += alternative.transcript
        }
      }
      interim.value = interimText
      if (interimText) options.onInterim?.(interimText)
    }

    recognition.onerror = (e) => {
      // `no-speech` and `aborted` are routine during a pause; surfacing them
      // would fill the screen with errors while someone is thinking.
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        options.onError?.(`Speech recognition error: ${e.error}`)
      }
    }

    recognition.onend = () => {
      listening.value = false
      if (wantsToListen) {
        try {
          recognition?.start()
          listening.value = true
        } catch {
          // Restarting too quickly throws; the next `onend` will retry.
        }
      }
    }

    try {
      recognition.start()
      listening.value = true
    } catch (e) {
      options.onError?.((e as Error).message)
    }
  }

  function stop() {
    wantsToListen = false
    recognition?.stop()
    recognition = null
    listening.value = false
    interim.value = ''
  }

  onBeforeUnmount(stop)

  return { supported, listening, interim, start, stop }
}

/** Speak a line back through the browser's synthesiser. */
export function speak(text: string, opts: { rate?: number; pitch?: number; voice?: string } = {}) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = opts.rate ?? 1.02
  utterance.pitch = opts.pitch ?? 0.92
  if (opts.voice) {
    const match = window.speechSynthesis.getVoices().find((v) => v.name === opts.voice)
    if (match) utterance.voice = match
  }
  window.speechSynthesis.speak(utterance)
  return utterance
}

export function cancelSpeech() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
}
