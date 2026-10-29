/**
 * Session-derived usage series for the Model Manager.
 *
 * The channel ledger only aggregates whole days and only covers channel routes;
 * the session log is the one place every call is recorded (provider, model,
 * timestamp, token usage), so all five periods are computed from it here.
 *
 * Reading a session log is the expensive part (zstd + replay validation), so
 * each session's extracted usage rows are cached. Persisted sessions never
 * change again, so they are read once; only live sessions are re-read.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** UTC+8 calendar parts for one instant. */
function localParts(ts) {
  const shifted = new Date(ts + 8 * 60 * 60 * 1000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    weekday: (shifted.getUTCDay() + 6) % 7, // Monday = 0
  }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

/** Bucket key and start instant for one period. */
export function bucketOf(period, ts) {
  const parts = localParts(ts)
  switch (period) {
    case 'hour': {
      const start = Math.floor(ts / HOUR_MS) * HOUR_MS
      return { key: `${start}`, label: `${pad(parts.hour)}:00`, start }
    }
    case 'day': {
      const key = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
      const start = Date.UTC(parts.year, parts.month - 1, parts.day) - 8 * HOUR_MS
      return { key, label: `${pad(parts.month)}-${pad(parts.day)}`, start }
    }
    case 'week': {
      const dayStart = Date.UTC(parts.year, parts.month - 1, parts.day) - 8 * HOUR_MS
      const start = dayStart - parts.weekday * DAY_MS
      const week = localParts(start)
      return { key: `${week.year}-W${Math.ceil((((start + 8 * HOUR_MS) - Date.UTC(week.year, 0, 1)) / DAY_MS + 1) / 7)}`, label: `${pad(week.month)}-${pad(week.day)}`, start }
    }
    case 'half': {
      const first = parts.day <= 15
      const start = Date.UTC(parts.year, parts.month - 1, first ? 1 : 16) - 8 * HOUR_MS
      const key = `${parts.year}-${pad(parts.month)}-${first ? 'A' : 'B'}`
      return { key, label: `${pad(parts.month)}-${first ? '01' : '16'}`, start }
    }
    case 'month': {
      const start = Date.UTC(parts.year, parts.month - 1, 1) - 8 * HOUR_MS
      return { key: `${parts.year}-${pad(parts.month)}`, label: `${parts.year}-${pad(parts.month)}`, start }
    }
    default: {
      const start = Math.floor(ts / HOUR_MS) * HOUR_MS
      return { key: `${start}`, label: `${pad(parts.hour)}:00`, start }
    }
  }
}

const PERIODS = ['hour', 'day', 'week', 'half', 'month']

/** Start instant of the bucket after `start` for one period. */
function nextStart(period, start) {
  switch (period) {
    case 'hour': return start + HOUR_MS
    case 'day': return start + DAY_MS
    case 'week': return start + 7 * DAY_MS
    case 'half':
    case 'month': {
      const parts = localParts(start)
      if (period === 'half' && parts.day === 1) return Date.UTC(parts.year, parts.month - 1, 16) - 8 * HOUR_MS
      return Date.UTC(parts.year, parts.month, 1) - 8 * HOUR_MS
    }
    default: return start + HOUR_MS
  }
}

/** Every bucket start inside `[from, to]`, including empty ones. */
function bucketStarts(period, from, to) {
  const list = []
  let cursor = bucketOf(period, from).start
  for (let guard = 0; guard < 4000 && cursor <= to; guard += 1) {
    list.push(cursor)
    const next = nextStart(period, cursor)
    if (next <= cursor) break
    cursor = next
  }
  return list
}

/** One source of usage rows, refreshed on demand. */
export function createUsage(ctx, scan) {
  /** sessionId → { events: [{t, provider, model, tokens, input, output, cacheRead, reasoning}], partial } */
  const cache = new Map()
  let lastRefresh = 0
  let lastPartial = false
  let lastSource = { kind: 'none' }

  function extract(snapshot) {
    const rows = []
    for (const event of snapshot.events ?? []) {
      if (event?.type !== 'assistant/message') continue
      const usage = event.data?.usage
      const source = event.data?.message?.source
      if (usage === undefined || source === undefined || source.kind !== 'model') continue
      const provider = String(source.provider ?? '')
      const model = String(source.model ?? '')
      if (provider === '' || model === '') continue
      const input = Number(usage.inputTokens ?? 0) || 0
      const output = Number(usage.outputTokens ?? 0) || 0
      const cacheRead = Number(usage.cacheReadTokens ?? 0) || 0
      const cacheWrite = Number(usage.cacheWriteTokens ?? 0) || 0
      const reasoning = Number(usage.reasoningTokens ?? 0) || 0
      rows.push({
        t: Number(event.time ?? 0) || Date.now(),
        provider,
        model,
        input,
        output,
        cacheRead,
        cacheWrite,
        reasoning,
        tokens: input + output + cacheRead + cacheWrite + reasoning,
      })
    }
    return rows
  }

  /** Read every session in the window, re-reading only live or unseen ones. */
  async function refresh(days, budgetMs = 12000) {
    const since = Date.now() - days * DAY_MS
    if (scan !== undefined) {
      const result = await scan.rows({ since })
      if (result.supported !== false) {
        cache.clear()
        for (const row of result.rows) {
          const entry = cache.get(row.sessionId)
          if (entry === undefined) cache.set(row.sessionId, { events: [row], live: false })
          else entry.events.push(row)
        }
        lastRefresh = Date.now()
        lastPartial = false
        let newest = 0
        let oldest = 0
        for (const row of result.rows) {
          if (newest === 0 || row.t > newest) newest = row.t
          if (oldest === 0 || row.t < oldest) oldest = row.t
        }
        lastSource = {
          kind: 'logs',
          since,
          newest,
          oldest,
          files: result.files,
          read: result.read,
          reused: result.reused,
          skipped: result.skipped ?? 0,
          bytes: result.bytes,
          ms: result.ms,
          requests: result.rows.length,
        }
        return { available: true, partial: false, sessions: cache.size, source: lastSource }
      }
      lastSource = { kind: 'logs-unavailable', error: result.error ?? null }
    }
    const query = ctx.get('sessionQuery')
    if (query === undefined || typeof query.filterSessions !== 'function' || typeof query.readSession !== 'function') {
      return { available: false }
    }
    const deadline = Date.now() + budgetMs
    let partial = false
    let records
    try {
      records = await query.filterSessions([{ kind: 'created-at', from: Date.now() - days * DAY_MS }])
    } catch {
      return { available: false }
    }
    for (const record of records) {
      const id = String(record.header?.id ?? '')
      if (id === '') continue
      const cached = cache.get(id)
      if (cached !== undefined && record.persisted === true && record.live !== true) continue
      if (Date.now() > deadline) { partial = true; break }
      try {
        const snapshot = await query.readSession(record.header.id)
        cache.set(id, { events: extract(snapshot), live: record.live === true })
      } catch {
        if (cached === undefined) cache.set(id, { events: [], live: false })
      }
    }
    lastRefresh = Date.now()
    lastPartial = partial
    lastSource = { kind: 'snapshot', sessions: records.length }
    return { available: true, partial, sessions: records.length, source: lastSource }
  }

  /**
   * Bucketed series for one window. `provider` narrows to one route; `models`
   * keeps the per-model split inside each bucket so the UI can rank them.
   */
  function series({ days = 30, provider = null, moment = Date.now() } = {}) {
    const since = moment - days * DAY_MS
    const buckets = Object.fromEntries(PERIODS.map((period) => [period, new Map()]))
    const totals = { tokens: 0, requests: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0 }
    const byModel = new Map()
    for (const entry of cache.values()) {
      for (const row of entry.events) {
        if (row.t < since) continue
        if (provider !== null && row.provider !== provider) continue
        totals.tokens += row.tokens
        totals.requests += 1
        totals.input += row.input
        totals.output += row.output
        totals.cacheRead += row.cacheRead
        totals.reasoning += row.reasoning
        const modelKey = `${row.provider}/${row.model}`
        const modelAgg = byModel.get(modelKey) ?? { provider: row.provider, model: row.model, tokens: 0, requests: 0, cost: 0 }
        modelAgg.tokens += row.tokens
        modelAgg.requests += 1
        byModel.set(modelKey, modelAgg)
        for (const period of PERIODS) {
          const bucket = bucketOf(period, row.t)
          const perBucket = buckets[period]
          const current = perBucket.get(bucket.key) ?? {
            key: bucket.key, label: bucket.label, start: bucket.start,
            tokens: 0, requests: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0,
            models: new Map(),
          }
          current.tokens += row.tokens
          current.requests += 1
          current.input += row.input
          current.output += row.output
          current.cacheRead += row.cacheRead
          current.reasoning += row.reasoning
          current.models.set(modelKey, (current.models.get(modelKey) ?? 0) + row.tokens)
          perBucket.set(bucket.key, current)
        }
      }
    }
    const output = {}
    for (const period of PERIODS) {
      const filled = buckets[period]
      // Emit empty buckets too, so hourly/weekly/monthly axes stay continuous.
      for (const start of bucketStarts(period, since, moment)) {
        const bucket = bucketOf(period, start)
        if (filled.has(bucket.key)) continue
        filled.set(bucket.key, {
          key: bucket.key, label: bucket.label, start: bucket.start,
          tokens: 0, requests: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0,
          models: new Map(),
        })
      }
      output[period] = [...filled.values()]
        .sort((a, b) => a.start - b.start)
        .map((bucket) => ({
          key: bucket.key,
          label: bucket.label,
          start: bucket.start,
          tokens: bucket.tokens,
          requests: bucket.requests,
          input: bucket.input,
          output: bucket.output,
          cacheRead: bucket.cacheRead,
          reasoning: bucket.reasoning,
          models: [...bucket.models.entries()]
            .map(([key, tokens]) => ({ key, tokens }))
            .sort((a, b) => b.tokens - a.tokens)
            .slice(0, 6),
        }))
    }
    return {
      days,
      provider,
      generatedAt: moment,
      at: lastRefresh,
      partial: lastPartial,
      source: lastSource,
      totals,
      models: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
      buckets: output,
    }
  }

  /** Drop cached rows so the next read re-extracts everything. */
  function invalidate() {
    cache.clear()
    lastRefresh = 0
  }

  return { refresh, series, invalidate }
}
