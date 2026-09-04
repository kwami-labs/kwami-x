<script setup lang="ts">
import type { KwamiDetailResponse } from '#shared/types/api'
import { EXTENSION_HOOKS, EXTENSION_RULES } from '#shared/builder/extension-abi'

definePageMeta({ title: 'Program builder' })

const route = useRoute()
const mint = computed(() => route.params.mint as string)
const { data } = await useFetch<KwamiDetailResponse>(`/api/kwami/${mint.value}`)
const kwami = computed(() => data.value?.kwami ?? null)

const name = ref('')
const brief = ref('')
const hooks = ref<string[]>(['onExpire'])
const source = ref<string | null>(null)
const generating = ref(false)
const error = ref<string | null>(null)

const examples = [
  {
    label: 'Escalating ticket',
    brief:
      'Every time a challenger fails, the next ticket costs 8% more. The price resets to its original value the moment someone wins.',
    hooks: ['onExpire', 'onWin'],
  },
  {
    label: 'Tenth loser jackpot',
    brief:
      'Take 5% of every losing ticket into a side pot. Every tenth consecutive loser receives that side pot as a consolation prize.',
    hooks: ['onExpire'],
  },
  {
    label: 'Holder gate',
    brief:
      'Only wallets holding at least one token of a specific mint can open a session. Everyone else is rejected before paying.',
    hooks: ['onSessionStart'],
  },
  {
    label: 'Inheritance',
    brief:
      'When this Kwami dies, whatever is left in its pot is split evenly between the last five wallets that challenged it.',
    hooks: ['onDeath', 'onExpire'],
  },
]

function loadExample(e: (typeof examples)[number]) {
  name.value = e.label
  brief.value = e.brief
  hooks.value = [...e.hooks]
}

function toggleHook(hookName: string) {
  hooks.value = hooks.value.includes(hookName)
    ? hooks.value.filter((h) => h !== hookName)
    : [...hooks.value, hookName]
}

async function generate() {
  generating.value = true
  error.value = null
  source.value = null
  try {
    const result = await $fetch<{ source: string }>('/api/builder/generate', {
      method: 'POST',
      body: { kwamiMint: mint.value, name: name.value, brief: brief.value, hooks: hooks.value },
    })
    source.value = result.source
  } catch (e) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? 'Generation failed.'
  } finally {
    generating.value = false
  }
}

const copied = ref(false)
async function copySource() {
  if (!source.value) return
  await navigator.clipboard.writeText(source.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1800)
}
</script>

<template>
  <div class="wrap builder">
    <header class="stack gap-2">
      <span class="eyebrow">Program builder</span>
      <h1>Give {{ kwami?.name ?? 'your Kwami' }} its own rules.</h1>
      <p class="muted builder__lede">
        Describe a game in plain language and get an Anchor program that the vault will call at each lifecycle moment.
        You read it, you deploy it, you attach it. After that it is as immutable as everything else about this Kwami.
      </p>
    </header>

    <div class="builder__grid">
      <section class="stack gap-3">
        <div class="card stack gap-3">
          <div class="field">
            <span class="label">Start from</span>
            <div class="chips">
              <button v-for="e in examples" :key="e.label" class="chip" @click="loadExample(e)">{{ e.label }}</button>
            </div>
          </div>

          <div class="field">
            <label class="label" for="pname">Name</label>
            <input id="pname" v-model="name" class="input" placeholder="Escalating ticket" maxlength="64" >
          </div>

          <div class="field">
            <label class="label" for="brief">What should it do?</label>
            <textarea
              id="brief"
              v-model="brief"
              class="textarea"
              rows="6"
              placeholder="Every time a challenger fails, the next ticket costs 8% more…"
            />
            <span class="hint">Be specific about numbers and edge cases. Vague briefs produce plausible, wrong code.</span>
          </div>

          <div class="field">
            <span class="label">When should it run?</span>
            <div class="hooks">
              <button
                v-for="hook in EXTENSION_HOOKS"
                :key="hook.name"
                class="hook"
                :class="{ 'hook--on': hooks.includes(hook.name) }"
                @click="toggleHook(hook.name)"
              >
                <strong class="num">{{ hook.name }}</strong>
                <span class="dim">{{ hook.description }}</span>
              </button>
            </div>
          </div>

          <button
            class="btn btn--primary btn--lg"
            :disabled="generating || brief.length < 10 || hooks.length === 0"
            @click="generate"
          >
            {{ generating ? 'Writing the program…' : 'Generate' }}
          </button>
          <p v-if="error" class="error-text">{{ error }}</p>
        </div>

        <div class="card stack gap-2">
          <h3>What the generator is held to</h3>
          <ul class="rules">
            <li v-for="rule in EXTENSION_RULES" :key="rule">{{ rule }}</li>
          </ul>
          <p class="hint">
            These constraints are sent to the model and listed here so you are checking the same list it was given.
            Read the code before you deploy it — the vault stops a bad extension from draining the pot, but it cannot
            stop one from breaking your own game.
          </p>
        </div>
      </section>

      <section class="stack gap-2">
        <div v-if="!source" class="card output output--empty">
          <p class="dim">The generated Anchor program will appear here.</p>
        </div>
        <div v-else class="card output">
          <div class="row gap-2 output__bar">
            <span class="eyebrow grow">lib.rs</span>
            <button class="btn btn--sm btn--ghost" @click="copySource">{{ copied ? 'Copied' : 'Copy' }}</button>
          </div>
          <pre class="output__code"><code>{{ source }}</code></pre>
          <div class="output__next stack gap-2">
            <h3>Next</h3>
            <ol class="steps dim">
              <li>Drop this into <code class="num">programs/</code> and run <code class="num">anchor build</code>.</li>
              <li>Deploy it, then remove its upgrade authority.</li>
              <li>Register it against this Kwami with <code class="num">register_extension</code>.</li>
              <li>Publish. The rules are fixed from that moment.</li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.builder { display: flex; flex-direction: column; gap: 26px; }
.builder__lede { max-width: 64ch; }

.builder__grid {
  display: grid;
  grid-template-columns: minmax(0, 440px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.chips { display: flex; flex-wrap: wrap; gap: 7px; }

.chip {
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
  font-size: 0.84rem;
}
.chip:hover { border-color: var(--border-strong); }

.hooks { display: flex; flex-direction: column; gap: 7px; }

.hook {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
  font-size: 0.82rem;
}

.hook--on { border-color: var(--accent-line); background: var(--accent-soft); }
.hook strong { font-size: 0.85rem; }

.rules { margin: 0; padding-left: 17px; display: flex; flex-direction: column; gap: 6px; font-size: 0.85rem; color: var(--fg-muted); }

.output { padding: 0; overflow: hidden; }
.output--empty { padding: 60px 24px; text-align: center; }
.output__bar { padding: 12px 16px; border-bottom: 1px solid var(--border); }

.output__code {
  margin: 0;
  padding: 16px;
  max-height: 62vh;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 0.76rem;
  line-height: 1.6;
  color: var(--fg-muted);
}

.output__next { padding: 16px; border-top: 1px solid var(--border); }
.steps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; font-size: 0.85rem; }

@media (max-width: 1020px) {
  .builder__grid { grid-template-columns: 1fr; }
}
</style>
