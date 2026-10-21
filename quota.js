/**
 * Quota and burn-rate collection for the Model Manager.
 *
 * Three independent sources, merged per provider:
 *
 *  1. `credits.balances` on the channel-pack RPC — remaining free credits for
 *     every provider that holds a channel account (Qoder, LobsterAI, TRAE …).
 *  2. `deepseekAccount.getBalance` — the official DeepSeek wallet, which also
 *     covers the API-key route.
 *  3. Consumption: the channel-pack token ledger (per day / provider / model)
 *     plus a scan of session logs, which is the only universal source and
 *     therefore covers API-only providers such as `opencode-go`.
 *
 * Everything here is best-effort: a missing source degrades to "unknown"
 * instead of failing the page.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const DAY_MS = 24 * 60 * 60 * 1000
const LEDGER_KEY_SEP = '\u0000'

/** Multipliers some channels print in the model name (`· x0.5`, `· 免费`). */
const MULTIPLIER_PATTERN = /(?:[x×]\s*([0-9]+(?:\.[0-9]+)?))|(免费|free)/i

function homeDir() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh')
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Day key in UTC+8, matching the ledger's own bucketing. */
export function dayKey(ts) {
  const shifted = new Date(ts + 8 * 60 * 60 * 1000)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${month}-${day}`
}

/** Parse the price multiplier out of a display name; `free` wins over numbers. */
export function parseMultiplier(name) {
  const text = String(name ?? '')
  const match = MULTIPLIER_PATTERN.exec(text)
  if (match === null) return { multiplier: null, label: null, free: false }
  if (match[2] !== undefined) return { multiplier: 0, label: match[2], free: true }
  const value = Number(match[1])
  return Number.isFinite(value) ? { multiplier: value, label: `x${match[1]}`, free: value === 0 } : { multiplier: null, label: null, free: false }
}

function emptyUsage() {
  return { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, requests: 0, errors: 0 }
}

function addUsage(target, delta) {
  target.tokens += delta.tokens
  target.input += delta.input
  target.output += delta.output
  target.cacheRead += delta.cacheRead
  target.cacheWrite += delta.cacheWrite
  target.reasoning += delta.reasoning
  target.requests += delta.requests
  target.errors += delta.errors
}

export function createQuota(ctx) {
  const state = {
    ledger: { at: 0, days: new Map() },
    sessions: { at: 0, days: new Map(), partial: false },
    balances: { at: 0, byProvider: new Map() },
    wallet: { at: 0, value: null },
  }

  const connection = () => ctx.get('connection')

  /** Call one channel-pack RPC method through the shared `/api` fetch handler. */
  async function channelRpc(method, payload) {
    const service = connection()
    if (service === undefined
      || typeof service.createSharedFetchHandler !== 'function'
      || typeof service.createPeer !== 'function') {
      return { ok: false, error: { code: 'unavailable', message: 'connection service is unavailable' } }
    }
    let peer
    try {
      const handler = service.createSharedFetchHandler('/api')
      peer = service.createPeer({ principal: { kind: 'owner' }, interactions: 'none' })
      const response = await handler.fetch(new Request('http://dsh.internal/api/channel-pack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: randomUUID(),
          method: 'channel-pack',
          payload: { method, payload },
        }),
        signal: AbortSignal.timeout(20000),
      }), peer)
      if (!response.ok) {
        return { ok: false, error: { code: `http-${response.status}`, message: `channel-pack answered ${response.status}` } }
      }
      const body = await response.json()
      if (body?.result === undefined) {
        return { ok: false, error: { code: 'malformed', message: 'channel-pack result is missing' } }
      }
      return body.result
    } catch (error) {
      return { ok: false, error: { code: 'transport', message: String(error?.message ?? error) } }
    } finally {
      try {
        await peer?.dispose()
      } catch {
        // A failed peer disposal must not fail the read.
      }
    }
  }

  /** Channel accounts, read from the pack's own durable state file. */
  function accounts() {
    const raw = readJsonFile(path.join(homeDir(), 'channel-pack', 'state.json'))
    const list = Array.isArray(raw?.accounts) ? raw.accounts : []
    return list
      .filter((entry) => entry && typeof entry.provider === 'string' && entry.provider !== '')
      .map((entry) => ({
        id: String(entry.id ?? ''),
        provider: String(entry.provider),
        nickname: String(entry.nickname ?? entry.id ?? ''),
        enabled: entry.enabled !== false,
      }))
  }

  /**
   * Channel-pack token ledger: `days[day]["direct|provider|account|model"]`.
   * Aggregated to (provider, model, day) because account identity is noise here.
   */
  function readLedger() {
    const raw = readJsonFile(path.join(homeDir(), 'channel-pack', 'token-ledger.json'))
    const days = new Map()
    if (raw === null || typeof raw.days !== 'object' || raw.days === null) return days
    for (const [day, buckets] of Object.entries(raw.days)) {
      if (buckets === null || typeof buckets !== 'object') continue
      for (const [key, bucket] of Object.entries(buckets)) {
        if (bucket === null || typeof bucket !== 'object') continue
        const parts = String(key).split('|')
        if (parts.length < 4) continue
        const provider = parts[1]
        const model = parts[parts.length - 1]
        if (provider === '' || model === '') continue
        const usage = {
          tokens: 0,
          input: Number(bucket.inputTokens ?? 0) || 0,
          output: Number(bucket.outputTokens ?? 0) || 0,
          cacheRead: Number(bucket.cacheReadTokens ?? 0) || 0,
          cacheWrite: Number(bucket.cacheWriteTokens ?? 0) || 0,
          reasoning: Number(bucket.reasoningTokens ?? 0) || 0,
          requests: Number(bucket.requests ?? 0) || 0,
          errors: Number(bucket.errors ?? 0) || 0,
          tps: Number(bucket.tpsSum ?? 0) > 0 && Number(bucket.tpsCount ?? 0) > 0
            ? Math.round((Number(bucket.tpsSum) / Number(bucket.tpsCount)) * 10) / 10
            : null,
        }
        usage.tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite + usage.reasoning
        const bucketKey = `${provider}${LEDGER_KEY_SEP}${model}`
        const perDay = days.get(day) ?? new Map()
        const existing = perDay.get(bucketKey)
        if (existing === undefined) {
          perDay.set(bucketKey, { ...usage })
        } else {
          addUsage(existing, usage)
          if (existing.tps === null && usage.tps !== null) existing.tps = usage.tps
        }
        days.set(day, perDay)
      }
    }
    return days
  }

  /**
   * Universal usage source: `assistant/message` events carry the provider,
   * model and token usage of every real call, including API-only routes.
   */
  async function readSessions(daysWanted, budgetMs = 9000) {
    const query = ctx.get('sessionQuery')
    const out = new Map()
    if (query === undefined
      || typeof query.filterSessions !== 'function'
      || typeof query.readSession !== 'function') {
      return { days: out, partial: false }
    }
    const deadline = Date.now() + budgetMs
    let partial = false
    let records
    try {
      records = await query.filterSessions([{ kind: 'created-at', from: Date.now() - daysWanted * DAY_MS }])
    } catch {
      return { days: out, partial: false }
    }
    for (const record of records) {
      if (Date.now() > deadline) { partial = true; break }
      let snapshot
      try {
        snapshot = await query.readSession(record.header.id)
      } catch {
        continue
      }
      for (const event of snapshot.events ?? []) {
        if (event?.type !== 'assistant/message') continue
        const usage = event.data?.usage
        const source = event.data?.message?.source
        if (usage === undefined || source === undefined || source.kind !== 'model') continue
        const provider = String(source.provider ?? '')
        const model = String(source.model ?? '')
        if (provider === '' || model === '') continue
        const delta = {
          tokens: (Number(usage.inputTokens ?? 0) || 0)
            + (Number(usage.outputTokens ?? 0) || 0)
            + (Number(usage.cacheReadTokens ?? 0) || 0)
            + (Number(usage.cacheWriteTokens ?? 0) || 0)
            + (Number(usage.reasoningTokens ?? 0) || 0),
          input: Number(usage.inputTokens ?? 0) || 0,
          output: Number(usage.outputTokens ?? 0) || 0,
          cacheRead: Number(usage.cacheReadTokens ?? 0) || 0,
          cacheWrite: Number(usage.cacheWriteTokens ?? 0) || 0,
          reasoning: Number(usage.reasoningTokens ?? 0) || 0,
          requests: 1,
          errors: 0,
        }
        const day = dayKey(event.time ?? Date.now())
        const key = `${provider}${LEDGER_KEY_SEP}${model}`
        const perDay = out.get(day) ?? new Map()
        const existing = perDay.get(key)
        if (existing === undefined) perDay.set(key, { ...delta, tps: null })
        else addUsage(existing, delta)
        out.set(day, perDay)
      }
    }
    return { days: out, partial }
  }

  /** Merge ledger and session usage, preferring the ledger (it reports errors/tps). */
  function mergedDays(daysWanted, ledgerDays, sessionDays) {
    const cutoff = dayKey(Date.now() - (daysWanted - 1) * DAY_MS)
    const merged = new Map()
    const merge = (source, preferExisting) => {
      for (const [day, buckets] of source) {
        if (day < cutoff) continue
        const perDay = merged.get(day) ?? new Map()
        for (const [key, usage] of buckets) {
          if (perDay.has(key) && preferExisting) continue
          perDay.set(key, { ...usage })
        }
        merged.set(day, perDay)
      }
    }
    merge(ledgerDays, false)
    merge(sessionDays, true)
    return merged
  }

  /** Human-facing unit label for one provider's balance packages. */
  function unitLabel(unit) {
    const text = String(unit ?? '').toLowerCase()
    if (text === 'usd') return 'USD'
    if (text === 'token') return 'tokens'
    return '积分'
  }

  /** One account's balance object → flat, unit-aware shape. */
  function normalizeAccount(entry) {
    const accountId = String(entry?.accountId ?? '')
    const nickname = String(entry?.nickname ?? accountId)
    const raw = entry?.balance
    if (raw === null || typeof raw !== 'object') {
      return { accountId, nickname, unit: '积分', remaining: null, total: null, packages: [], error: entry?.error ?? null }
    }
    const packages = (Array.isArray(raw.packages) ? raw.packages : []).map((pkg) => ({
      name: String(pkg?.name ?? ''),
      unit: unitLabel(pkg?.unit),
      remaining: Number(pkg?.remaining ?? 0) || 0,
      total: Number(pkg?.total ?? 0) || 0,
      used: Number(pkg?.used ?? 0) || 0,
      expiredTime: typeof pkg?.expiredTime === 'string' && pkg.expiredTime !== '' ? pkg.expiredTime : null,
      deductionEndTime: typeof pkg?.deductionEndTime === 'number' ? pkg.deductionEndTime : null,
    }))
    // Mixed units are rare; the dominant (largest remaining) unit wins.
    const weights = new Map()
    for (const pkg of packages) weights.set(pkg.unit, (weights.get(pkg.unit) ?? 0) + pkg.remaining)
    let unit = '积分'
    let best = -1
    for (const [candidate, weight] of weights) {
      if (weight > best) { best = weight; unit = candidate }
    }
    const remaining = packages.length === 0
      ? Number(raw.total ?? 0) || 0
      : packages.filter((pkg) => pkg.unit === unit).reduce((sum, pkg) => sum + pkg.remaining, 0)
    return {
      accountId,
      nickname,
      unit,
      remaining,
      total: Number(raw.total ?? 0) || 0,
      expiredTotal: Number(raw.expiredTotal ?? 0) || 0,
      packages,
      error: typeof entry?.error === 'string' ? entry.error : null,
    }
  }

  /**
   * Remaining quota for one provider, through the channel pack's badge read.
   * It already joins enabled accounts, package breakdown, subscription plan and
   * the rolling window, which is what "how much is left" actually means.
   */
  async function balanceFor(provider) {
    const result = await channelRpc('usage.badge', { provider, force: true })
    const at = Date.now()
    if (result?.ok !== true) {
      return { ok: false, error: result?.error?.message ?? 'usage.badge failed', at, accounts: [] }
    }
    const value = result.value ?? {}
    const accounts = (Array.isArray(value.accounts) ? value.accounts : []).map(normalizeAccount)
    return {
      ok: true,
      at,
      accounts,
      windowDays: typeof value.windowDays === 'number' ? value.windowDays : null,
      subscription: value.subscription ?? null,
      preference: typeof value.preference === 'string' ? value.preference : null,
    }
  }

  /** DeepSeek wallet (official account); returns null when signed out. */
  async function wallet() {
    const account = ctx.get('deepseekAccount')
    if (account === undefined || typeof account.getBalance !== 'function') return null
    const metadata = {
      version: '0.2.1',
      locale: 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    }
    try {
      const result = await account.getBalance(metadata)
      if (result === null || result?.status !== 'ready') return null
      const wallets = Array.isArray(result.value) ? result.value : []
      const bonus = Array.isArray(result.bonusWallets) ? result.bonusWallets : []
      return {
        wallets: wallets.map((w) => ({ currency: String(w.currency ?? ''), balance: Number(w.balance ?? 0) || 0 })),
        bonus: bonus.map((w) => ({ currency: String(w.currency ?? ''), balance: Number(w.balance ?? 0) || 0 })),
      }
    } catch {
      return null
    }
  }

  /** Refresh balances (upstream calls); cached for five minutes. */
  async function refreshBalances(providers) {
    const withAccounts = new Set(accounts().map((entry) => entry.provider))
    const targets = providers.filter((provider) => withAccounts.has(provider))
    const started = Date.now()
    await Promise.all(targets.map(async (provider) => {
      const result = await balanceFor(provider)
      state.balances.byProvider.set(provider, result)
    }))
    state.balances.at = Date.now()
    state.wallet = { at: Date.now(), value: await wallet() }
    return {
      at: Date.now(),
      elapsedMs: Date.now() - started,
      providers: [...state.balances.byProvider.keys()],
    }
  }

  /** Cached (60s) view: no upstream calls, cheap disk + session reads. */
  async function snapshot(daysWanted) {
    const now = Date.now()
    if (now - state.ledger.at > 30_000) {
      state.ledger = { at: now, days: readLedger() }
    }
    if (now - state.sessions.at > 180_000) {
      const scan = await readSessions(daysWanted)
      state.sessions = { at: Date.now(), days: scan.days, partial: scan.partial }
    }
    const merged = mergedDays(daysWanted, state.ledger.days, state.sessions.days)
    return { merged, partial: state.sessions.partial, days: daysWanted }
  }

  return { snapshot, refreshBalances, accounts, channelRpc, balanceEntry, balanceTimestamp, walletSnapshot }

  /** Cached credit entry for one provider, or `undefined` when never queried. */
  function balanceEntry(provider) {
    return state.balances.byProvider.get(provider)
  }

  /** When the credits cache was last refreshed. */
  function balanceTimestamp() {
    return state.balances.at === 0 ? null : state.balances.at
  }

  /** Last known DeepSeek wallet, or null when it was never readable. */
  function walletSnapshot() {
    if (state.wallet.at === 0) return null
    if (state.wallet.value === null) return { wallets: [], bonus: [], at: state.wallet.at, unavailable: true }
    return { ...state.wallet.value, at: state.wallet.at }
  }
}
