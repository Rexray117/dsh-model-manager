# Model Manager · 模型与供应商管理

DeepSeek Harness 桌面端插件。接入多个 API 与模型插件后，模型下拉框会把所有供应商的模型混在一起，容易混淆。本插件提供一个独立页面，**先按供应商看清来源，再挑选模型**，并可直接把某个模型设为新会话的默认模型；同时提供**额度与消耗**视图，看清每家还剩多少积分、每个模型烧得多快。

## 功能

### 模型管理

- **侧栏入口**：左侧导航新增「模型管理」图标，打开全页的管理界面（不遮挡、不覆盖 Harness 原生界面）。
- **供应商分组**：自动区分「已启用」（已注册适配器）与「可配置 · 未激活」两组；未激活的供应商说明它还缺凭据或配置。
- **来源可见**：每个供应商显示名称、机器 ID、状态、剩余额度标签、模型数量、配置域（settingsNs）、默认接入地址。同名模型的归属一目了然。
- **模型清单**：逐个供应商列出全部模型，包含 ID、描述与输入模态（文本 / 图像）标签，并标出当前默认项。
- **搜索与筛选**：按供应商名、供应商 ID、模型名、模型 ID、描述实时过滤；支持「全部 / 已启用 / 未激活」三档。
- **一键设为默认**：模型行右侧按钮把该模型写入新会话默认（落盘到 profile 的 `cordis.patch.yml`），成功后底部提示并即时更新「当前默认」卡片。
- **安全校验**：只允许把「已注册且存在于供应商目录中」的模型设为默认；调用不合法时返回明确错误，绝不写入错误配置。

### 额度与消耗

- **剩余额度**：每家供应商一张卡片，显示剩余积分 / 额度与单位（积分、tokens、USD、CNY）、账号数、套餐明细（名称 + 剩余/总量 + 用量条）、滚动窗口（如 15 天）。
- **钱包余额**：DeepSeek 官方账号的充值 + 赠送钱包（CNY/USD）。
- **今日与近 7 日消耗**：全局汇总与逐供应商统计。
- **模型消耗速度**：明细表按「加权÷日」排序，可切换今日 / 请求数 / 名称；列出每个模型的今日 tokens、窗口 tokens、请求数、均 tokens/次、价格倍率、加权消耗速度与吞吐（tokens/秒），并配相对条形图。
- **可用天数预估**：当额度以 token 计价时（如 ZCode），按近期日均消耗推算「约可用 N 天」。
- **手动刷新**：额度来自各供应商接口，点「刷新额度」重新查询；未查询过的渠道会明确标注。

### 通用

- **主题与语言**：全部配色取自 Harness 主题 token（`--dsw-alias-*`），自动跟随浅色/深色；界面文案中英双语，跟随 Harness 语言设置。

## 数据来源

| 数据 | 来源 | 说明 |
| --- | --- | --- |
| 供应商与模型目录 | `llm.listProviders()` / `llm.listConfigurableProviders()` / `llm.listModels()` | Harness 原生服务，新装插件自动出现 |
| 剩余积分与套餐 | channel pack RPC `usage.badge` | 即 Our Free Model 设置页看到的同一份渠道额度 |
| DeepSeek 钱包 | `deepseekAccount.getBalance()` | 需已登录官方账号 |
| 逐模型消耗 | `channel-pack/token-ledger.json` + 会话日志 `assistant/message.usage` | 账本含渠道上报的 tps/错误数；会话日志覆盖 API 直连供应商（如 opencode-go） |
| 价格倍率 | 模型显示名中的 `x0.5 / x0.05 / 免费` | 渠道自带的分时/套餐倍率 |

缺失任一来源时只降级对应字段（显示 `—`），不会让页面报错。


## 结构与数据流

```
侧栏图标  sidebar.panellist(id=model-manager)
   └── 主面板 main(key=model-manager)  ← client.js
            │  fetch 同源 /api/model-manager/*
            ▼
        Host 路由                                   ← index.js
            ├── llm.listProviders()                 已注册路由
            ├── llm.listConfigurableProviders()     可配置目录
            ├── llm.listModels(provider)            模型目录
            └── agentDefaultModel.currentSelection() / saveSelection()
```

Host 侧复用 Harness 已有的 `llm` 与 `agentDefaultModel` 服务，不重复实现模型逻辑，因此任何新接入的供应商或模型插件都会自动出现在页面上。

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/model-manager/summary` | 供应商列表 + 当前默认模型 |
| GET | `/api/model-manager/models?provider=<id>` | 单个供应商的模型目录 |
| POST | `/api/model-manager/default` | 设置默认模型，body 为 `{provider, model, reasoningEffort?}` |
| GET | `/api/model-manager/quota?days=7` | 额度 + 逐模型消耗快照（默认 7 日窗口，上限 90） |
| POST | `/api/model-manager/quota/refresh` | 重新查询上游额度（渠道积分 + DeepSeek 钱包） |

所有路由先经过 Harness 的浏览器鉴权（`connection.admit`）；在未挂载该服务的组合中退化为结构校验：仅回环地址、禁止跨站请求、Origin/Referer 必须与 Host 同源。

## 安装

在 DSH 插件管理中安装本目录，或使用：

```
plugin_manager action=install_bundle target=<本目录绝对路径>
```

如遇 npm 镜像缺少平台包版本，可指定官方源：`registry=https://registry.npmjs.org/`。

安装后侧栏立即出现「模型管理」入口；Host 侧路由随插件加载生效，无需重启应用。

## 说明

- 「设为默认」只影响**新会话**。当前会话的模型请在输入框上方的模型菜单切换。
- 未激活供应商无法列举模型（没有适配器可查询），因此显示 `—`；先去对应设置页补全凭据即可启用。
- **额度口径**：积分/额度来自各供应商自己的接口，与各家 App 内显示一致；`余额查询失败` 表示该供应商接口暂时不可用，可稍后点「刷新额度」重试。
- **消耗口径**：token 数来自渠道账本与会话日志的实际用量；「加权÷日」= tokens × 价格倍率，用于横向比较消耗速度，不是货币金额。
- **可用天数**仅在额度以 token 计价时给出（如 ZCode），积分与货币没有到 token 的可靠换算，故不臆造。
- 插件为本地私有包（`private: true`），未发布到 npm。
