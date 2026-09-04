import { marked } from 'marked'
import type { DocsResponse } from '#shared/types/api'

/**
 * Serve the repository's own documentation as HTML.
 *
 * The markdown in `docs/` is the single source of truth: it is what a
 * contributor reads in the repo and what a visitor reads on the site. Keeping a
 * second hand-written copy inside Vue components would guarantee the two drift,
 * and the one people trust would be whichever they saw last.
 *
 * Files are read through Nitro's server-asset storage rather than the
 * filesystem, because the built output does not carry the repository — reading
 * from `process.cwd()` works in development and 404s in production.
 */

/** Slugs are path segments, not paths: no separators, no dots, no traversal. */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

export default defineEventHandler(async (event): Promise<DocsResponse> => {
  const raw = (getRouterParam(event, 'slug') || 'index').replace(/\.md$/, '')
  if (!SAFE_SLUG.test(raw)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad document name.' })
  }

  const storage = useStorage('assets:docs')
  const markdown = await storage.getItem<string>(`${raw}.md`)
  if (typeof markdown !== 'string') {
    throw createError({ statusCode: 404, statusMessage: 'No such document.' })
  }

  // The first `# heading` becomes the page title and is stripped from the body,
  // so the layout renders it consistently with the rest of the site.
  const titleMatch = markdown.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1] ?? raw
  const body = titleMatch ? markdown.replace(titleMatch[0], '').trim() : markdown

  const keys = await storage.getKeys()
  const toc = keys
    .filter((k) => k.endsWith('.md'))
    .map((k) => k.replace(/\.md$/, ''))
    .sort((a, b) => (a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)))

  return {
    slug: raw,
    title,
    html: await marked.parse(body, { gfm: true, breaks: false }),
    toc,
  }
})
