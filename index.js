/**
 * Host half of the Model & Provider Manager bundle.
 *
 * The page itself is a Client module; this half owns one small same-origin JSON
 * API under `/api/model-manager` because the model catalog lives in Host
 * services (`llm`, `agentDefaultModel`) that a browser half cannot read.
 *
 * Routes:
 *   GET  /api/model-manager/summary              providers + current default
 *   GET  /api/model-manager/models?provider=...  one provider's catalog
 *   POST /api/model-manager/default              set the default selection
 *   GET  /api/model-manager/quota?days=7         remaining credits + burn rate
 *   POST /api/model-manager/quota/refresh        re-query upstream balances
 *
 * Every route is fenced the way the kernel fences its own `/api` routes: the
 * connection service's admission when the composition mounts it, otherwise a
 * structural check (loopback host, no cross-site fetch, Origin/Referer match).
 */

import { createQuota, dayKey, parseMultiplier } from './quota.js'

const PREFIX = '/api/model-manager'
const MAX_BODY_BYTES = 64 * 1024
const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])

/** The Host must mount `llm`; everything else is optional at runtime. */
export const inject = ['llm']

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function apply(ctx) {
  const llm = () => ctx.llm
  const connection = () => ctx.get('connection')
  const defaultModel = () => ctx.get('agentDefaultModel')
  const quota = createQuota(ctx)
  /** provider id → Map(model id → { name, multiplier, label, free }) */
  const nameCache = new Map()

  ctx.inject(['webServer'], (scoped) => {
    const server = scoped.webServer
    scoped.effect(
      () => server.register({
        kind: 'prefix',
        path: PREFIX,
        handler: (req, res) => { void handle(req, res) },
      }),
      'model-manager: api routes',
    )
  })

  async function handle(req, res) {
    try {
      const rejection = rejectionFor(req, connection())
      if (rejection !== undefined) {
        fail(res, rejection, 'forbidden', rejection === 401 ? 'Authentication required' : 'Request rejected')
        return
      }
      const url = new URL(req.url ?? PREFIX, 'http://localhost')
      const tail = url.pathname.slice(PREFIX.length) || '/'
      if (req.method === 'GET' && tail === '/summary') return send(res, 200, await summary())
      if (req.method === 'GET' && tail === '/models') return send(res, 200, await models(url))
      if (req.method === 'POST' && tail === '/default') return send(res, 200, await setDefault(req))
      if (req.method === 'GET' && tail === '/quota') return send(res, 200, await quotaView(url))
      if (req.method === 'POST' && tail === '/quota/refresh') return send(res, 200, await refreshQuota())
      fail(res, 404, 'not-found', 'Unknown route')
    } catch (error) {
      if (error instanceof HttpError) fail(res, error.status, error.code, error.message)
      else fail(res, 500, 'internal', String(error?.message ?? error))
    }
  }

  /** Providers from both the adapter registry and the configurable directory. */
  function providerList() {
    const service = llm()
    const registered = service.listProviders()
    const directory = service.listConfigurableProviders()
    const rows = new Map()
    for (const info of registered) {
      rows.set(info.id, { id: info.id, name: info.name || info.id, registered: true, directory: null })
    }
    for (const entry of directory) {
      const row = rows.get(entry.provider) ?? {
        id: entry.provider,
        name: entry.displayName || entry.provider,
        registered: false,
        directory: null,
      }
      row.directory = {
        displayName: entry.displayName ?? null,
        settingsNs: entry.settingsNs ?? null,
        settingsPath: Array.isArray(entry.settingsPath) ? [...entry.settingsPath] : [],
        declared: entry.declared === true,
        defaultBaseURL: entry.defaultBaseURL ?? null,
        baseURLEnv: Array.isArray(entry.baseURLEnv) ? [...entry.baseURLEnv] : [],
        nativeAuth: entry.nativeAuth === undefined ? null : {
          env: Array.isArray(entry.nativeAuth?.env) ? [...entry.nativeAuth.env] : [],
          oauth: entry.nativeAuth?.oauth === true,
        },
        error: entry.error ?? null,
      }
      if (entry.displayName) row.name = entry.displayName
      rows.set(entry.provider, row)
    }
    return [...rows.values()].sort((a, b) =>
      Number(b.registered) - Number(a.registered) || String(a.name).localeCompare(String(b.name)))
  }

  async function summary() {
    const providers = providerList()
    const owner = defaultModel()
    let current = null
    try {
      current = owner?.currentSelection() ?? null
    } catch {
      current = null
    }
    return { ok: true, value: { providers, default: current, generatedAt: Date.now() } }
  }

  /** Display names (with the price multiplier some channels print) per provider. */
  async function catalogNames(providers) {
    const missing = providers.filter((provider) => !nameCache.has(provider.id))
    if (missing.length > 0) {
      await Promise.all(missing.map(async (provider) => {
        try {
          const list = await llm().listModels(provider.id)
          nameCache.set(provider.id, new Map(list.map((info) => {
            const name = info.name || info.id
            return [info.id, { name, ...parseMultiplier(name) }]
          })))
        } catch {
          nameCache.set(provider.id, new Map())
        }
      }))
    }
  }

  /**
   * Remaining quota plus per-model burn, merged across every provider that has
   * either a channel account, a wallet, or recorded usage.
   */
  async function quotaView(url) {
    const raw = Number(url.searchParams.get('days') ?? 7)
    const days = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 90) : 7
    const providers = providerList()
    const registered = new Set(providers.filter((provider) => provider.registered).map((provider) => provider.id))
    const byId = new Map(providers.map((provider) => [provider.id, provider]))

    const accountList = quota.accounts()
    const providersWithAccounts = new Set(accountList.map((entry) => entry.provider))
    const { merged, partial } = await quota.snapshot(days)
    await catalogNames([...new Set([...merged.values()].flatMap((perDay) => [...perDay.keys()].map((key) => key.split('\u0000')[0])))].map((id) => byId.get(id) ?? { id }))

    const today = dayKey(Date.now())
    const seen = new Map()
    for (const [day, buckets] of merged) {
      for (const [key, usage] of buckets) {
        const [providerId, model] = key.split('\u0000')
        let perModel = seen.get(key)
        if (perModel === undefined) {
          perModel = {
            provider: providerId,
            model,
            usage: { tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, requests: 0, errors: 0 },
            today: { tokens: 0, requests: 0 },
            tpsSum: 0,
            tpsWeight: 0,
          }
          seen.set(key, perModel)
        }
        perModel.usage.tokens += usage.tokens
        perModel.usage.input += usage.input
        perModel.usage.output += usage.output
        perModel.usage.cacheRead += usage.cacheRead
        perModel.usage.cacheWrite += usage.cacheWrite
        perModel.usage.reasoning += usage.reasoning
        perModel.usage.requests += usage.requests
        perModel.usage.errors += usage.errors
        if (day === today) {
          perModel.today.tokens += usage.tokens
          perModel.today.requests += usage.requests
        }
        if (usage.tps !== null && usage.tps !== undefined) {
          perModel.tpsSum += usage.tps * Math.max(1, usage.requests)
          perModel.tpsWeight += Math.max(1, usage.requests)
        }
      }
    }

    const models = []
    const providerUsage = new Map()
    for (const entry of seen.values()) {
      const info = nameCache.get(entry.provider)?.get(entry.model)
      const name = info?.name ?? entry.model
      const multiplier = info?.multiplier ?? null
      const free = info?.free === true
      const weight = free ? 0 : multiplier === null ? 1 : multiplier
      const weighted = entry.usage.tokens * weight
      const row = {
        provider: entry.provider,
        providerName: byId.get(entry.provider)?.name ?? entry.provider,
        model: entry.model,
        name,
        label: info?.label ?? null,
        multiplier,
        free,
        tokens: entry.usage.tokens,
        requests: entry.usage.requests,
        errors: entry.usage.errors,
        input: entry.usage.input,
        output: entry.usage.output,
        cacheRead: entry.usage.cacheRead,
        reasoning: entry.usage.reasoning,
        todayTokens: entry.today.tokens,
        todayRequests: entry.today.requests,
        tps: entry.tpsWeight > 0 ? Math.round((entry.tpsSum / entry.tpsWeight) * 10) / 10 : null,
        weighted,
        tokensPerDay: Math.round(entry.usage.tokens / days),
        weightedPerDay: Math.round(weighted / days * 100) / 100,
      }
      models.push(row)
      const aggregate = providerUsage.get(entry.provider) ?? {
        tokens: 0, requests: 0, weighted: 0, todayTokens: 0, todayRequests: 0, models: [],
      }
      aggregate.tokens += row.tokens
      aggregate.requests += row.requests
      aggregate.weighted += row.weighted
      aggregate.todayTokens += row.todayTokens
      aggregate.todayRequests += row.todayRequests
      aggregate.models.push(row)
      providerUsage.set(entry.provider, aggregate)
    }
    models.sort((a, b) => b.weightedPerDay - a.weightedPerDay || b.tokens - a.tokens)

    const wallet = walletView()
    const value = []
    for (const provider of providers) {
      const aggregate = providerUsage.get(provider.id)
      const quotaInfo = quotaFor(provider, providersWithAccounts, wallet)
      const elapsed = Math.max(1, days)
      const burn = {
        tokensPerDay: aggregate === undefined ? 0 : Math.round(aggregate.tokens / elapsed),
        weightedPerDay: aggregate === undefined ? 0 : Math.round(aggregate.weighted / elapsed * 100) / 100,
        todayTokens: aggregate === undefined ? 0 : aggregate.todayTokens,
        runwayDays: null,
      }
      // Only a token-denominated balance converts into a day count; credit
      // balances and wallets have no honest exchange rate to tokens.
      if (quotaInfo.kind === 'credits' && quotaInfo.unit === 'tokens' && quotaInfo.remaining !== null && burn.tokensPerDay > 0) {
        burn.runwayDays = Math.round((quotaInfo.remaining / burn.tokensPerDay) * 10) / 10
      }
      if (aggregate === undefined && quotaInfo.kind === 'none') continue
      value.push({
        id: provider.id,
        name: provider.name,
        registered: registered.has(provider.id),
        quota: quotaInfo,
        usage: aggregate === undefined ? null : {
          tokens: aggregate.tokens,
          requests: aggregate.requests,
          weighted: aggregate.weighted,
          todayTokens: aggregate.todayTokens,
          todayRequests: aggregate.todayRequests,
          models: aggregate.models.sort((a, b) => b.tokens - a.tokens),
        },
        burn,
      })
    }
    value.sort((a, b) => Number(b.registered) - Number(a.registered) || b.burn.weightedPerDay - a.burn.weightedPerDay)

    const totals = value.reduce((sum, provider) => {
      sum.tokens += provider.usage?.tokens ?? 0
      sum.requests += provider.usage?.requests ?? 0
      sum.todayTokens += provider.usage?.todayTokens ?? 0
      return sum
    }, { tokens: 0, requests: 0, todayTokens: 0 })

    return {
      ok: true,
      value: {
        generatedAt: Date.now(),
        days,
        partial,
        wallet,
        balancesAt: quotaBalanceTimestamp(),
        accounts: accountList.length,
        totals,
        providers: value,
        models,
      },
    }
  }

  function quotaBalanceTimestamp() {
    return quota.balanceTimestamp()
  }

  function walletView() {
    return quota.walletSnapshot()
  }

  /** Attach the best available quota source to one provider. */
  function quotaFor(provider, providersWithAccounts, wallet) {
    const balance = quota.balanceEntry(provider.id)
    // The wallet belongs to the platform account once; the OAuth route and the
    // API-key route both spend it, so only the primary row shows the balance.
    if (provider.id === 'deepseek-official') {
      const wallets = wallet?.wallets ?? []
      const bonus = wallet?.bonus ?? []
      const remaining = wallets.length === 0 ? null : wallets.reduce((sum, entry) => sum + entry.balance, 0)
      return {
        kind: 'wallet',
        remaining,
        currency: wallets.length === 0 ? null : wallets[0].currency,
        bonus: bonus.reduce((sum, entry) => sum + entry.balance, 0),
        accounts: [],
        at: wallet === null ? null : wallet.at,
        error: wallet === null ? 'not-queried' : wallet.unavailable === true ? 'not-signed-in' : null,
        source: 'deepseek-account',
      }
    }
    if (providersWithAccounts.has(provider.id)) {
      if (balance === undefined) {
        return { kind: 'unknown', remaining: null, unit: '积分', currency: '积分', accounts: [], packages: [], at: null, error: 'not-queried', source: 'channel-pack' }
      }
      if (balance.ok !== true) {
        return { kind: 'unknown', remaining: null, unit: '积分', currency: '积分', accounts: [], packages: [], at: balance.at, error: balance.error, source: 'channel-pack' }
      }
      const accounts = balance.accounts
      const usable = accounts.filter((entry) => entry.remaining !== null)
      const weights = new Map()
      for (const entry of usable) weights.set(entry.unit, (weights.get(entry.unit) ?? 0) + entry.remaining)
      let unit = '积分'
      let best = -1
      for (const [candidate, weight] of weights) {
        if (weight > best) { best = weight; unit = candidate }
      }
      const remaining = usable.length === 0
        ? null
        : usable.filter((entry) => entry.unit === unit).reduce((sum, entry) => sum + entry.remaining, 0)
      const packages = accounts.flatMap((entry) => entry.packages.map((pkg) => ({
        ...pkg,
        account: entry.nickname,
      })))
      return {
        kind: 'credits',
        remaining,
        unit,
        currency: unit,
        accounts: accounts.map((entry) => ({
          accountId: entry.accountId,
          nickname: entry.nickname,
          unit: entry.unit,
          remaining: entry.remaining,
          total: entry.total,
          error: entry.error,
        })),
        packages,
        windowDays: balance.windowDays ?? null,
        subscription: balance.subscription ?? null,
        at: balance.at,
        error: accounts.length === 0 ? 'no-accounts' : usable.length === 0 ? accounts[0].error ?? 'no-balance' : null,
        source: 'channel-pack',
      }
    }
    return provider.registered
      ? { kind: 'api', remaining: null, currency: null, accounts: [], at: null, error: null, source: 'none' }
      : { kind: 'none', remaining: null, currency: null, accounts: [], at: null, error: null, source: 'none' }
  }
  /** Re-query upstream balances, then answer the refreshed view. */
  async function refreshQuota() {
    const providers = providerList().map((provider) => provider.id)
    const result = await quota.refreshBalances(providers)
    return {
      ok: true,
      value: {
        at: result.at,
        elapsedMs: result.elapsedMs,
        queried: result.providers,
        wallet: walletView(),
      },
    }
  }

  /** One provider's advertised models; dormant routes answer `not-active`. */
  async function models(url) {
    const provider = url.searchParams.get('provider') ?? ''
    if (provider === '') throw new HttpError(400, 'invalid-request', 'provider is required')
    const service = llm()
    let infos
    try {
      infos = await service.listModels(provider)
    } catch (error) {
      const code = error?.code ?? ''
      if (code === 'NO_ADAPTER' || code === 'NO_ROUTE') {
        throw new HttpError(409, 'not-active', 'This provider is not active (no adapter is registered)')
      }
      throw error
    }
    const list = infos.map((info) => ({
      id: info.id,
      name: info.name || info.id,
      description: info.description ?? null,
      inputModalities: Array.isArray(info.inputModalities) ? [...info.inputModalities] : [],
    }))
    return { ok: true, value: { provider, models: list } }
  }

  /** Persist one default selection after checking the route and its catalog. */
  async function setDefault(req) {
    const body = await readJson(req)
    const provider = typeof body?.provider === 'string' ? body.provider : ''
    const model = typeof body?.model === 'string' ? body.model : ''
    const effort = typeof body?.reasoningEffort === 'string' && body.reasoningEffort !== ''
      ? body.reasoningEffort
      : undefined
    if (provider === '' || model === '') throw new HttpError(400, 'invalid-request', 'provider and model are required')
    const service = llm()
    const registered = service.listProviders().map((info) => info.id)
    if (!registered.includes(provider)) throw new HttpError(409, 'not-active', 'This provider is not registered')
    const catalog = await service.listModels(provider)
    if (!catalog.some((info) => info.id === model)) {
      throw new HttpError(409, 'not-in-catalog', 'This model is not in the provider catalog')
    }
    const owner = defaultModel()
    if (owner === undefined) throw new HttpError(503, 'unavailable', 'Default model service is unavailable')
    await owner.saveSelection(effort === undefined
      ? { provider, model }
      : { provider, model, reasoningEffort: effort })
    return { ok: true, value: { default: owner.currentSelection() } }
  }
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function fail(res, status, code, message) {
  send(res, status, { ok: false, error: { code, message } })
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'too-large', 'Request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text.trim() === '' ? {} : JSON.parse(text))
      } catch {
        reject(new HttpError(400, 'invalid-json', 'Request body is not valid JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** Decide one request: an HTTP status to reject with, or `undefined` to allow. */
function rejectionFor(req, connection) {
  let decision
  try {
    const admit = connection?.admit
    if (typeof admit === 'function') {
      const admission = admit.call(connection, req)
      const status = admission && typeof admission === 'object' ? admission.rejection : undefined
      if (status === undefined) return undefined
      decision = status
    } else {
      const reject = connection?.requestRejection
      if (typeof reject === 'function') {
        const status = reject.call(connection, req)
        if (status === undefined) return undefined
        decision = status
      }
    }
  } catch {
    return 503
  }
  if (decision !== undefined) return decision
  return structuralRejection(req)
}

/** Loopback-only, no cross-site fetch, and an Origin/Referer authority match. */
function structuralRejection(req) {
  const host = authorityOf(req.headers.host, 'http')
  if (host === null || !LOOPBACK_NAMES.has(host.hostname)) return 403
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  if (site === 'cross-site') return 403
  for (const header of ['origin', 'referer']) {
    const raw = req.headers[header]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    if (header === 'referer' && isDesktopRelayReferer(raw)) {
      if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) return 403
      continue
    }
    const authority = authorityOf(raw.trim())
    if (authority === null) return 403
    if (authority.scheme !== host.scheme || authority.hostname !== host.hostname || authority.port !== host.port) return 403
  }
  return undefined
}

/** Only the owned application page, never arbitrary custom-protocol pages. */
function isDesktopRelayReferer(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'dsh-app:' && url.hostname === 'app' && url.port === ''
      && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function authorityOf(value, defaultScheme) {
  if (typeof value !== 'string' || value.trim() === '') return null
  let url
  try {
    url = new URL(value.includes('://') ? value.trim() : `${defaultScheme ?? 'http'}://${value.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  return { scheme: url.protocol.replace(':', ''), hostname: url.hostname.toLowerCase(), port }
}
