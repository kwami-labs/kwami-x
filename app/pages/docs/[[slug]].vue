<script setup lang="ts">
import type { DocsResponse } from '#shared/types/api'
const route = useRoute()
const slug = computed(() => (route.params.slug as string) || 'index')

const { data, error } = await useFetch<DocsResponse>(() => `/api/docs/${slug.value}`)

const titles: Record<string, string> = {
  index: 'Overview',
  setup: 'Setup',
  protocol: 'Protocol',
  economics: 'Economics',
  architecture: 'Architecture',
  auth: 'Authentication',
  embed: 'Embedding',
  builder: 'Program builder',
  api: 'HTTP API',
  security: 'Security',
  testing: 'Testing',
}

useSeoMeta({ title: () => `${data.value?.title ?? 'Docs'} — Kwami` })
</script>

<template>
  <div class="wrap docs">
    <nav class="docs__nav">
      <span class="eyebrow">Documentation</span>
      <ul>
        <li v-for="entry in data?.toc ?? []" :key="entry">
          <NuxtLink :to="entry === 'index' ? '/docs' : `/docs/${entry}`" :class="{ on: slug === entry }">
            {{ titles[entry] ?? entry }}
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <article v-if="error" class="card">
      <h2>No such document.</h2>
      <NuxtLink to="/docs" class="btn btn--ghost">Back to the overview</NuxtLink>
    </article>

    <article v-else class="prose">
      <h1>{{ data?.title }}</h1>
      <!-- eslint-disable-next-line vue/no-v-html -- source is our own repo markdown, not user input -->
      <div v-html="data?.html" />
    </article>
  </div>
</template>

<style scoped>
.docs {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 40px;
  align-items: start;
}

.docs__nav {
  position: sticky;
  top: calc(var(--header-h) + 24px);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.docs__nav ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.docs__nav a {
  display: block;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
  color: var(--fg-muted);
  transition: all 0.14s ease;
}

.docs__nav a:hover {
  background: var(--panel);
  color: var(--fg);
}
.docs__nav a.on {
  background: var(--accent-soft);
  color: var(--fg);
}

.prose {
  max-width: 74ch;
}

@media (max-width: 860px) {
  .docs {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .docs__nav {
    position: static;
  }
  .docs__nav ul {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>

<style>
/* Unscoped: the markdown body is injected with v-html, so scoped attributes
   never reach it. Kept narrow so it cannot bleed into the rest of the app. */
.prose h2 {
  margin: 2.2em 0 0.7em;
  font-size: 1.4rem;
}
.prose h3 {
  margin: 1.8em 0 0.6em;
  font-size: 1.08rem;
}
.prose h1 + div > h2:first-child {
  margin-top: 1em;
}
.prose p,
.prose li {
  color: var(--fg-muted);
  line-height: 1.68;
}
.prose ul,
.prose ol {
  padding-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prose a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.prose strong {
  color: var(--fg);
}

.prose code {
  font-family: var(--font-mono);
  font-size: 0.86em;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--panel-strong);
  color: var(--fg);
}

.prose pre {
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 15px 17px;
  overflow-x: auto;
  line-height: 1.55;
}

.prose pre code {
  background: none;
  padding: 0;
  font-size: 0.8rem;
  color: var(--fg-muted);
}

.prose blockquote {
  margin: 1.4em 0;
  padding: 2px 0 2px 16px;
  border-left: 2px solid var(--accent-line);
  color: var(--fg-muted);
}

.prose table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  margin: 1.4em 0;
}
.prose th,
.prose td {
  text-align: left;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
}
.prose th {
  color: var(--fg-dim);
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.prose hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 2.4em 0;
}
</style>
