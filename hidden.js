/**
 * Model visibility (hide/show) for the Model Manager.
 *
 * Two mechanisms exist, chosen per provider:
 *
 *  - `channel`: the channel pack owns the catalog and already renders a
 *    "disabled" state that its adapters filter out of `listModels`, so the
 *    conversation picker stops offering those models immediately.
 *  - `config`: a pi-ai route's catalog is its installed catalog; a `models`
 *    allowlist on the route replaces it wholesale, which is the only supported
 *    way to narrow it. Written through the profile config editor.
 *
 * Providers that match neither keep a local-only list; it filters this page but
 * cannot reach the picker, and the UI says so.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PI_AI_ENTRY = '@deepseek-ai/dsh-pi-ai'
const PI_AI_NAMES = new Set(['@deepseek-ai/dsh-llm-pi-ai'])
const LOCAL_FILE = 'model-manager-hidden.json'

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function createHidden(ctx, channelRpc, homeDir, readChannelState) {
  const localPath = path.join(homeDir, 'model-manager', LOCAL_FILE)

  function readLocal() {
    const raw = readJson(localPath, null)
    if (raw === null || typeof raw !== 'object' || raw.providers === null || typeof raw.providers !== 'object') {
      return { providers: {} }
    }
    return { providers: raw.providers }
  }

  function writeLocal(next) {
    mkdirSync(path.dirname(localPath), { recursive: true })
    writeFileSync(localPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  }

  /** Providers the channel pack manages: it has accounts or disabled entries. */
  function packProviders() {
    const state = readChannelState()
    const set = new Set()
    if (Array.isArray(state?.accounts)) for (const account of state.accounts) if (typeof account?.provider === 'string') set.add(account.provider)
    if (state?.disabledModels !== null && typeof state?.disabledModels === 'object') {
      for (const provider of Object.keys(state.disabledModels)) set.add(provider)
    }
    return set
  }

  function piAiEntry() {
    const editor = ctx.get('configEditor')
    if (editor === undefined || typeof editor.entries !== 'function') return undefined
    try {
      return editor.entries().find((entry) => {
        const name = entry?.options?.name
        const id = entry?.options?.id
        return PI_AI_NAMES.has(name) || name === PI_AI_ENTRY || id === 'llm-pi-ai'
      })
    } catch {
      return undefined
    }
  }

  /** Which mechanism applies, given the provider's directory entry. */
  function mechanismFor(provider, settingsNs) {
    if (piAiEntry() !== undefined && settingsNs === 'llm-pi-ai') return 'config'
    if (packProviders().has(provider)) return 'channel'
    return 'local'
  }

  /** Currently hidden model ids for one provider. */
  function hiddenOf(provider, mechanism, catalogIds) {
    if (mechanism === 'channel') {
      const state = readChannelState()
      const map = state?.disabledModels?.[provider]
      if (map === null || typeof map !== 'object') return []
      return Object.keys(map).filter((id) => map[id] === true)
    }
    if (mechanism === 'config') {
      const entry = piAiEntry()
      const profile = entry?.options?.config?.providers?.[provider]
      if (profile === null || typeof profile !== 'object' || !Array.isArray(profile.models)) return []
      const kept = new Set(profile.models.map((model) => model?.id).filter((id) => typeof id === 'string'))
      return catalogIds.filter((id) => !kept.has(id))
    }
    const local = readLocal().providers[provider]
    return Array.isArray(local) ? local.filter((id) => catalogIds.includes(id)) : []
  }

  /** Apply one provider's hidden set; returns the resulting hidden ids. */
  async function setHidden(provider, hidden, mechanism, catalogIds) {
    const wanted = [...new Set(hidden.filter((id) => typeof id === 'string' && catalogIds.includes(id)))]
    if (mechanism === 'channel') {
      const state = readChannelState()
      const map = state?.disabledModels?.[provider] ?? {}
      const current = Object.keys(map).filter((id) => map[id] === true)
      const disable = wanted.filter((id) => !current.includes(id))
      const enable = current.filter((id) => !wanted.includes(id))
      if (disable.length > 0) {
        const result = await channelRpc('model.setDisabledMany', { provider, modelIds: disable, disabled: true })
        if (result?.ok !== true) throw new Error(result?.error?.message ?? 'channel-pack refused the change')
      }
      if (enable.length > 0) {
        const result = await channelRpc('model.setDisabledMany', { provider, modelIds: enable, disabled: false })
        if (result?.ok !== true) throw new Error(result?.error?.message ?? 'channel-pack refused the change')
      }
      return wanted
    }
    if (mechanism === 'config') {
      const editor = ctx.get('configEditor')
      const entry = piAiEntry()
      if (editor === undefined || entry === undefined) throw new Error('configuration editor is unavailable')
      const current = entry.options?.config ?? {}
      const providers = { ...(current.providers ?? {}) }
      const profile = { ...(providers[provider] ?? {}) }
      const keep = catalogIds.filter((id) => !wanted.includes(id))
      if (keep.length === 0) throw new Error('at least one model must stay enabled')
      if (keep.length === catalogIds.length) delete profile.models
      else profile.models = keep.map((id) => ({ id }))
      if (Object.keys(profile).length === 0) delete providers[provider]
      else providers[provider] = profile
      await editor.edit(entry, () => ({ ...current, providers }))
      return wanted
    }
    const local = readLocal()
    const providers = { ...local.providers }
    if (wanted.length === 0) delete providers[provider]
    else providers[provider] = wanted
    writeLocal({ providers })
    return wanted
  }

  return { mechanismFor, hiddenOf, setHidden, readLocal, packProviders }
}
