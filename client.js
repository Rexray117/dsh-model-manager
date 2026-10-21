/**
 * Client half of the Model & Provider Manager.
 *
 * Adds one sidebar entry (`model-manager`) whose main panel renders a full-page
 * manager: every provider the Host knows about, grouped by whether an adapter
 * currently serves it, with each provider's catalog and a one-click way to make
 * a model the default for new sessions.
 *
 * Data comes from the package's own same-origin `/api/model-manager/*` routes;
 * nothing here reaches into Harness internals.
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-manager',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    /** Same-origin API prefix, resolved against the page so a mount path survives. */
    const API = (() => {
      try { return new URL('api/model-manager', document.baseURI).pathname } catch { return '/api/model-manager' }
    })()

    const DICT = {
      zh: {
        nav: '模型管理',
        title: '模型与供应商管理',
        subtitle: '按供应商整理全部已接入模型，先确认来源，再决定用哪一个。默认模型用于新会话。',
        'search.placeholder': '搜索供应商、模型名称或 ID…',
        'filter.all': '全部',
        'filter.active': '已启用',
        'filter.dormant': '未激活',
        'stats': '{providers} 个供应商 · 已加载 {models} 个模型',
        'current.label': '当前默认',
        'current.none': '未设置',
        'section.active': '已启用供应商',
        'section.dormant': '可配置 · 未激活',
        'count.loading': '…',
        'count.none': '无模型',
        'status.active': '已启用',
        'status.dormant': '未激活',
        'status.error': '配置异常',
        'detail.baseURL': '默认地址',
        'detail.settings': '配置域',
        'detail.models': '{n} 个模型',
        'detail.refresh': '刷新模型',
        'detail.refreshing': '刷新中…',
        'model.default': '默认',
        'model.setDefault': '设为默认',
        'model.saving': '保存中…',
        'model.text': '文本',
        'model.image': '图像',
        'empty.select': '从左侧选择一个供应商，查看它的模型列表。',
        'empty.models': '这个供应商还没有公开模型。',
        'empty.search': '没有匹配的供应商或模型。',
        'empty.error': '供应商列表加载失败',
        'error.retry': '重试',
        'err.notActive': '该供应商当前未注册适配器',
        'err.notInCatalog': '该模型不在供应商目录中',
        'err.unavailable': '默认模型服务不可用',
        'err.network': '无法连接 Host',
        'notice.saved': '已将 {model} 设为新会话默认模型',
        'notice.failed': '设置失败：{message}',
        'hint.default': '默认模型只影响新会话；当前会话可在输入框上方的模型菜单里切换。',
        'tab.models': '模型',
        'tab.quota': '额度与消耗',
        'quota.title': '额度与消耗',
        'quota.subtitle': '看清每个供应商还剩多少积分或额度，以及每个模型每天烧掉多少。',
        'quota.stat.today': '今日消耗',
        'quota.stat.window': '{days} 日消耗',
        'quota.stat.providers': '有额度的供应商',
        'quota.stat.wallet': '钱包余额',
        'quota.stat.tokens': 'tokens',
        'quota.refresh': '刷新额度',
        'quota.refreshing': '查询中…',
        'quota.refreshed': '额度已刷新',
        'quota.loading': '正在统计消耗与额度…',
        'quota.error': '额度数据加载失败',
        'quota.never': '尚未查询',
        'quota.checked': '更新于 {time}',
        'quota.remaining': '剩余',
        'quota.used': '已用',
        'quota.window': '{n} 天窗口',
        'quota.runway': '约可用 {days}',
        'quota.today': '今日',
        'quota.burn': '日均',
        'quota.perDay': '/日',
        'quota.packages': '套餐明细',
        'quota.accounts': '{n} 个账号',
        'quota.noBalance': '余额不可读',
        'quota.apiBilled': '按 API 计费',
        'quota.none': '无额度信息',
        'quota.notQueried': '点击「刷新额度」查询',
        'quota.table.title': '模型消耗明细',
        'quota.table.model': '模型',
        'quota.table.provider': '供应商',
        'quota.table.today': '今日 tokens',
        'quota.table.window': '{days} 日 tokens',
        'quota.table.requests': '请求',
        'quota.table.avg': '均 tokens/次',
        'quota.table.multiplier': '倍率',
        'quota.table.weighted': '加权÷日',
        'quota.table.tps': '速度',
        'quota.table.empty': '所选时间窗口内没有消耗记录。',
        'quota.sort.burn': '按消耗速度',
        'quota.sort.today': '按今日消耗',
        'quota.sort.requests': '按请求数',
        'quota.sort.name': '按名称',
        'quota.free': '免费',
        'quota.standard': '标准',
        'quota.credits': '积分',
        'quota.hint': '「加权÷日」把模型自带的价格倍率算进去，用于横向比较消耗速度；「速度」是输出 tokens/秒（来自渠道账本）。',
      },
      en: {
        nav: 'Model Manager',
        title: 'Models & Providers',
        subtitle: 'Every connected model arranged by its provider, so you can confirm the source before picking one. The default applies to new sessions.',
        'search.placeholder': 'Search providers, model names or ids…',
        'filter.all': 'All',
        'filter.active': 'Active',
        'filter.dormant': 'Inactive',
        'stats': '{providers} providers · {models} models loaded',
        'current.label': 'Current default',
        'current.none': 'Not set',
        'section.active': 'Active providers',
        'section.dormant': 'Configurable · inactive',
        'count.loading': '…',
        'count.none': 'No models',
        'status.active': 'Active',
        'status.dormant': 'Inactive',
        'status.error': 'Config error',
        'detail.baseURL': 'Default endpoint',
        'detail.settings': 'Settings',
        'detail.models': '{n} models',
        'detail.refresh': 'Refresh models',
        'detail.refreshing': 'Refreshing…',
        'model.default': 'Default',
        'model.setDefault': 'Set default',
        'model.saving': 'Saving…',
        'model.text': 'Text',
        'model.image': 'Image',
        'empty.select': 'Pick a provider on the left to see its models.',
        'empty.models': 'This provider publishes no models yet.',
        'empty.search': 'No provider or model matches the search.',
        'empty.error': 'Could not load the provider list.',
        'error.retry': 'Retry',
        'err.notActive': 'No adapter is registered for this provider',
        'err.notInCatalog': 'This model is not in the provider catalog',
        'err.unavailable': 'The default model service is unavailable',
        'err.network': 'Cannot reach the Host',
        'notice.saved': '{model} is now the default for new sessions',
        'notice.failed': 'Could not save: {message}',
        'hint.default': 'The default affects new sessions only; switch the current session from the model menu above the composer.',
        'tab.models': 'Models',
        'tab.quota': 'Quota & burn',
        'quota.title': 'Quota & burn',
        'quota.subtitle': 'See what is left on each provider, and how fast each model burns it.',
        'quota.stat.today': 'Today',
        'quota.stat.window': '{days}-day burn',
        'quota.stat.providers': 'Providers with quota',
        'quota.stat.wallet': 'Wallet',
        'quota.stat.tokens': 'tokens',
        'quota.refresh': 'Refresh quota',
        'quota.refreshing': 'Querying…',
        'quota.refreshed': 'Quota refreshed',
        'quota.loading': 'Collecting usage and quota…',
        'quota.error': 'Could not load quota data',
        'quota.never': 'not queried yet',
        'quota.checked': 'updated {time}',
        'quota.remaining': 'left',
        'quota.used': 'used',
        'quota.window': '{n}-day window',
        'quota.runway': '~{days} left',
        'quota.today': 'today',
        'quota.burn': 'avg/day',
        'quota.perDay': '/day',
        'quota.packages': 'Packages',
        'quota.accounts': '{n} accounts',
        'quota.noBalance': 'balance unavailable',
        'quota.apiBilled': 'API billed',
        'quota.none': 'no quota info',
        'quota.notQueried': 'press “Refresh quota”',
        'quota.table.title': 'Per-model burn',
        'quota.table.model': 'Model',
        'quota.table.provider': 'Provider',
        'quota.table.today': 'Today tokens',
        'quota.table.window': '{days}-day tokens',
        'quota.table.requests': 'Requests',
        'quota.table.avg': 'Avg tokens/call',
        'quota.table.multiplier': 'Rate',
        'quota.table.weighted': 'Weighted/day',
        'quota.table.tps': 'Speed',
        'quota.table.empty': 'No consumption recorded in this window.',
        'quota.sort.burn': 'By burn rate',
        'quota.sort.today': 'By today',
        'quota.sort.requests': 'By requests',
        'quota.sort.name': 'By name',
        'quota.free': 'free',
        'quota.standard': 'standard',
        'quota.credits': 'credits',
        'quota.hint': '“Weighted/day” applies each model’s own price multiplier, so burn rates compare fairly; “Speed” is output tokens/second from the channel ledger.',
      },
    }

    function readLocale(ctx) {
      try { return String(ctx.get('locale')?.getLocale?.()?.active ?? '') } catch { return '' }
    }

    function makeT(active) {
      const dict = String(active).toLowerCase().startsWith('zh') ? DICT.zh : DICT.en
      return (key, params) => {
        let text = dict[key] ?? DICT.en[key] ?? key
        if (params !== undefined) {
          for (const [name, value] of Object.entries(params)) {
            text = text.split(`{${name}}`).join(String(value))
          }
        }
        return text
      }
    }

    function useT(ctx) {
      const [active, setActive] = useState(() => readLocale(ctx))
      useEffect(() => {
        let locale
        try { locale = ctx.get('locale') } catch { return undefined }
        if (locale?.subscribe === undefined) return undefined
        return locale.subscribe(() => setActive(readLocale(ctx)))
      }, [ctx])
      return useMemo(() => makeT(active), [active])
    }

    async function api(path, options) {
      const timeout = options?.timeout ?? 12000
      const controller = typeof AbortController === 'function' ? new AbortController() : undefined
      const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), timeout)
      try {
        const response = await fetch(`${API}${path}`, {
          method: options?.method ?? 'GET',
          headers: options?.body === undefined ? undefined : { 'content-type': 'application/json' },
          body: options?.body === undefined ? undefined : JSON.stringify(options.body),
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller?.signal,
        })
        const data = await response.json().catch(() => null)
        if (!response.ok || data?.ok !== true) {
          const code = data?.error?.code ?? `http-${response.status}`
          throw Object.assign(new Error(data?.error?.message ?? `HTTP ${response.status}`), { code })
        }
        return data.value
      } catch (error) {
        if (error?.name === 'AbortError') throw Object.assign(new Error('timeout'), { code: 'timeout' })
        if (error?.code === undefined) throw Object.assign(new Error(String(error?.message ?? error)), { code: 'network' })
        throw error
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }

    function describeError(error) {
      return { code: error?.code ?? 'unknown', message: String(error?.message ?? error) }
    }

    function errorText(t, error) {
      if (error === null || error === undefined) return ''
      switch (error.code) {
        case 'not-active': return t('err.notActive')
        case 'not-in-catalog': return t('err.notInCatalog')
        case 'unavailable': return t('err.unavailable')
        case 'network': return t('err.network')
        case 'timeout': return t('err.network')
        default: return error.message || t('err.network')
      }
    }

    const TINTS = [
      ['#4C8DFF', '#7B5CFF'],
      ['#3ECFA0', '#2A9BD6'],
      ['#F2A65A', '#E36AA6'],
      ['#8B7BF0', '#39B8C4'],
      ['#D9743E', '#F2A65A'],
      ['#E36AA6', '#8B7BF0'],
      ['#7BB24A', '#3ECFA0'],
      ['#39B8C4', '#4C8DFF'],
    ]

    function seedOf(value) {
      let hash = 2166136261
      const text = String(value ?? '')
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      return Math.abs(hash)
    }

    function tintOf(id) {
      return TINTS[seedOf(id) % TINTS.length]
    }

    function initials(name) {
      const text = String(name ?? '').trim()
      if (text === '') return '?'
      const ascii = /^[\x20-\x7e]+$/.test(text)
      if (ascii) {
        const parts = text.split(/[\s\-_.]+/).filter(Boolean)
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
        return text.slice(0, 2).toUpperCase()
      }
      return text.slice(0, 2)
    }

    function hostOf(url) {
      if (typeof url !== 'string' || url === '') return ''
      try { return new URL(url).host } catch { return url }
    }

    /** Plain grouped integer for exact amounts. */
    function fmtNum(value) {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      return new Intl.NumberFormat('en-US').format(Math.round(value))
    }

    /** Credits keep two decimals below 1000 (149.78), integers above. */
    function fmtAmount(value) {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      if (Math.abs(value) >= 1000 || Number.isInteger(value)) return fmtNum(value)
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
    }

    /** Compact token counts: 1.2M / 85.6K / 972. */
    function fmtCompact(value) {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      const abs = Math.abs(value)
      if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
      if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
      if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}K`
      return new Intl.NumberFormat('en-US').format(Math.round(value))
    }

    /** Money with two decimals. */
    function fmtMoney(value, currency) {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
      return `${symbol}${value.toFixed(2)}`
    }

    /** Wall-clock time for a refresh stamp. */
    function fmtTime(ts) {
      if (!Number.isFinite(ts)) return ''
      try {
        return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    /** Day count, clamped to hours when below one day. */
    function fmtDays(value) {
      if (!Number.isFinite(value) || value <= 0) return '—'
      if (value < 1) return `${Math.max(1, Math.round(value * 24))}h`
      return `${value >= 100 ? Math.round(value) : value.toFixed(1)}d`
    }

    /** Normalize the unit the channel pack reports for a balance. */
    function unitText(unit, t) {
      if (unit === 'tokens') return t('quota.stat.tokens')
      if (unit === 'USD') return 'USD'
      return t('quota.credits')
    }

    /** A balance is exact for credits/money and compact for token counts. */
    function fmtQuota(value, unit) {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      return unit === 'tokens' ? fmtCompact(value) : fmtAmount(value)
    }

    function providerStatus(provider) {
      if (provider.directory?.error) return 'error'
      return provider.registered ? 'active' : 'dormant'
    }

    function Avatar(props) {
      const { id, name, size, radius } = props
      const tint = tintOf(id)
      return h('span', {
        className: 'mm-avatar',
        title: name,
        style: {
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: `${radius}px`,
          backgroundImage: `linear-gradient(135deg, ${tint[0]}, ${tint[1]})`,
          fontSize: `${Math.round(size * 0.36)}px`,
        },
      }, initials(name))
    }

    function StatusDot(props) {
      return h('span', { className: `mm-status mm-status-${props.status}`, title: props.title }, h('i'), props.label)
    }

    function Icon(props) {
      const size = props.size ?? 16
      const common = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }
      switch (props.name) {
        case 'search':
          return h('svg', common, h('circle', { cx: 11, cy: 11, r: 6.5 }), h('path', { d: 'm16 16 4 4' }))
        case 'refresh':
          return h('svg', common, h('path', { d: 'M20 11a8 8 0 1 0-2.3 5.7' }), h('path', { d: 'M20 4v6h-6' }))
        case 'check':
          return h('svg', common, h('path', { d: 'm5 12.5 4.5 4.5L19 7' }))
        case 'layers':
          return h('svg', common, h('path', { d: 'm12 3 8 4.5-8 4.5-8-4.5z' }), h('path', { d: 'm4 12 8 4.5 8-4.5' }), h('path', { d: 'm4 16.5 8 4.5 8-4.5' }))
        case 'box':
          return h('svg', common, h('path', { d: 'M21 8.5 12 3 3 8.5v7L12 21l9-5.5z' }), h('path', { d: 'M3 8.5 12 14l9-5.5' }), h('path', { d: 'M12 14v7' }))
        case 'spark':
          return h('svg', common, h('path', { d: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8' }))
        default:
          return null
      }
    }

    function ModelManagerIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 20
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block' },
      },
      h('path', {
        d: 'm12 3 8 4.5-8 4.5-8-4.5z',
        fill: 'currentColor',
        fillOpacity: props?.active === true ? 0.95 : 0.75,
      }),
      h('path', {
        d: 'm4 12 8 4.5 8-4.5',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        opacity: 0.85,
      }),
      h('path', {
        d: 'm4 16.5 8 4.5 8-4.5',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        opacity: 0.55,
      }))
    }

    const CSS = `
.mm-page{height:100%;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.mm-wrap{max-width:1180px;margin:0 auto;padding:26px 30px 56px;box-sizing:border-box}
.mm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap}
.mm-title{font-size:22px;font-weight:650;letter-spacing:-.01em;margin:0}
.mm-sub{margin:6px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary);max-width:640px}
.mm-actions{display:flex;align-items:center;gap:10px}
.mm-current{display:flex;align-items:center;gap:10px;max-width:380px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.mm-current-dot{width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,#4C8DFF,#7B5CFF);flex:none;box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent)}
.mm-current-text{min-width:0;display:flex;flex-direction:column;gap:1px}
.mm-current-label{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.mm-current-value{font-size:13px;font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-current-sub{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-tools{margin-top:18px;display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, transparent);position:sticky;top:12px;z-index:6;backdrop-filter:blur(10px)}
.mm-search{flex:1;display:flex;align-items:center;gap:8px;min-width:0;height:36px;padding:0 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.mm-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.mm-search input::placeholder{color:var(--dsw-alias-label-secondary)}
.mm-seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);flex:none}
.mm-seg button{height:30px;padding:0 12px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.mm-seg button[data-on="true"]{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.mm-stats{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.mm-body{margin-top:16px;display:grid;grid-template-columns:336px minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:860px){.mm-body{grid-template-columns:minmax(0,1fr)}}
.mm-rail{display:flex;flex-direction:column;gap:8px;min-width:0}
.mm-section{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:8px 6px 2px}
.mm-prov{display:flex;align-items:center;gap:10px;width:100%;padding:10px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;text-align:left;color:inherit;font:inherit;transition:border-color .15s,box-shadow .15s,transform .15s}
.mm-prov:hover{border-color:var(--dsw-alias-border-l2);transform:translateY(-1px);box-shadow:0 6px 16px rgba(0,0,0,.06)}
.mm-prov[data-on="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, var(--dsw-alias-bg-layer-1))}
.mm-avatar{display:inline-flex;align-items:center;justify-content:center;flex:none;color:#fff;font-weight:600;letter-spacing:.02em;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}
.mm-prov-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.mm-prov-name{font-size:13px;font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-prov-meta{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}
.mm-prov-meta .mm-mono{overflow:hidden;text-overflow:ellipsis;min-width:0}
.mm-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.mm-prov-side{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none;text-align:right}
.mm-count{font-size:10.5px;color:var(--dsw-alias-label-secondary);padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}
.mm-count[data-loading="true"]{opacity:.6}
.mm-status{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.mm-status i{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);display:inline-block}
.mm-status-active i{background:var(--dsw-alias-state-success-primary)}
.mm-status-error i{background:var(--dsw-alias-state-error-primary)}
.mm-status-active{color:var(--dsw-alias-state-success-primary)}
.mm-status-error{color:var(--dsw-alias-state-error-primary)}
.mm-detail{border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);min-height:440px;display:flex;flex-direction:column;overflow:hidden}
.mm-detail-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);background:linear-gradient(180deg,color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, transparent),transparent)}
.mm-detail-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mm-detail-name{font-size:16px;font-weight:620;margin:0}
.mm-detail-meta{margin-top:3px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0}
.mm-detail-meta span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px}
.mm-detail-body{padding:14px 16px 18px;display:flex;flex-direction:column;gap:9px;min-height:0;flex:1}
.mm-chip{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;line-height:16px;padding:0 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}
.mm-chip b{font-weight:560;color:var(--dsw-alias-label-primary)}
.mm-chip-brand{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)}
.mm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,opacity .15s}
.mm-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary)}
.mm-btn:disabled{opacity:.55;cursor:default}
.mm-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.mm-btn-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);filter:brightness(1.06)}
.mm-model{display:flex;align-items:flex-start;gap:12px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-2);transition:border-color .15s,background .15s}
.mm-model:hover{border-color:var(--dsw-alias-border-l2)}
.mm-model[data-default="true"]{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-layer-2))}
.mm-model-main{flex:1;min-width:0}
.mm-model-name{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13.5px;font-weight:560}
.mm-model-id{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-weight:400}
.mm-model-desc{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mm-model-tags{margin-top:6px;display:flex;gap:5px;flex-wrap:wrap}
.mm-model-side{display:flex;align-items:center;gap:8px;flex:none;align-self:center}
.mm-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;padding:34px 20px;text-align:center;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;align-items:center;gap:8px}
.mm-empty-icon{opacity:.55}
.mm-skel{height:56px;border-radius:11px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-2),color-mix(in srgb, var(--dsw-alias-bg-layer-2) 60%, var(--dsw-alias-border-l1)),var(--dsw-alias-bg-layer-2));background-size:220% 100%;animation:mm-shimmer 1.2s linear infinite}
@keyframes mm-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}
.mm-toast{position:fixed;right:24px;bottom:24px;z-index:60;max-width:420px;padding:9px 13px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:12px;box-shadow:0 10px 28px rgba(0,0,0,.18);display:flex;align-items:center;gap:8px}
.mm-toast[data-kind="error"]{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, transparent)}
.mm-toast[data-kind="success"] .mm-toast-dot{background:var(--dsw-alias-state-success-primary)}
.mm-toast-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-error-primary);flex:none}
.mm-hint{margin-top:10px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.mm-spin{display:inline-block;width:13px;height:13px;border-radius:50%;border:1.6px solid currentColor;border-right-color:transparent;animation:mm-spin .8s linear infinite}
@keyframes mm-spin{to{transform:rotate(360deg)}}
.mm-tabs{display:flex;gap:2px;padding:3px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);margin-top:14px;align-self:flex-start}
.mm-tabs button{height:32px;padding:0 14px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer}
.mm-tabs button[data-on="true"]{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.08);font-weight:560}
.mm-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}
@media (max-width:900px){.mm-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
.mm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:13px 14px;display:flex;flex-direction:column;gap:4px}
.mm-card-label{font-size:11px;color:var(--dsw-alias-label-secondary);letter-spacing:.04em}
.mm-card-value{font-size:21px;font-weight:640;letter-spacing:-.02em;display:flex;align-items:baseline;gap:5px}
.mm-card-unit{font-size:11.5px;font-weight:400;color:var(--dsw-alias-label-secondary)}
.mm-card-sub{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-qsection{margin-top:20px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.mm-qsection-title{font-size:13px;font-weight:600}
.mm-qsection-note{font-size:11px;color:var(--dsw-alias-label-secondary)}
.mm-qgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:12px;margin-top:10px}
.mm-qcard{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:13px 14px;display:flex;flex-direction:column;gap:9px}
.mm-qcard[data-kind="wallet"]{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, var(--dsw-alias-border-l1))}
.mm-qcard-head{display:flex;align-items:center;gap:9px;min-width:0}
.mm-qcard-name{font-size:13px;font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-qcard-id{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-qcard-amount{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.mm-qcard-value{font-size:24px;font-weight:650;letter-spacing:-.02em}
.mm-qcard-amount[data-low="true"] .mm-qcard-value{color:var(--dsw-alias-state-warn-primary)}
.mm-qcard-amount[data-zero="true"] .mm-qcard-value{color:var(--dsw-alias-state-error-primary)}
.mm-qcard-unit{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.mm-qcard-meta{display:flex;flex-wrap:wrap;gap:5px}
.mm-qcard-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.mm-qcard-row b{color:var(--dsw-alias-label-primary);font-weight:560;font-size:12px}
.mm-bar{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;position:relative}
.mm-bar i{position:absolute;inset-block:0;left:0;border-radius:999px;background:linear-gradient(90deg,var(--dsw-alias-brand-primary),#7B5CFF);opacity:.85}
.mm-pkg{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);padding:3px 0;border-top:1px dashed var(--dsw-alias-border-l1)}
.mm-pkg:first-of-type{border-top:none}
.mm-pkg-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%}
.mm-pkg-val{font-variant-numeric:tabular-nums;white-space:nowrap}
.mm-qerror{font-size:11px;color:var(--dsw-alias-state-error-primary);display:flex;align-items:center;gap:5px}
.mm-qwarn{font-size:11px;color:var(--dsw-alias-state-warn-primary)}
.mm-tablewrap{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);margin-top:10px;overflow:hidden}
.mm-table-scroll{overflow:auto;max-height:min(62vh,720px)}
.mm-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
.mm-table th{position:sticky;top:0;z-index:1;text-align:left;font-weight:520;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.mm-table td{padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle;white-space:nowrap}
.mm-table tr:last-child td{border-bottom:none}
.mm-table tbody tr:hover td{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent)}
.mm-table .mm-num{font-variant-numeric:tabular-nums;text-align:right}
.mm-table .mm-model-cell{max-width:260px;white-space:normal}
.mm-table .mm-model-cell .mm-model-name{font-size:12.5px}
.mm-mini{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.mm-burnbar{height:5px;width:88px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;display:inline-block;vertical-align:middle}
.mm-burnbar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#4C8DFF,#7B5CFF)}
.mm-sortsel{display:flex;align-items:center;gap:6px}
.mm-sortsel select{height:30px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 8px;outline:none}
`

    function apply(ctx) {
      /** Register dictionaries so the locale service knows this namespace. */
      try {
        const locale = ctx.get('locale')
        if (locale?.register !== undefined) {
          for (const [tag, dict] of [['zh', DICT.zh], ['zh-CN', DICT.zh], ['en', DICT.en]]) {
            try { locale.register('model-manager', tag, dict) } catch { /* already registered */ }
          }
        }
      } catch { /* no locale service */ }

      const labelThunk = () => makeT(readLocale(ctx))('nav')

      function ManagerPage() {
        const t = useT(ctx)
        const [summary, setSummary] = useState({ status: 'loading', providers: [], current: null, error: null })
        const [selected, setSelected] = useState(null)
        const [catalog, setCatalog] = useState({})
        const catalogRef = useRef({})
        const [query, setQuery] = useState('')
        const [filter, setFilter] = useState('all')
        const [refreshing, setRefreshing] = useState(false)
        const [pending, setPending] = useState(null)
        const [notice, setNotice] = useState(null)
        const [view, setView] = useState('models')
        const [quota, setQuota] = useState({ status: 'idle', value: null, error: null })
        const quotaRef = useRef(quota)
        const [quotaBusy, setQuotaBusy] = useState(false)
        const [sortBy, setSortBy] = useState('burn')

        useEffect(() => { quotaRef.current = quota }, [quota])

        const loadQuota = useCallback(async (options) => {
          const current = quotaRef.current
          if (current.status !== 'ready' || options?.fresh === true) {
            setQuota({ status: 'loading', value: current.value, error: null })
          }
          try {
            const value = await api('/quota?days=7', { timeout: 45000 })
            setQuota({ status: 'ready', value, error: null })
            return value
          } catch (error) {
            setQuota({ status: 'error', value: current.value, error: describeError(error) })
            return null
          }
        }, [])

        const refreshQuota = useCallback(async () => {
          setQuotaBusy(true)
          try {
            await api('/quota/refresh', { method: 'POST', body: {}, timeout: 90000 })
            await loadQuota({ fresh: true })
            setNotice({ kind: 'success', text: t('quota.refreshed') })
          } catch (error) {
            setNotice({ kind: 'error', text: t('notice.failed', { message: errorText(t, describeError(error)) }) })
          } finally {
            setQuotaBusy(false)
          }
        }, [loadQuota, t])

        /** First open of the quota tab: ensure loaded, then query upstream once. */
        const triggeredBalanceRefresh = useRef(false)
        useEffect(() => {
          if (view !== 'quota' || triggeredBalanceRefresh.current) return
          triggeredBalanceRefresh.current = true
          void (async () => {
            let value = quotaRef.current.value
            if (value === null) {
              value = await loadQuota()
            }
            if (value !== null && value.balancesAt === null) await refreshQuota()
          })()
        }, [view, loadQuota, refreshQuota])

        /** The models list also shows a balance chip, so warm the data once. */
        useEffect(() => {
          if (summary.status !== 'ready') return
          if (quotaRef.current.status !== 'idle') return
          void loadQuota()
        }, [summary.status, loadQuota])

        const putCatalog = useCallback((providerId, entry) => {
          catalogRef.current = { ...catalogRef.current, [providerId]: entry }
          setCatalog((current) => ({ ...current, [providerId]: entry }))
        }, [])

        const loadModels = useCallback(async (providerId, options) => {
          const existing = catalogRef.current[providerId]
          if (options?.force !== true && existing !== undefined && (existing.status === 'ready' || existing.status === 'loading')) return
          putCatalog(providerId, { status: 'loading', models: [], error: null })
          try {
            const value = await api(`/models?provider=${encodeURIComponent(providerId)}`, { timeout: 15000 })
            putCatalog(providerId, { status: 'ready', models: value.models ?? [], error: null })
          } catch (error) {
            putCatalog(providerId, { status: 'error', models: [], error: describeError(error) })
          }
        }, [putCatalog])

        const loadSummary = useCallback(async (options) => {
          if (options?.quiet === true) setRefreshing(true)
          else setSummary((current) => ({ ...current, status: current.status === 'ready' ? 'ready' : 'loading', error: null }))
          try {
            const value = await api('/summary', { timeout: 12000 })
            setSummary({ status: 'ready', providers: value.providers ?? [], current: value.default ?? null, error: null })
          } catch (error) {
            setSummary({ status: 'error', providers: [], current: null, error: describeError(error) })
          } finally {
            setRefreshing(false)
          }
        }, [])

        useEffect(() => { void loadSummary() }, [loadSummary])

        useEffect(() => {
          if (summary.status !== 'ready') return
          const known = summary.providers.some((provider) => provider.id === selected)
          if (known) return
          const preferred = summary.current?.provider
          const next = summary.providers.find((provider) => provider.id === preferred)
            ?? summary.providers.find((provider) => provider.registered)
            ?? summary.providers[0]
          setSelected(next?.id ?? null)
        }, [summary, selected])

        useEffect(() => {
          if (selected !== null) void loadModels(selected)
        }, [selected, loadModels])

        /** Count models per provider in the background, three at a time. */
        useEffect(() => {
          if (summary.status !== 'ready') return undefined
          let cancelled = false
          let running = 0
          const queue = summary.providers.map((provider) => provider.id)
          const pump = () => {
            if (cancelled) return
            while (running < 3 && queue.length > 0) {
              const providerId = queue.shift()
              const existing = catalogRef.current[providerId]
              if (existing !== undefined && (existing.status === 'loading' || existing.status === 'ready')) continue
              running += 1
              void loadModels(providerId).finally(() => { running -= 1; pump() })
            }
          }
          pump()
          return () => { cancelled = true }
        }, [summary, loadModels])

        useEffect(() => {
          if (notice === null) return undefined
          const timer = setTimeout(() => setNotice(null), 4200)
          return () => clearTimeout(timer)
        }, [notice])

        const providerName = useCallback((providerId) => {
          const row = summary.providers.find((provider) => provider.id === providerId)
          return row?.name ?? providerId
        }, [summary.providers])

        const current = summary.current
        const currentProvider = current === null ? null : providerName(current.provider)
        const queryText = query.trim().toLowerCase()
        const matchesModel = useCallback((model) => {
          if (queryText === '') return true
          const haystack = `${model.name ?? ''} ${model.id ?? ''} ${model.description ?? ''}`.toLowerCase()
          return haystack.includes(queryText)
        }, [queryText])

        const visibleProviders = useMemo(() => summary.providers.filter((provider) => {
          if (filter === 'active' && !provider.registered) return false
          if (filter === 'dormant' && provider.registered) return false
          if (queryText === '') return true
          const nameHit = `${provider.name ?? ''} ${provider.id ?? ''}`.toLowerCase().includes(queryText)
          const entry = catalog[provider.id]
          return nameHit || (entry?.status === 'ready' && entry.models.some(matchesModel))
        }), [summary.providers, filter, queryText, catalog, matchesModel])

        const activeProviders = visibleProviders.filter((provider) => provider.registered)
        const dormantProviders = visibleProviders.filter((provider) => !provider.registered)

        const loadedModels = useMemo(() => Object.values(catalog).reduce((total, entry) => total + (entry.models?.length ?? 0), 0), [catalog])

        const selectedProvider = summary.providers.find((provider) => provider.id === selected) ?? null
        const selectedEntry = selected === null ? undefined : catalog[selected]
        const visibleModels = (selectedEntry?.models ?? []).filter(matchesModel)

        async function setDefault(providerId, modelId) {
          const key = `${providerId}/${modelId}`
          setPending(key)
          try {
            const value = await api('/default', { method: 'POST', body: { provider: providerId, model: modelId }, timeout: 15000 })
            setSummary((state) => ({ ...state, current: value.default }))
            setNotice({ kind: 'success', text: t('notice.saved', { model: modelId }) })
          } catch (error) {
            setNotice({ kind: 'error', text: t('notice.failed', { message: errorText(t, describeError(error)) }) })
          } finally {
            setPending(null)
          }
        }

        function renderProviderRow(provider) {
          const status = providerStatus(provider)
          const entry = catalog[provider.id]
          const count = entry?.status === 'ready' ? t('detail.models', { n: entry.models.length })
            : entry?.status === 'error' ? '—'
            : t('count.loading')
          const quotaInfo = quota.value?.providers?.find((row) => row.id === provider.id)?.quota
          const quotaChip = quotaInfo !== undefined
            && (quotaInfo.kind === 'credits' || quotaInfo.kind === 'wallet')
            && quotaInfo.remaining !== null
            ? (quotaInfo.kind === 'wallet'
              ? fmtMoney(quotaInfo.remaining, quotaInfo.currency)
              : `${fmtQuota(quotaInfo.remaining, quotaInfo.unit)} ${unitText(quotaInfo.unit, t)}`)
            : null
          return h('button', {
            key: provider.id,
            type: 'button',
            className: 'mm-prov',
            'data-on': provider.id === selected ? 'true' : 'false',
            onClick: () => setSelected(provider.id),
            title: provider.directory?.error ?? provider.id,
          },
          h(Avatar, { id: provider.id, name: provider.name, size: 34, radius: 10 }),
          h('span', { className: 'mm-prov-main' },
            h('span', { className: 'mm-prov-name' }, provider.name),
            h('span', { className: 'mm-prov-meta' },
              h('span', { className: 'mm-mono' }, provider.id),
              quotaChip === null ? null : h('span', { className: 'mm-chip', title: t('quota.remaining') }, quotaChip),
            ),
          ),
          h('span', { className: 'mm-prov-side' },
            h('span', { className: 'mm-count', 'data-loading': entry === undefined || entry.status === 'loading' ? 'true' : 'false' }, count),
            h(StatusDot, {
              status,
              label: status === 'active' ? t('status.active') : status === 'error' ? t('status.error') : t('status.dormant'),
              title: provider.directory?.error ?? '',
            }),
          ))
        }

        function renderDetail() {
          if (summary.status === 'loading') {
            return h('div', { className: 'mm-detail' },
              h('div', { className: 'mm-detail-head' },
                h('span', { className: 'mm-skel', style: { width: '44px', height: '44px', borderRadius: '12px' } }),
                h('span', { style: { flex: 1 } },
                  h('div', { className: 'mm-skel', style: { width: '180px', height: '16px' } }),
                  h('div', { className: 'mm-skel', style: { width: '120px', height: '11px', marginTop: '6px' } }),
                ),
              ),
              h('div', { className: 'mm-detail-body' },
                h('div', { className: 'mm-skel' }),
                h('div', { className: 'mm-skel' }),
                h('div', { className: 'mm-skel' }),
              ))
          }
          if (summary.status === 'error') {
            return h('div', { className: 'mm-detail' },
              h('div', { className: 'mm-empty', style: { margin: '16px' } },
                h('span', { className: 'mm-empty-icon' }, h(Icon, { name: 'box', size: 26 })),
                h('span', null, `${t('empty.error')}（${errorText(t, summary.error)}）`),
                h('button', { type: 'button', className: 'mm-btn', onClick: () => { void loadSummary() } }, t('error.retry')),
              ))
          }
          if (selectedProvider === null) {
            return h('div', { className: 'mm-empty' },
              h('span', { className: 'mm-empty-icon' }, h(Icon, { name: 'layers', size: 26 })),
              h('span', null, t('empty.select')))
          }
          const status = providerStatus(selectedProvider)
          const entry = selectedEntry
          const total = entry?.status === 'ready' ? entry.models.length : null
          return h('div', { className: 'mm-detail' },
            h('div', { className: 'mm-detail-head' },
              h(Avatar, { id: selectedProvider.id, name: selectedProvider.name, size: 44, radius: 12 }),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { className: 'mm-detail-title' },
                  h('h2', { className: 'mm-detail-name' }, selectedProvider.name),
                  h('span', { className: 'mm-chip' }, h('span', { className: 'mm-mono' }, selectedProvider.id)),
                  status === 'error'
                    ? h('span', { className: 'mm-chip', style: { borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent)', color: 'var(--dsw-alias-state-error-primary)' } }, t('status.error'))
                    : status === 'dormant'
                      ? h('span', { className: 'mm-chip' }, t('status.dormant'))
                      : h('span', { className: 'mm-chip mm-chip-brand' }, t('status.active')),
                  total !== null ? h('span', { className: 'mm-chip' }, t('detail.models', { n: total })) : null,
                ),
                h('div', { className: 'mm-detail-meta' },
                  selectedProvider.directory?.defaultBaseURL
                    ? h('span', { title: selectedProvider.directory.defaultBaseURL }, `${t('detail.baseURL')} · ${hostOf(selectedProvider.directory.defaultBaseURL)}`)
                    : null,
                  selectedProvider.directory?.settingsNs
                    ? h('span', { title: selectedProvider.directory.settingsNs }, `${t('detail.settings')} · ${selectedProvider.directory.settingsNs}`)
                    : null,
                  selectedProvider.directory?.error ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, selectedProvider.directory.error) : null,
                ),
              ),
              h('button', {
                type: 'button',
                className: 'mm-btn',
                disabled: entry?.status === 'loading',
                title: t('detail.refresh'),
                onClick: () => { void loadModels(selectedProvider.id, { force: true }) },
              },
              entry?.status === 'loading' ? h('span', { className: 'mm-spin' }) : h(Icon, { name: 'refresh', size: 15 }),
              t('detail.refresh')),
            ),

            h('div', { className: 'mm-detail-body' },
              entry === undefined || entry.status === 'loading'
                ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } },
                  h('div', { className: 'mm-skel' }),
                  h('div', { className: 'mm-skel' }),
                  h('div', { className: 'mm-skel' }))
                : entry.status === 'error'
                  ? h('div', { className: 'mm-empty' },
                    h('span', { className: 'mm-empty-icon' }, h(Icon, { name: 'box', size: 26 })),
                    h('span', null, errorText(t, entry.error)),
                    h('button', { type: 'button', className: 'mm-btn', onClick: () => { void loadModels(selectedProvider.id, { force: true }) } }, t('error.retry')))
                  : visibleModels.length === 0
                    ? h('div', { className: 'mm-empty' },
                      h('span', { className: 'mm-empty-icon' }, h(Icon, { name: 'spark', size: 26 })),
                      h('span', null, selectedEntry.models.length === 0 ? t('empty.models') : t('empty.search')))
                    : visibleModels.map((model) => {
                      const isDefault = current !== null && current.provider === selectedProvider.id && current.model === model.id
                      const key = `${selectedProvider.id}/${model.id}`
                      const saving = pending === key
                      return h('div', { key: model.id, className: 'mm-model', 'data-default': isDefault ? 'true' : 'false' },
                        h('div', { className: 'mm-model-main' },
                          h('div', { className: 'mm-model-name' },
                            model.name,
                            h('span', { className: 'mm-model-id mm-mono' }, model.id),
                            isDefault ? h('span', { className: 'mm-chip mm-chip-brand' }, h(Icon, { name: 'check', size: 11 }), t('model.default')) : null,
                          ),
                          model.description ? h('div', { className: 'mm-model-desc' }, model.description) : null,
                          (model.inputModalities ?? []).length > 0
                            ? h('div', { className: 'mm-model-tags' }, ...(model.inputModalities ?? []).map((modality) =>
                              h('span', { key: modality, className: 'mm-chip' },
                                modality === 'image' ? t('model.image') : t('model.text'))))
                            : null,
                        ),
                        h('div', { className: 'mm-model-side' },
                          isDefault
                            ? h('span', { className: 'mm-chip mm-chip-brand' }, h(Icon, { name: 'check', size: 11 }), t('model.default'))
                            : h('button', {
                              type: 'button',
                              className: 'mm-btn',
                              disabled: saving || filter === undefined,
                              onClick: () => { void setDefault(selectedProvider.id, model.id) },
                            }, saving ? t('model.saving') : t('model.setDefault'))),
                      )
                    }),
              selectedProvider.registered === false && entry?.status !== 'error'
                ? h('div', { className: 'mm-hint' }, t('err.notActive'))
                : null,
            ))
        }

        function renderQuota() {
          const value = quota.value
          if (quota.status === 'loading' && value === null) {
            return h('div', { className: 'mm-qsection' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' } },
                h('div', { className: 'mm-skel', style: { height: '72px' } }),
                h('div', { className: 'mm-skel', style: { height: '150px' } }),
                h('div', { className: 'mm-skel', style: { height: '220px' } })))
          }
          if (value === null) {
            return h('div', { className: 'mm-empty', style: { marginTop: '16px' } },
              h('span', { className: 'mm-empty-icon' }, h(Icon, { name: 'box', size: 26 })),
              h('span', null, `${t('quota.error')}${quota.error ? `（${errorText(t, quota.error)}）` : ''}`),
              h('button', { type: 'button', className: 'mm-btn', onClick: () => { void loadQuota({ fresh: true }) } }, t('error.retry')))
          }

          const days = value.days ?? 7
          const wallet = value.wallet
          const walletTotal = wallet?.wallets?.reduce((sum, entry) => sum + entry.balance, 0) ?? null
          const providers = value.providers.filter((provider) => {
            if (queryText === '') return true
            return String(provider.name).toLowerCase().includes(queryText) || provider.id.toLowerCase().includes(queryText)
          })
          const quotaProviders = providers.filter((provider) => provider.quota.kind === 'credits'
            || provider.quota.kind === 'wallet'
            || (provider.quota.kind === 'unknown' && provider.quota.error !== 'no-accounts'))
          const withQuota = value.providers.filter((provider) => provider.quota.kind === 'credits' || provider.quota.kind === 'wallet').length
          const bySort = [...value.models].filter((model) => queryText === ''
            || String(model.name).toLowerCase().includes(queryText)
            || model.model.toLowerCase().includes(queryText)
            || String(model.providerName).toLowerCase().includes(queryText))
          bySort.sort((a, b) => {
            if (sortBy === 'name') return String(a.name).localeCompare(String(b.name))
            if (sortBy === 'today') return b.todayTokens - a.todayTokens || b.tokens - a.tokens
            if (sortBy === 'requests') return b.requests - a.requests || b.tokens - a.tokens
            return b.weightedPerDay - a.weightedPerDay || b.tokens - a.tokens
          })
          const maxBurn = bySort.reduce((max, model) => Math.max(max, model.weightedPerDay), 0) || 1

          return h('div', null,
            h('div', { className: 'mm-cards' },
              h('div', { className: 'mm-card' },
                h('span', { className: 'mm-card-label' }, t('quota.stat.today')),
                h('span', { className: 'mm-card-value' }, fmtCompact(value.totals?.todayTokens), h('span', { className: 'mm-card-unit' }, t('quota.stat.tokens'))),
                h('span', { className: 'mm-card-sub' }, t('quota.checked', { time: fmtTime(value.generatedAt) }))),
              h('div', { className: 'mm-card' },
                h('span', { className: 'mm-card-label' }, t('quota.stat.window', { days })),
                h('span', { className: 'mm-card-value' }, fmtCompact(value.totals?.tokens), h('span', { className: 'mm-card-unit' }, t('quota.stat.tokens'))),
                h('span', { className: 'mm-card-sub' }, `${fmtNum(value.totals?.requests)} ${t('quota.table.requests')}`)),
              h('div', { className: 'mm-card' },
                h('span', { className: 'mm-card-label' }, t('quota.stat.providers')),
                h('span', { className: 'mm-card-value' }, String(withQuota), h('span', { className: 'mm-card-unit' }, `/ ${value.providers.length}`)),
                h('span', { className: 'mm-card-sub' }, value.balancesAt === null ? t('quota.never') : t('quota.checked', { time: fmtTime(value.balancesAt) }))),
              h('div', { className: 'mm-card' },
                h('span', { className: 'mm-card-label' }, t('quota.stat.wallet')),
                h('span', { className: 'mm-card-value' }, walletTotal === null ? '—' : fmtMoney(walletTotal, wallet?.wallets?.[0]?.currency)),
                h('span', { className: 'mm-card-sub' }, wallet?.unavailable === true ? t('quota.noBalance') : 'DeepSeek')),
            ),

            h('div', { className: 'mm-qsection' },
              h('div', null,
                h('div', { className: 'mm-qsection-title' }, t('quota.packages')),
                h('div', { className: 'mm-qsection-note' }, t('quota.hint'))),
              h('button', {
                type: 'button',
                className: 'mm-btn',
                disabled: quotaBusy,
                onClick: () => { void refreshQuota() },
              }, quotaBusy ? h('span', { className: 'mm-spin' }) : h(Icon, { name: 'refresh', size: 14 }), quotaBusy ? t('quota.refreshing') : t('quota.refresh'))),

            h('div', { className: 'mm-qgrid' },
              quotaProviders.length === 0
                ? h('div', { className: 'mm-empty', style: { gridColumn: '1 / -1' } }, t('quota.none'))
                : quotaProviders.map((provider) => {
                  const info = provider.quota
                  const isWallet = info.kind === 'wallet'
                  const remaining = info.remaining
                  const packages = (info.packages ?? []).filter((pkg) => pkg.remaining > 0 || pkg.total > 0).slice(0, 3)
                  const totalPackages = (info.packages ?? []).reduce((sum, pkg) => sum + (pkg.total ?? 0), 0)
                  const remainingPackages = (info.packages ?? []).reduce((sum, pkg) => sum + (pkg.remaining ?? 0), 0)
                  const ratio = totalPackages > 0 ? Math.max(0, Math.min(1, remainingPackages / totalPackages)) : null
                  const low = ratio !== null && ratio <= 0.2
                  return h('div', { key: provider.id, className: 'mm-qcard', 'data-kind': info.kind },
                    h('div', { className: 'mm-qcard-head' },
                      h(Avatar, { id: provider.id, name: provider.name, size: 30, radius: 9 }),
                      h('div', { style: { minWidth: 0, flex: 1 } },
                        h('div', { className: 'mm-qcard-name' }, provider.name),
                        h('div', { className: 'mm-qcard-id mm-mono' }, provider.id)),
                      info.windowDays ? h('span', { className: 'mm-chip' }, t('quota.window', { n: info.windowDays })) : null,
                      isWallet ? h('span', { className: 'mm-chip mm-chip-brand' }, 'DeepSeek') : null),
                    h('div', { className: 'mm-qcard-amount', 'data-zero': remaining === 0 ? 'true' : 'false', 'data-low': low ? 'true' : 'false' },
                      h('span', { className: 'mm-qcard-value' }, isWallet ? fmtMoney(remaining, info.currency) : fmtQuota(remaining, info.unit)),
                      h('span', { className: 'mm-qcard-unit' }, isWallet ? (info.currency ?? '') : unitText(info.unit, t)),
                      provider.burn?.runwayDays ? h('span', { className: 'mm-chip mm-chip-brand' }, t('quota.runway', { days: fmtDays(provider.burn.runwayDays) })) : null),
                    ratio !== null ? h('div', { className: 'mm-bar' }, h('i', { style: { width: `${Math.round(ratio * 100)}%` } })) : null,
                    packages.length > 0
                      ? h('div', null, ...packages.map((pkg, index) => h('div', { key: `${pkg.name}-${index}`, className: 'mm-pkg' },
                        h('span', { className: 'mm-pkg-name', title: pkg.name }, pkg.name),
                        h('span', { className: 'mm-pkg-val' }, `${fmtCompact(pkg.remaining)} / ${fmtCompact(pkg.total)}`))))
                      : null,
                    h('div', { className: 'mm-qcard-row' },
                      h('span', null, t('quota.today')),
                      h('b', null, fmtCompact(provider.usage?.todayTokens ?? 0))),
                    h('div', { className: 'mm-qcard-row' },
                      h('span', null, t('quota.burn')),
                      h('b', null, fmtCompact(provider.burn?.tokensPerDay ?? 0))),
                    info.error
                      ? h('div', { className: 'mm-qerror' }, h(Icon, { name: 'box', size: 11 }), info.error === 'not-queried' ? t('quota.notQueried') : info.error)
                      : null)
                })),

            h('div', { className: 'mm-qsection' },
              h('div', { className: 'mm-qsection-title' }, t('quota.table.title')),
              h('div', { className: 'mm-sortsel' },
                h('span', { className: 'mm-mini' }, `${bySort.length}`),
                h('select', {
                  value: sortBy,
                  onChange: (event) => setSortBy(event.target.value),
                  'aria-label': t('quota.table.title'),
                },
                h('option', { value: 'burn' }, t('quota.sort.burn')),
                h('option', { value: 'today' }, t('quota.sort.today')),
                h('option', { value: 'requests' }, t('quota.sort.requests')),
                h('option', { value: 'name' }, t('quota.sort.name'))))),

            h('div', { className: 'mm-tablewrap' },
              bySort.length === 0
                ? h('div', { className: 'mm-empty', style: { margin: '14px', border: 'none' } }, t('quota.table.empty'))
                : h('div', { className: 'mm-table-scroll' },
                  h('table', { className: 'mm-table' },
                    h('thead', null, h('tr', null,
                      h('th', null, t('quota.table.model')),
                      h('th', null, t('quota.table.provider')),
                      h('th', { className: 'mm-num' }, t('quota.table.today')),
                      h('th', { className: 'mm-num' }, t('quota.table.window', { days })),
                      h('th', { className: 'mm-num' }, t('quota.table.requests')),
                      h('th', { className: 'mm-num' }, t('quota.table.avg')),
                      h('th', { className: 'mm-num' }, t('quota.table.multiplier')),
                      h('th', { className: 'mm-num' }, t('quota.table.weighted')),
                      h('th', { className: 'mm-num' }, t('quota.table.tps')),
                    )),
                    h('tbody', null, ...bySort.slice(0, 400).map((model) => h('tr', { key: `${model.provider}/${model.model}` },
                      h('td', { className: 'mm-model-cell' },
                        h('div', { className: 'mm-model-name' }, model.name),
                        h('div', { className: 'mm-mini mm-mono' }, model.model)),
                      h('td', null, h('span', { className: 'mm-chip' }, model.providerName)),
                      h('td', { className: 'mm-num' }, fmtCompact(model.todayTokens)),
                      h('td', { className: 'mm-num' }, fmtCompact(model.tokens)),
                      h('td', { className: 'mm-num' }, fmtNum(model.requests)),
                      h('td', { className: 'mm-num' }, fmtCompact(model.requests > 0 ? Math.round(model.tokens / model.requests) : 0)),
                      h('td', { className: 'mm-num' },
                        model.free
                          ? h('span', { className: 'mm-chip mm-chip-brand' }, t('quota.free'))
                          : h('span', { className: 'mm-mini' }, model.label ?? t('quota.standard'))),
                      h('td', { className: 'mm-num' },
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', justifyContent: 'flex-end' } },
                          h('span', { className: 'mm-burnbar' }, h('i', { style: { width: `${Math.max(2, Math.round((model.weightedPerDay / maxBurn) * 100))}%` } })),
                          h('span', null, fmtCompact(model.weightedPerDay)))),
                      h('td', { className: 'mm-num mm-mini' }, model.tps === null || model.tps === undefined ? '—' : `${model.tps} t/s`),
                    )))))),
          )
        }

        return h('div', { className: 'mm-page' },
          h('style', null, CSS),
          h('div', { className: 'mm-wrap' },
            h('header', { className: 'mm-head' },
              h('div', { style: { minWidth: 0 } },
                h('h1', { className: 'mm-title' }, view === 'quota' ? t('quota.title') : t('title')),
                h('p', { className: 'mm-sub' }, view === 'quota' ? t('quota.subtitle') : t('subtitle')),
                h('div', { className: 'mm-tabs', role: 'tablist' },
                  ...[['models', 'tab.models'], ['quota', 'tab.quota']].map(([value, key]) =>
                    h('button', {
                      key: value,
                      type: 'button',
                      role: 'tab',
                      'data-on': view === value ? 'true' : 'false',
                      'aria-selected': view === value ? 'true' : 'false',
                      onClick: () => setView(value),
                    }, t(key)))),
              ),
              h('div', { className: 'mm-actions' },
                h('div', { className: 'mm-current', title: current === null ? '' : `${currentProvider} · ${current.model}` },
                  h('span', { className: 'mm-current-dot' }),
                  h('div', { className: 'mm-current-text' },
                    h('span', { className: 'mm-current-label' }, t('current.label')),
                    h('span', { className: 'mm-current-value' }, current === null ? t('current.none') : `${currentProvider} · ${current.model}`),
                  ),
                ),
                h('button', {
                  type: 'button',
                  className: 'mm-btn',
                  disabled: refreshing,
                  onClick: () => { void loadSummary({ quiet: true }) },
                  title: refreshing ? t('detail.refreshing') : t('detail.refresh'),
                }, refreshing ? h('span', { className: 'mm-spin' }) : h(Icon, { name: 'refresh', size: 14 })),
              ),
            ),

            h('div', { className: 'mm-tools' },
              h('label', { className: 'mm-search' },
                h(Icon, { name: 'search', size: 15 }),
                h('input', {
                  type: 'search',
                  value: query,
                  placeholder: t('search.placeholder'),
                  'aria-label': t('search.placeholder'),
                  onChange: (event) => setQuery(event.target.value),
                }),
              ),
              view === 'models'
                ? h('div', { className: 'mm-seg', role: 'tablist' },
                  ...[['all', 'filter.all'], ['active', 'filter.active'], ['dormant', 'filter.dormant']].map(([value, key]) =>
                    h('button', {
                      key: value,
                      type: 'button',
                      role: 'tab',
                      'data-on': filter === value ? 'true' : 'false',
                      onClick: () => setFilter(value),
                    }, t(key))))
                : null,
              h('div', { className: 'mm-stats' },
                view === 'quota'
                  ? quota.value === null
                    ? t('quota.loading')
                    : `${quota.value.models.length} ${t('quota.table.model')} · ${fmtCompact(quota.value.totals?.tokens)} tokens`
                  : t('stats', { providers: summary.providers.length, models: loadedModels })),
            ),

            view === 'models'
              ? h('div', { className: 'mm-body' },
                h('aside', { className: 'mm-rail' },
                  activeProviders.length > 0 ? h('div', { className: 'mm-section' }, t('section.active')) : null,
                  ...activeProviders.map(renderProviderRow),
                  dormantProviders.length > 0 ? h('div', { className: 'mm-section' }, t('section.dormant')) : null,
                  ...dormantProviders.map(renderProviderRow),
                  summary.status === 'ready' && visibleProviders.length === 0
                    ? h('div', { className: 'mm-empty', style: { padding: '22px 14px' } }, t('empty.search'))
                    : null,
                  summary.status === 'ready' && summary.providers.length > 0
                    ? h('div', { className: 'mm-hint' }, t('hint.default'))
                    : null,
                ),
                renderDetail(),
              )
              : renderQuota(),
          ),
          notice === null ? null : h('div', { className: 'mm-toast', 'data-kind': notice.kind, role: 'status' },
            h('span', { className: 'mm-toast-dot' }),
            h('span', null, notice.text)),
        )
      }

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'model-manager',
        locale: 'model-manager',
      }, () => h(ManagerPage)))

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'model-manager',
        order: 30,
        label: labelThunk,
        locale: 'model-manager',
      }, (props) => h(ModelManagerIcon, { size: props?.size, active: props?.active === true })))
    }

    return { inject: ['slots'], apply }
  },
})
