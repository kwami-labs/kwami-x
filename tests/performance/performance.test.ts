/**
 * End-to-end performance of the surfaces a visitor actually hits.
 *
 * happy-dom has no WebGL, so the GPU side is measured the way the renderer
 * itself budgets it: shader source size, mesh buffers, particle counts, and
 * how many contexts a page would open. The UI side is the real work Vue does
 * before a frame: parse the JSON, resolve each look, format the money, and
 * write the DOM. Hardware consume is sampled around those same workloads.
 */
import { cpus, freemem, totalmem } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  buildKwamiFragmentShader,
  createKwamiGeometry,
  RENDERER_PRESETS,
  resolveRendererParams,
  segmentsForResolution,
} from '~/utils/kwami-renderer'
import { formatCents, formatSol, formatUsdc, lookFor, relativeTime, shortAddress } from '~/utils/format'
import { KWAMI_SKINS } from '#shared/kwami/skins'
import { explorerUrl } from '#shared/solana/constants'
import type { KwamiPublic, SessionSummary } from '#shared/types/api'
import type { TranscriptTurn } from '#shared/types/kwami'
import {
  ARENA_LIMIT,
  BOARD_LIMIT,
  catalog,
  detailResponse,
  listResponse,
  nftSvg,
  sessionsFor,
  transcript,
} from './fixtures'
import { bytesOf, evaluate, formatBytes, gradeDown, record, sampleMany, sampleOnce, setHost } from './harness'

const CARD_RESOLUTION_CAP = 120
const cpuList = cpus()

setHost({
  cpus: cpuList.length || 1,
  model: cpuList[0]?.model.trim() || 'unknown',
  totalMemBytes: totalmem(),
  freeMemBytes: freemem(),
  node: process.version,
})

function ticketLabel(k: KwamiPublic): string {
  const parts: string[] = []
  if (k.ticket_price_lamports > 0) parts.push(formatSol(k.ticket_price_lamports))
  if (k.ticket_price_usdc > 0) parts.push(formatUsdc(k.ticket_price_usdc))
  return parts.join(' or ')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The text a card paints, which is the work that blocks first paint. */
function hydrateCard(k: KwamiPublic) {
  const look = lookFor(k)
  return {
    mint: k.mint,
    name: k.name,
    tagline: k.tagline,
    state: k.state,
    prize: formatCents(k.value_cents * 0.8),
    ticket: ticketLabel(k),
    tried: k.sessions_played,
    won: k.sessions_won,
    minutes: Math.round(k.session_duration / 60),
    skin: look.skin,
    palette: look.palette,
    params: resolveRendererParams(k.renderer, look.tuning),
  }
}

function cardHtml(k: KwamiPublic): string {
  const card = hydrateCard(k)
  return `<article class="kcard" data-mint="${card.mint}" data-skin="${card.skin}">
    <h3>${escapeHtml(card.name)}</h3>
    <p>${escapeHtml(card.tagline)}</p>
    <span class="prize">${card.prize}</span>
    <span class="ticket">${escapeHtml(card.ticket)}</span>
    <span class="tried">${card.tried} tried · ${card.won} won · ${card.minutes} min</span>
  </article>`
}

function boardRowHtml(k: KwamiPublic, rank: number): string {
  return `<tr data-mint="${k.mint}">
    <td>${rank}</td>
    <td>${escapeHtml(k.name)}</td>
    <td>${formatCents(k.value_cents)}</td>
    <td>${formatCents(k.value_cents * (k.payout_bps / 10000))}</td>
    <td>${k.sessions_won} / ${k.sessions_played}</td>
  </tr>`
}

function feedRowHtml(s: SessionSummary): string {
  const won = s.outcome === 'won'
  const ticket = s.asset === 'SOL' ? formatSol(s.ticket_amount) : formatUsdc(s.ticket_amount)
  const payout = won
    ? s.payout_usdc > 0 && s.payout_lamports === 0
      ? formatUsdc(s.payout_usdc)
      : formatSol(s.payout_lamports)
    : ticket
  return `<li data-id="${s.id}">
    <a>${shortAddress(s.player_wallet)}</a>
    <span>${relativeTime(s.started_at)}</span>
    <span>${won ? 'Took the pot' : s.outcome}</span>
    <span>${payout}</span>
    <a href="${explorerUrl(s.tx_start ?? s.player_wallet, 'devnet', won ? 'tx' : 'address')}">tx</a>
  </li>`
}

function transcriptHtml(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => {
      const secs = Math.floor(t.at / 1000)
      const stamp = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`
      return `<div class="turn turn--${t.role}"><span>${stamp}</span><p>${escapeHtml(t.text)}</p></div>`
    })
    .join('')
}

function meshOf(resolution: number) {
  const { width, height } = segmentsForResolution(resolution)
  return { width, height, triangles: width * height * 2, vertices: (width + 1) * (height + 1) }
}

function cardResolution(k: KwamiPublic): number {
  const look = lookFor(k)
  const params = resolveRendererParams(k.renderer, look.tuning)
  return Math.min(params.resolution, CARD_RESOLUTION_CAP)
}

describe('hardware consume', () => {
  it('keeps first-paint CPU and heap inside a phone-sized budget', () => {
    const raw = JSON.stringify(listResponse(ARENA_LIMIT))
    const sample = sampleMany(() => {
      const data = JSON.parse(raw) as ReturnType<typeof listResponse>
      const cards = data.kwamis.map(hydrateCard)
      const totals = `${formatCents(data.totals.pot)} · ${data.totals.live} live`
      expect(cards).toHaveLength(ARENA_LIMIT)
      expect(totals.length).toBeGreaterThan(0)
    })

    record({
      id: 'cpu_first_paint',
      group: 'hardware',
      label: 'CPU — arena first paint',
      value: sample.cpuMs,
      unit: 'ms',
      grade: gradeDown(sample.cpuMs, 40, 120),
      note: 'Parse 24 rows, resolve looks, format pots. Phones share this with the GPU.',
    })
    record({
      id: 'ram_first_paint',
      group: 'hardware',
      label: 'RAM — arena first paint',
      value: sample.heapDeltaBytes,
      unit: 'B',
      grade: gradeDown(sample.heapDeltaBytes, 2 * 1024 * 1024, 8 * 1024 * 1024),
    })
    record({
      id: 'wall_first_paint',
      group: 'ui',
      label: 'Arena data hydrate (24 cards)',
      value: sample.wallMs,
      unit: 'ms',
      grade: gradeDown(sample.wallMs, 25, 80),
    })

    expect(sample.cpuMs).toBeGreaterThanOrEqual(0)
  })

  it('allocates card meshes without blowing the heap', () => {
    const kwamis = catalog(ARENA_LIMIT)
    const sample = sampleOnce(() => {
      const geos = kwamis.map((k) => createKwamiGeometry(cardResolution(k)))
      const bytes = geos.reduce((sum, geo) => {
        const pos = geo.getAttribute('position')
        const idx = geo.getIndex()
        return sum + (pos?.array.byteLength ?? 0) + (idx?.array.byteLength ?? 0)
      }, 0)
      for (const geo of geos) geo.dispose()
      return bytes
    })

    record({
      id: 'ram_card_meshes',
      group: 'hardware',
      label: 'RAM — 24 card mesh buffers',
      value: Math.max(0, sample.heapDeltaBytes),
      unit: 'B',
      grade: gradeDown(Math.max(0, sample.heapDeltaBytes), 12 * 1024 * 1024, 32 * 1024 * 1024),
      note: `${formatBytes(sample.result)} of position+index buffers across the arena.`,
    })
    expect(sample.result).toBeGreaterThan(0)
  })

  it('compiles every skin without a memory spike', () => {
    const sample = sampleMany(() => {
      for (const skin of KWAMI_SKINS) buildKwamiFragmentShader(skin.id)
    })

    record({
      id: 'cpu_shader_compile',
      group: 'hardware',
      label: 'CPU — compile all skins',
      value: sample.cpuMs,
      unit: 'ms',
      grade: gradeDown(sample.cpuMs, 20, 80),
    })
    record({
      id: 'ram_shader_compile',
      group: 'hardware',
      label: 'RAM — compile all skins',
      value: sample.heapDeltaBytes,
      unit: 'B',
      grade: gradeDown(sample.heapDeltaBytes, 4 * 1024 * 1024, 16 * 1024 * 1024),
    })
  })
})

describe('bandwidth', () => {
  it('keeps list and detail payloads small enough for a mid-range radio', () => {
    const arena = listResponse(ARENA_LIMIT)
    const board = listResponse(BOARD_LIMIT)
    const detail = detailResponse()
    const svg = nftSvg(arena.kwamis[0]!)

    const arenaBytes = bytesOf(arena)
    const boardBytes = bytesOf(board)
    const detailBytes = bytesOf(detail)
    const svgBytes = bytesOf(svg)

    record({
      id: 'bw_arena',
      group: 'bandwidth',
      label: 'GET /api/kwami (arena, 24)',
      value: arenaBytes,
      unit: 'B',
      grade: gradeDown(arenaBytes, 80 * 1024, 160 * 1024),
    })
    record({
      id: 'bw_board',
      group: 'bandwidth',
      label: 'GET /api/kwami (leaderboard, 60)',
      value: boardBytes,
      unit: 'B',
      grade: gradeDown(boardBytes, 180 * 1024, 320 * 1024),
    })
    record({
      id: 'bw_detail',
      group: 'bandwidth',
      label: 'GET /api/kwami/:mint + 12 sessions',
      value: detailBytes,
      unit: 'B',
      grade: gradeDown(detailBytes, 12 * 1024, 32 * 1024),
    })
    record({
      id: 'bw_svg',
      group: 'bandwidth',
      label: 'GET /api/kwami/:mint/image.svg',
      value: svgBytes,
      unit: 'B',
      grade: gradeDown(svgBytes, 2 * 1024, 8 * 1024),
    })

    expect(arena.kwamis).toHaveLength(ARENA_LIMIT)
    expect(board.kwamis).toHaveLength(BOARD_LIMIT)
  })

  it('does not ship a shader the embed cannot afford', () => {
    const sizes = KWAMI_SKINS.map((skin) => bytesOf(buildKwamiFragmentShader(skin.id)))
    const heaviest = Math.max(...sizes)
    const catalogue = sizes.reduce((sum, n) => sum + n, 0)

    record({
      id: 'bw_shader',
      group: 'bandwidth',
      label: 'Heaviest fragment shader',
      value: heaviest,
      unit: 'B',
      grade: gradeDown(heaviest, 16 * 1024, 28 * 1024),
      note: "Simplex is inlined. An embed on a stranger's page pays this once per skin change.",
    })
    record({
      id: 'bw_shader_catalogue',
      group: 'bandwidth',
      label: 'All 22 fragment shaders',
      value: catalogue,
      unit: 'B',
      grade: gradeDown(catalogue, 280 * 1024, 480 * 1024),
    })
  })
})

describe('UI load and render', () => {
  it('paints the arena grid in happy-dom', () => {
    const payload = listResponse(ARENA_LIMIT)
    const root = document.createElement('div')
    document.body.appendChild(root)

    const sample = sampleMany(() => {
      const data = structuredClone(payload)
      root.innerHTML = `<section class="grid">${data.kwamis.map(cardHtml).join('')}</section>
        <div class="totals">${formatCents(data.totals.pot)}</div>`
    })

    expect(root.querySelectorAll('.kcard')).toHaveLength(ARENA_LIMIT)
    document.body.removeChild(root)

    record({
      id: 'ui_arena_dom',
      group: 'ui',
      label: 'Arena DOM render (24 cards)',
      value: sample.wallMs,
      unit: 'ms',
      grade: gradeDown(sample.wallMs, 20, 70),
    })
  })

  it('filters and paints the leaderboard tabs', () => {
    const payload = listResponse(BOARD_LIMIT)
    const root = document.createElement('div')
    document.body.appendChild(root)

    const sample = sampleMany(() => {
      const all = [...payload.kwamis]
      const pot = all
        .filter((k) => k.state === 'live' || k.state === 'paused')
        .sort((a, b) => b.value_cents - a.value_cents)
      const contested = [...all].sort((a, b) => b.sessions_played - a.sessions_played)
      const fallen = all.filter((k) => k.state === 'dead' || k.state === 'cracked')
      root.innerHTML = `<table>${pot.map((k, i) => boardRowHtml(k, i + 1)).join('')}</table>
        <table>${contested.map((k, i) => boardRowHtml(k, i + 1)).join('')}</table>
        <p>${fallen.length} fallen</p>`
    })

    expect(root.querySelectorAll('tr').length).toBeGreaterThan(0)
    document.body.removeChild(root)

    record({
      id: 'ui_board_dom',
      group: 'ui',
      label: 'Leaderboard tabs (60 rows × 3)',
      value: sample.wallMs,
      unit: 'ms',
      grade: gradeDown(sample.wallMs, 15, 60),
    })
  })

  it('paints a profile ledger and a live transcript', () => {
    const kwami = catalog(1)[0]!
    const feed = sessionsFor(kwami, 12)
    const turns = transcript(40)
    const root = document.createElement('div')
    document.body.appendChild(root)

    const sample = sampleMany(() => {
      const look = lookFor(kwami)
      root.innerHTML = `<header>${escapeHtml(kwami.name)} · ${look.skin}</header>
        <ul>${feed.map(feedRowHtml).join('')}</ul>
        <div class="transcript">${transcriptHtml(turns)}</div>`
    })

    expect(root.querySelectorAll('li')).toHaveLength(feed.length)
    expect(root.querySelectorAll('.turn')).toHaveLength(40)
    document.body.removeChild(root)

    record({
      id: 'ui_profile_dom',
      group: 'ui',
      label: 'Profile feed + 40-turn transcript',
      value: sample.wallMs,
      unit: 'ms',
      grade: gradeDown(sample.wallMs, 15, 50),
    })
  })

  it('resolves every studio look without a hitch', () => {
    const kwamis = catalog(KWAMI_SKINS.length)
    const sample = sampleMany(() => {
      for (const k of kwamis) {
        const look = lookFor(k)
        resolveRendererParams(k.renderer, look.tuning)
        buildKwamiFragmentShader(look.skin)
      }
    })

    record({
      id: 'ui_look_resolve',
      group: 'ui',
      label: 'Resolve look + shader for 22 skins',
      value: sample.wallMs,
      unit: 'ms',
      grade: gradeDown(sample.wallMs, 20, 70),
    })
  })
})

describe('renderer cost', () => {
  it('keeps a card mesh in the range a grid can share', () => {
    const card = meshOf(CARD_RESOLUTION_CAP)
    const stage = meshOf(RENDERER_PRESETS['blob-xyz'].resolution)

    record({
      id: 'gpu_card_tris',
      group: 'renderer',
      label: 'Triangles per card (cap 120)',
      value: card.triangles,
      unit: 'tris',
      grade: gradeDown(card.triangles, 16_000, 24_000),
    })
    record({
      id: 'gpu_stage_tris',
      group: 'renderer',
      label: 'Triangles per stage blob',
      value: stage.triangles,
      unit: 'tris',
      grade: gradeDown(stage.triangles, 40_000, 80_000),
    })

    expect(card.triangles).toBeGreaterThan(8_000)
    expect(stage.triangles).toBeGreaterThan(card.triangles)
  })

  it('prices the full arena the way a phone would pay it', () => {
    const kwamis = catalog(ARENA_LIMIT)
    let triangles = 0
    let particles = 0
    for (const k of kwamis) {
      triangles += meshOf(cardResolution(k)).triangles
      particles += resolveRendererParams(k.renderer, lookFor(k).tuning).particles
    }

    record({
      id: 'gpu_arena_tris',
      group: 'renderer',
      label: 'Arena triangles (24 cards)',
      value: triangles,
      unit: 'tris',
      grade: gradeDown(triangles, 350_000, 550_000),
      note: 'Each card is its own canvas. The field packs many Kwamis into one context; the arena does not.',
    })
    record({
      id: 'gpu_arena_particles',
      group: 'renderer',
      label: 'Arena particles (24 cards)',
      value: particles,
      unit: 'pts',
      grade: gradeDown(particles, 8_000, 16_000),
    })
    record({
      id: 'gpu_arena_contexts',
      group: 'renderer',
      label: 'WebGL contexts on /',
      value: ARENA_LIMIT,
      unit: 'ctx',
      grade: gradeDown(ARENA_LIMIT, 8, 24),
      note: 'Browsers silently drop the oldest context around sixteen. The arena mounts one per card.',
    })
  })

  it('does not let a single body outrun the rest of the page', () => {
    const heaviest = Object.entries(RENDERER_PRESETS).map(([name, preset]) => {
      const mesh = meshOf(preset.resolution)
      return { name, triangles: mesh.triangles, particles: preset.particles }
    })
    const worst = heaviest.reduce((a, b) => (a.triangles + a.particles > b.triangles + b.particles ? a : b))

    record({
      id: 'gpu_heaviest_body',
      group: 'renderer',
      label: `Heaviest body (${worst.name})`,
      value: worst.triangles + worst.particles,
      unit: 'prims',
      grade: gradeDown(worst.triangles + worst.particles, 50_000, 90_000),
      note: `${worst.triangles} triangles + ${worst.particles} particles at stage resolution.`,
    })
  })
})

describe('evaluation', () => {
  it('prints the full report and fails only when a budget is actually blown', () => {
    setHost({
      cpus: cpuList.length || 1,
      model: cpuList[0]?.model.trim() || 'unknown',
      totalMemBytes: totalmem(),
      freeMemBytes: freemem(),
      node: process.version,
      rssBytes: process.memoryUsage().rss,
    })

    const result = evaluate()
    process.stdout.write(result.report)

    expect(result.max, 'the suite recorded nothing').toBeGreaterThan(0)
    expect(result.verdict, result.report).not.toBe('bad')
  })
})
