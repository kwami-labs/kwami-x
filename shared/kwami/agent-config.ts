import { buildKwamiPrompt, type KwamiPromptInput } from './prompt'
import { voiceById } from './voice'

/**
 * What the voice worker is told, in the shape it actually parses.
 *
 * `kwami-lk-agent` listens on the room's data channel for JSON with a `type`
 * field and routes on it — `config` rebuilds the agent, `config_update` patches
 * a running one without dropping the connection. Anything without a recognised
 * `type` is logged and discarded, which is what happened to every draft the
 * studio published before this file existed: the creator heard a generic
 * assistant with a default voice and no phrase to guard.
 *
 * The two message families do not share a key style, and that is the agent's
 * schema rather than an oversight here — `handle_full_config` reads nested
 * camelCase (`voice.tts.voice`) and `update_voice` reads flat snake_case
 * (`tts_voice`). Both are encoded below so no caller has to remember which.
 */

/**
 * The model the Kwami thinks with, on every path.
 *
 * Exported so `kwami-brain` and the voice worker cannot drift apart: they are
 * meant to be the same character, and a model swapped in one place only is the
 * easiest way for that to stop being true.
 */
export const BRAIN_MODEL = 'claude-sonnet-5'

export interface KwamiAgentDraft extends KwamiPromptInput {
  name?: string
  voiceId?: string
  language?: string
  /** Set once the Kwami exists, so the worker's memory and usage land on it. */
  kwamiId?: string
}

/**
 * The character half of the configuration.
 *
 * `conversationStyle`, `responseLength` and `emotionalTone` are sent explicitly
 * because the agent appends its own line for each and defaults them to
 * "friendly", "medium" and "warm". Left alone, a Kwami whose whole character is
 * cold institutional refusal would also be instructed to "express warmth and
 * friendliness in your interactions" — the default silently arguing with the
 * prompt the creator actually wrote.
 */
function soulOf(draft: KwamiAgentDraft) {
  return {
    name: draft.name?.trim() || 'Kwami',
    personality: draft.persona,
    systemPrompt: buildKwamiPrompt(draft),
    conversationStyle: 'in character, exactly as described above',
    responseLength: 'short' as const,
    emotionalTone: 'neutral' as const,
  }
}

/** TTS/STT, flat, as `update_voice` reads it. */
function ttsOf(draft: KwamiAgentDraft) {
  return {
    tts_provider: 'openai',
    tts_model: 'tts-1',
    tts_voice: voiceById(draft.voiceId).openai,
  }
}

/** Sent once, when the worker joins. Rebuilds the agent around this draft. */
export function agentConfigMessage(draft: KwamiAgentDraft) {
  return {
    type: 'config',
    ...(draft.kwamiId ? { kwamiId: draft.kwamiId } : {}),
    kwamiName: draft.name?.trim() || 'Kwami',
    // The worker's default introduction — "Hey there! I'm Kwami, what's your
    // name?" — is an assistant's opening, and this is not an assistant. A Kwami
    // guarding a phrase volunteers nothing, so it says nothing until spoken to.
    greeting: false,
    // Off on both paths, for two different reasons.
    //
    // In the studio a rehearsal is disposable and the page says so, and a draft
    // has no id — the worker would file it under a shared `kwami_default`
    // namespace and pool every creator's drafts together.
    //
    // In a real session it is a fairness problem: a Kwami that remembered the
    // last challenger's angles would be a different opponent for the next one,
    // who paid the same ticket price for it.
    memory: { enabled: false },
    soul: soulOf(draft),
    voice: {
      tts: { provider: 'openai', model: 'tts-1', voice: voiceById(draft.voiceId).openai },
      stt: { provider: 'deepgram', model: 'nova-2', language: draft.language ?? 'en' },
      // The same model `kwami-brain` runs. The worker defaults to gpt-4o-mini,
      // which made a Kwami sound like one character when typed to and a
      // different one when spoken to — the studio cannot audition a character
      // that only exists on one of the two paths.
      llm: { provider: 'anthropic', model: BRAIN_MODEL },
    },
  }
}

/**
 * Sent on every edit while the room is open.
 *
 * Two messages rather than one because the agent applies them very differently:
 * a soul update rebuilds the instructions on the *running* agent, so the
 * conversation carries on mid-sentence, while a voice change has to swap the
 * TTS. Sending a full `config` for a moved slider would tear down and recreate
 * the agent — losing the conversation — every time the creator touched
 * anything.
 */
export function agentSoulUpdate(draft: KwamiAgentDraft) {
  return { type: 'config_update', updateType: 'soul', config: soulOf(draft) }
}

export function agentVoiceUpdate(draft: KwamiAgentDraft) {
  return { type: 'config_update', updateType: 'voice', config: ttsOf(draft) }
}
