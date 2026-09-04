import { readFile, readdir } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import { marked } from 'marked'

/**
 * Serve the repository's own documentation as HTML.
 *
 * The docs in `docs/` are the single source of truth: they are what a
 * contributor reads in the repo and what a visitor reads on the site. Keeping
 * a second hand-written copy inside Vue components would guarantee the two
 * drift, and the one people trust would be whichever they saw last.
 */

const DOCS_ROOT = resolve(process.cwd(), 'docs')

export default defineEventHandler(async (event) => {
  const slug = (getRouterParam(event, 'slug') || 'index').replace(/\.md$/, '')

  // Path traversal guard. The slug reaches this from the URL, so `../../.env`
  // is one careless `join` away from being served as documentation.
  const target = normalize(join(DOCS_ROOT, `${slug}.md`))
  if (!target.startsWith(DOCS_ROOT)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad path.' })
  }

  let markdown: string
  try {
    markdown = await readFile(target, 'utf8')
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'No such document.' })
  }

  // The first `# heading` becomes the page title, and is stripped from the body
  // so the layout can render it consistently with the rest of the site.
  const titleMatch = markdown.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1] ?? slug
  const body = titleMatch ? markdown.replace(titleMatch[0], '').trim() : markdown

  return {
    slug,
    title,
    html: await marked.parse(body, { gfm: true, breaks: false }),
    toc: await listDocs(),
  }
})

async function listDocs() {
  const entries = await readdir(DOCS_ROOT, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''))
    .sort((a, b) => (a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)))
}
