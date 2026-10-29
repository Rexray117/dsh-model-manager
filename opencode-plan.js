/**
 * opencode Go plan usage.
 *
 * The plan meters each key in rolling / weekly / monthly windows and exposes the
 * percentages at `GET /zen/go/v1/usage`. Local session logs can only measure the
 * token traffic of this machine, so the plan view is the only honest source for
 * "how much of the plan is left".
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

const ENDPOINT = 'https://opencode.ai/zen/go/v1/usage'
const CACHE_MS = 5 * 60 * 1000
const TIMEOUT_MS = 15000
const WINDOWS = [
  { key: 'rolling', label: '滚动窗口' },
  { key: 'weekly', label: '本周' },
  { key: 'monthly', label: '本月' },
]

/** Read a flat `KEY: value` entry out of the host credential file. */
export function readApiKey(home, name = 'OPENCODE_GO_API_KEY') {
  if (typeof process.env[name] === 'string' && process.env[name] !== '') return process.env[name]
  let text
  try {
    text = readFileSync(path.join(home, '.credentials.yaml'), 'utf8')
  } catch {
    return null
  }
  const matcher = new RegExp(`^\\s+${name}:\\s*(.+)$`, 'm')
  const match = text.match(matcher)
  if (match === null) return null
  const value = match[1].trim().replace(/^['"]|['"]$/g, '')
  if (value === '' || value.endsWith(':') === true) return null
  return value
}

function normalize(payload) {
  const usage = payload?.usage ?? payload?.data?.usage ?? payload?.data ?? payload
  const windows = []
  for (const { key, label } of WINDOWS) {
    const entry = usage?.[key]
    if (entry === undefined || entry === null) continue
    const percent = Number(entry.percent ?? entry.used_percent ?? entry.usedPercent)
    if (Number.isFinite(percent) === false) continue
    windows.push({
      key,
      label,
      percent: Math.max(0, Math.min(100, Math.round(percent * 10) / 10)),
      remaining: Math.max(0, Math.round((100 - percent) * 10) / 10),
      status: typeof entry.status === 'string' ? entry.status : null,
      resetsAt: typeof entry.resetsAt === 'string' ? entry.resetsAt : typeof entry.resets_at === 'string' ? entry.resets_at : null,
    })
  }
  return windows
}

export function createPlanUsage({ home, fetchImpl = globalThis.fetch }) {
  let cached = null
  let inFlight = null

  async function query() {
    const key = readApiKey(home)
    if (key === null) {
      return { ok: false, at: Date.now(), windows: [], error: 'no-credential', endpoint: ENDPOINT }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'GET',
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: controller.signal,
      })
      const body = await response.json().catch(() => null)
      if (response.ok !== true) {
        return { ok: false, at: Date.now(), windows: [], error: `http-${response.status}`, body: body === null ? null : JSON.stringify(body).slice(0, 300), endpoint: ENDPOINT }
      }
      const windows = normalize(body)
      return {
        ok: windows.length > 0,
        at: Date.now(),
        windows,
        error: windows.length > 0 ? null : 'empty-response',
        endpoint: ENDPOINT,
      }
    } catch (error) {
      const aborted = error?.name === 'AbortError'
      return { ok: false, at: Date.now(), windows: [], error: aborted ? 'timeout' : String(error?.message ?? error), endpoint: ENDPOINT }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    /** Latest plan percentages; cached for five minutes unless `force`. */
    async snapshot({ force = false } = {}) {
      if (force !== true && cached !== null && Date.now() - cached.at < CACHE_MS) return cached
      if (inFlight !== null) return inFlight
      inFlight = query()
        .catch((error) => ({ ok: false, at: Date.now(), windows: [], error: String(error?.message ?? error), endpoint: ENDPOINT }))
        .then((result) => {
          cached = result
          inFlight = null
          return result
        })
      return inFlight
    },
    invalidate() {
      cached = null
    },
  }
}
