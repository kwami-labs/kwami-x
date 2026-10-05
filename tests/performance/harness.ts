/**
 * Shared recorder for the performance suite.
 *
 * Each measurement grades itself against a budget. The last test in the file
 * prints one report and fails only when something is actually `bad` — an
 * `improvable` result is a finding, not a red build. Timing budgets are
 * generous on purpose: GitHub runners drift, and a flake that is really a
 * noisy clock is worse than a slightly soft ceiling.
 */

export type Grade = 'good' | 'improvable' | 'bad'
export type Group = 'hardware' | 'bandwidth' | 'ui' | 'renderer'

export interface Metric {
  id: string
  group: Group
  label: string
  value: number
  unit: string
  grade: Grade
  /** Set when the number is a finding, not just a reading. */
  note?: string
}

export interface Sample {
  wallMs: number
  cpuMs: number
  heapDeltaBytes: number
}

const metrics: Metric[] = []

export function recorded(): readonly Metric[] {
  return metrics
}

export function record(metric: Metric): Metric {
  const existing = metrics.findIndex((m) => m.id === metric.id)
  if (existing >= 0) metrics[existing] = metric
  else metrics.push(metric)
  return metric
}

/** Lower is better. `good` / `ok` are inclusive ceilings. */
export function gradeDown(value: number, good: number, ok: number): Grade {
  if (value <= good) return 'good'
  if (value <= ok) return 'improvable'
  return 'bad'
}

/** Higher is better. `good` / `ok` are inclusive floors. */
export function gradeUp(value: number, good: number, ok: number): Grade {
  if (value >= good) return 'good'
  if (value >= ok) return 'improvable'
  return 'bad'
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function heapUsed(): number {
  return process.memoryUsage().heapUsed
}

/**
 * One timed sample of `fn`.
 *
 * Heap delta can go negative when V8 collects mid-run; callers treat that as
 * zero consume rather than as a miracle.
 */
export function sampleOnce<T>(fn: () => T): Sample & { result: T } {
  const cpuStart = process.cpuUsage()
  const heapStart = heapUsed()
  const wallStart = performance.now()
  const result = fn()
  const wallMs = performance.now() - wallStart
  const cpu = process.cpuUsage(cpuStart)
  return {
    result,
    wallMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    heapDeltaBytes: heapUsed() - heapStart,
  }
}

export function sampleMany(fn: () => void, rounds = 7, warmup = 2): Sample {
  for (let i = 0; i < warmup; i++) fn()
  const walls: number[] = []
  const cpus: number[] = []
  const heaps: number[] = []
  for (let i = 0; i < rounds; i++) {
    const s = sampleOnce(fn)
    walls.push(s.wallMs)
    cpus.push(s.cpuMs)
    heaps.push(Math.max(0, s.heapDeltaBytes))
  }
  return {
    wallMs: median(walls),
    cpuMs: median(cpus),
    heapDeltaBytes: median(heaps),
  }
}

export function bytesOf(value: unknown): number {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function formatMs(ms: number): string {
  return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} ms`
}

const SCORE: Record<Grade, number> = { good: 2, improvable: 1, bad: 0 }

export interface HostInfo {
  cpus: number
  model: string
  totalMemBytes: number
  freeMemBytes: number
  node: string
  rssBytes?: number
}

let host: HostInfo | null = null

export function setHost(info: HostInfo): void {
  host = info
}

export interface Evaluation {
  score: number
  max: number
  percent: number
  verdict: Grade
  bad: Metric[]
  improvable: Metric[]
  report: string
}

export function evaluate(list: readonly Metric[] = metrics): Evaluation {
  const max = list.length * 2
  const score = list.reduce((sum, m) => sum + SCORE[m.grade], 0)
  const percent = max === 0 ? 100 : Math.round((score / max) * 100)
  const bad = list.filter((m) => m.grade === 'bad')
  const improvable = list.filter((m) => m.grade === 'improvable')
  const verdict: Grade = bad.length > 0 ? 'bad' : improvable.length > 0 ? 'improvable' : 'good'
  return {
    score,
    max,
    percent,
    verdict,
    bad,
    improvable,
    report: formatReport(list, { score, max, percent, verdict, bad, improvable, report: '' }),
  }
}

function mark(grade: Grade): string {
  if (grade === 'good') return 'good'
  if (grade === 'improvable') return 'improvable'
  return 'BAD'
}

function formatReport(
  list: readonly Metric[],
  evaled: Pick<Evaluation, 'score' | 'max' | 'percent' | 'verdict' | 'bad' | 'improvable'>,
): string {
  const groups: Group[] = ['hardware', 'bandwidth', 'ui', 'renderer']
  const titles: Record<Group, string> = {
    hardware: 'Hardware consume',
    bandwidth: 'Bandwidth / payload',
    ui: 'UI load and render',
    renderer: 'Renderer cost',
  }

  const lines = [
    '',
    '============================================================',
    '  KWAMI PERFORMANCE EVALUATION',
    '============================================================',
  ]

  if (host) {
    const rss = host.rssBytes ? ` · process ${formatBytes(host.rssBytes)}` : ''
    lines.push(
      `  Host: ${host.cpus}× ${host.model}`,
      `        RAM ${formatBytes(host.totalMemBytes)} (${formatBytes(host.freeMemBytes)} free) · Node ${host.node}${rss}`,
    )
  }

  for (const group of groups) {
    const rows = list.filter((m) => m.group === group)
    if (rows.length === 0) continue
    lines.push('', `  ${titles[group]}`)
    for (const m of rows) {
      const value =
        m.unit === 'B'
          ? formatBytes(m.value)
          : Number.isInteger(m.value)
            ? `${m.value} ${m.unit}`
            : `${m.value.toFixed(m.value < 10 ? 2 : 1)} ${m.unit}`
      lines.push(`    [${mark(m.grade).padEnd(11)}] ${m.label}: ${value}`)
      if (m.note) lines.push(`                 ${m.note}`)
    }
  }

  const headline =
    evaled.verdict === 'good'
      ? 'GOOD — budgets hold'
      : evaled.verdict === 'improvable'
        ? 'CAN BE IMPROVED'
        : 'BAD — over budget'

  lines.push(
    '',
    '------------------------------------------------------------',
    `  Score:   ${evaled.score}/${evaled.max} (${evaled.percent}%)`,
    `  Verdict: ${headline}`,
  )

  if (evaled.bad.length > 0) {
    lines.push('', '  Must fix:')
    for (const m of evaled.bad) lines.push(`    - ${m.label}${m.note ? ` — ${m.note}` : ''}`)
  }
  if (evaled.improvable.length > 0) {
    lines.push('', '  Can be improved:')
    for (const m of evaled.improvable) lines.push(`    - ${m.label}${m.note ? ` — ${m.note}` : ''}`)
  }

  lines.push('============================================================', '')
  return lines.join('\n')
}
