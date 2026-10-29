/**
 * Direct session-log scanner.
 *
 * The host `sessionQuery.readSession` snapshot only exposes the tail of a large
 * session, so totals built from it come up short. Session logs on disk are the
 * ground truth: every `assistant/message` event carries the real
 * `usage` of one model call. This module walks `<dshHome>/sessions`, inflates
 * each `session.v*.jsonl.zstd` log and extracts those rows.
 *
 * Each file is cached by (mtimeMs, size), so a refresh only re-reads the session
 * that is currently being written.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import * as zlib from 'node:zlib'
import path from 'node:path'

const SESSION_FILE = /^session\.v\d+\.jsonl(\.zstd)?$/

/**
 * A session log is a *concatenation* of zstd frames, one per appended record.
 * Node's `zstdDecompressSync` stops at the first frame end unless the runtime
 * decodes concatenated frames (Node 24.22+ does, Electron 44 / Node 24.21 does
 * not), which silently truncates a 60 MB log to 221 bytes. Detect the runtime
 * once, and walk the frames ourselves when it cannot.
 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
let concatSupport

function supportsConcat() {
  if (concatSupport !== undefined) return concatSupport
  try {
    const a = zlib.zstdCompressSync(Buffer.from('a'))
    const b = zlib.zstdCompressSync(Buffer.from('b'))
    concatSupport = zlib.zstdDecompressSync(Buffer.concat([a, b])).length === 2
  } catch {
    concatSupport = false
  }
  return concatSupport
}

/**
 * Decode every frame in a concatenated zstd buffer. The magic number can also
 * occur inside compressed payloads, so a frame that fails to decode is merged
 * with the next candidate instead of being dropped.
 */
function inflateFrames(raw) {
  const parts = []
  let start = -1
  let at = raw.indexOf(ZSTD_MAGIC, 0)
  while (at !== -1) {
    if (start >= 0) parts.push(raw.subarray(start, at))
    start = at
    at = raw.indexOf(ZSTD_MAGIC, at + 4)
  }
  if (start >= 0) parts.push(raw.subarray(start))
  if (parts.length === 0) return zlib.zstdDecompressSync(raw)
  const chunks = []
  let pending = null
  for (const part of parts) {
    const buffer = pending === null ? part : Buffer.concat([pending, part])
    pending = null
    try {
      chunks.push(zlib.zstdDecompressSync(buffer))
    } catch {
      pending = buffer
    }
  }
  if (pending !== null) chunks.push(zlib.zstdDecompressSync(pending))
  return Buffer.concat(chunks)
}

function inflate(file) {
  const raw = readFileSync(file)
  if (file.endsWith('.zstd') === false) return raw
  // Node >= 22.15 ships a synchronous zstd entry point; older hosts are reported
  // as unsupported so the caller can fall back to the session snapshot.
  if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('zstd-sync-unavailable')
  if (supportsConcat()) return zlib.zstdDecompressSync(raw)
  return inflateFrames(raw)
}

function rowsFromLog(sessionId, text) {
  const rows = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    // Cheap pre-filter: most lines carry no usage at all.
    if (line.includes('"usage"') === false && line.includes('assistant/message') === false) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
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
      sessionId,
      t: Number(event.time ?? 0) || 0,
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

function listLogs(root) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (SESSION_FILE.test(entry.name)) out.push(full)
    }
  }
  walk(root, 0)
  return out
}

export function createSessionScan({ home }) {
  const root = path.join(home, 'sessions')
  /** file → { mtimeMs, size, sessionId, rows } */
  const cache = new Map()
  let supported
  let inFlight = null
  let last = { at: 0, files: 0, read: 0, reused: 0, bytes: 0, ms: 0 }

  async function scanOnce({ since = 0 } = {}) {
    const started = Date.now()
    const logs = listLogs(root)
    let read = 0
    let reused = 0
    let bytes = 0
    const rows = []
    let skipped = 0
    let index = 0
    for (const file of logs) {
      // Inflating a large log costs hundreds of milliseconds; yield regularly so
      // the host server keeps answering while an old cache is being rebuilt.
      if (index++ % 4 === 0) await new Promise((resolve) => setImmediate(resolve))
      let stat
      try {
        stat = statSync(file)
      } catch {
        continue
      }
      // A file untouched since `since` cannot hold rows inside the window.
      if (stat.mtimeMs < since) {
        skipped += 1
        continue
      }
      const sessionId = path.basename(path.dirname(file))
      const hit = cache.get(file)
      if (hit !== undefined && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
        reused += 1
        for (const row of hit.rows) if (row.t >= since) rows.push(row)
        continue
      }
      let text
      try {
        text = inflate(file).toString('utf8')
      } catch (error) {
        if (String(error?.message ?? '').startsWith('zstd-')) {
          throw error
        }
        continue
      }
      read += 1
      bytes += stat.size
      const fileRows = rowsFromLog(sessionId, text)
      cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, sessionId, rows: fileRows })
      for (const row of fileRows) if (row.t >= since) rows.push(row)
    }
    last = { at: Date.now(), files: logs.length, read, reused, skipped, bytes, ms: Date.now() - started }
    return { ...last, rows, supported }
  }

  return {
    /**
     * All usage rows newer than `since` (ms epoch).
     * Concurrent callers share one pass, so a burst of view requests is cheap.
     */
    async rows({ since = 0 } = {}) {
      if (supported === false) {
        return { ...last, rows: [], files: 0, read: 0, reused: 0, supported: false, error: 'zstd-unsupported' }
      }
      if (inFlight !== null) return inFlight
      const run = (async () => {
        try {
          const result = await scanOnce({ since })
          supported = true
          return result
        } catch (error) {
          supported = false
          return { ...last, rows: [], files: 0, read: 0, reused: 0, supported: false, error: String(error?.message ?? error) }
        }
      })()
      inFlight = run
      // Clear the handle only after this run settles; a later call may already
      // own the slot, so never clobber it.
      run.then(() => { if (inFlight === run) inFlight = null }, () => { if (inFlight === run) inFlight = null })
      return run
    },
    invalidate() {
      cache.clear()
      last = { at: 0, files: 0, read: 0, reused: 0, bytes: 0, ms: 0 }
    },
    get stats() {
      return last
    },
  }
}
