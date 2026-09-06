# PaperDesk AI 与本机数据

## 使用与边界

聊天只属于当前已连接项目。关闭项目后输入禁用；切换项目自动显示它最近使用的会话，不提供全局/scratch 聊天。Reader 与 Writer 共用状态，圆角悬浮框上层输入、下层放模型选择及会话操作。

输入框依次选择 Agent（当前仅 Pi）、服务商、模型、思考程度。服务商来自当前安装的 Pi ModelRegistry / OAuth 注册表，已配置与未配置分组、组内按名称排序去重。“已配置”指存在凭据，不代表已成功推理。未配置服务商打开就地配置窗口，和 AI 设置页共用 `ProviderConfiguration`。API Key 不回显，不保存到浏览器或工程；网页登录仅使用 Pi 实际支持的 OAuth、设备码、回调流程，不读取 Cookie。用户主动点击官方入口或登录操作才打开相关页面。官方入口的来源记录在 `app/src/settings/providerHelp.ts`；自定义服务商不猜测官网。

模型和思考选择写入当前工程的 `ai` 覆盖，不修改全局默认。服务商改变会清空旧模型和思考选择。思考档位来自 Pi 的 `getSupportedThinkingLevels`；后端校验并通过 `createAgentSession({thinkingLevel})` 消费，不支持 reasoning 的模型禁用该选择。未配置时聊天只有灰色禁用状态；详细配置指导放在设置/弹窗。

Pi 通过官方 Node SDK 启动，显式传入真实 cwd、AuthStorage、ModelRegistry、SessionManager、SettingsManager 和资源加载器。不发现或加载个人 `.pi` 扩展/技能，不加载模拟模型，不执行 shell。每个项目同一时间一个运行任务；不同项目独立。断开流或切换项目会取消旧任务；失败/取消状态与历史落盘，不伪装为完成。

项目默认工具为 `project_list`、`project_read`，能从磁盘探索/读取文件，并非仅接收当前编辑器片段。可显式关闭文件工具，或启用 `project_edit` / `project_write`。写入模式要求全部草稿已保存，且没有其他项目操作进行中。工具拒绝越界、隐藏路径、外部/隐藏目标符号链接与多重硬链接。写入后重新读工程并合并编辑缓冲。当前文档上下文明确标记为可能未保存的草稿，不替代磁盘内容。

路径验证是应用工具边界，不是恶意本地进程的 OS 隔离沙箱。拥有同一操作系统账户权限的其他进程仍能替换文件/改动用户数据。

## 存储布局

默认 `~/.paperdesk`；启动前通过 `PAPERDESK_DATA_DIR` 指定其他本机目录。没有迁移或改写个人 `~/.pi` 凭据。

- `pi/auth.json`：Pi 标准认证存储，0600 文件权限；不是系统钥匙串。
- `pi/models.json`：自定义兼容服务商模型定义，不存用户 Key。SDK 必需的自定义认证引用由 PaperDesk 私有认证存储解析，未保存真实凭据不会成为可用模型。
- `ai/settings.json`：全局 AI 默认配置。
- `projects/index.json`：项目 ID、真实路径、目录设备/inode 索引。
- `projects/<id>/chat/`：会话索引、当前会话、消息/状态与 Pi 原生 JSONL。
- `storage/preferences/default.json`：个人偏好和快捷键。
- `storage/library/default.json`：论文元数据、BibTeX、笔记和编码的 PDF/文件附件。
- `storage/recent/`、`storage/roots/`、`storage/bindings/`：本机项目记录、授权根目录元数据和路径提示。
- `storage/session/current.json` 与 `storage/session/<id>.json`：当前和各项目的恢复版本，保留草稿、原磁盘基线、诊断与编译状态。
- `migration/`：按内容哈希归档冲突的旧浏览器版本，重复迁移不会不断创建相同备份。
- `logs/<date>.jsonl`：仅记录事件类别、项目/会话 ID、状态，不记录 Key、提示词或正文。

工程 `.paperdesk/project.json` 保存稳定 `projectId`、项目设置和 AI 覆盖。机器路径、聊天、认证由全局本机目录管理。旧 `paperdesk.json` 保留为迁移备份。新目录证明使用每次请求独立的 nonce 文件，结束只清理自己的证明，避免 Git/AI 并发互删。

移动后重新连接新位置保持 ID 和历史。原位置仍存在时，新副本必须显式选择“作为独立副本连接”，新建 ID，不混合历史。目录被替换或项目 ID 改变时拒绝继续使用旧绑定。删除工程目录不会隐式删除本机 AI 历史；历史清理是独立的显式操作。

## 迁移与恢复

本机存储是主数据源，IndexedDB/localStorage 仅保留浏览器目录句柄、兼容缓存和迁移备份。浏览器句柄不能跨浏览器搬移；清除浏览器数据后，本机列表/内容仍存在，但打开磁盘目录需要重新选择目录恢复浏览器访问能力。路径提示本身不授予目录访问，绑定仍必须验证文件系统证明。

迁移不清空旧浏览器数据。已有本机数据优先；不同版本先归档，含草稿的恢复冲突可手动恢复。写入使用版本号检测其他窗口修改，冲突不覆盖主数据；失败保留浏览器恢复备份并报告。恢复写入失败会阻止关闭项目宣称成功。大型附件当前以内嵌 Base64 存储，单次本机请求限 150 MB；超限明确失败，原数据不清理。

云厂商（如 Vertex / Bedrock）的额外账户环境配置沿用 Pi 支持的本机凭据方式，弹窗提供官方配置入口，不把普通 Key 输入冒充云账户登录。真实 OAuth 授权、账号权限、额度、网络与推理结果必须由用户自行完成登录后验证；本次实现与测试均未登录用户账号或执行付费/外部推理。

## 验证

- `npm --prefix app test`：55 项现有回归和论文库元数据测试。
- `npm --prefix app run test:ai`：临时数据目录、真实 Pi SDK、仅回环地址的协议测试服务。覆盖身份/移动/复制/并发证明、工具读写与路径边界、流式续接、会话隔离、并发拒绝、取消、失败、认证响应脱敏、OAuth 成功/失败/取消协议、CAS 与迁移归档；另用隔离 IndexedDB 验证附件/Bib/笔记、草稿基线/诊断、恢复冲突、最近移除、离线保留、服务商分组排序与状态刷新。
- `npm --prefix app run test:local`：真实 TeX 八模板、Git、诊断与 ChkTeX 回归。
- `npm --prefix app run build`：TypeScript 和生产构建。

协议/OAuth 替身仅注册在隔离测试进程，正常应用不提供测试模型或测试登录入口。聊天、设置与项目身份入口已完成浏览器界面验收。

### Credential checks and provider errors

Saving an API key performs a single read-only check where a documented endpoint is available; it never falls back to inference. OpenAI, Anthropic and Google model-list probes authenticate the supplied credential. OpenCode's public model catalog only establishes reachability, so its result says the credential was saved and the service is reachable, not that authentication succeeded. Other providers without an implemented reliable probe remain configured. A failed check preserves any previously stored credential.

Provider failures retain sanitized SDK `errorMessage` text (not claimed to be the full HTTP response), and credential-probe failures retain sanitized HTTP status/body. Classification does not replace the original message. Known stored credentials and common token/header/private-home-path patterns are redacted; output is rendered as text. Long details can be expanded. Historical SDK failures are recovered only when the error records correspond unambiguously by count/order.

Writer's transcript starts at 20% of its pane height, scrolls internally, can be resized from its top edge within bounds, and collapses independently of the input. Empty conversations do not create a transcript panel. The composer uses two rows, with the existing four selection controls below the prompt.

The composer's compact new-conversation/history buttons use the existing project-local native session store. New conversations persist an empty session without inference or deletion. The on-demand history popover shows titles, creation times and message counts, and searches titles and saved message/error text within the current project only. Restoring persists the active session for reload. New/restore actions are disabled during generation, with client transition guards and server rejection of cross-session switches while running. No history deletion action is added to this popover.

### Model discovery (September 2026)

Model choices no longer use Pi's bundled model IDs as a live catalog. Configured OpenCode Zen, OpenAI, Anthropic and Google connections request their documented model-list endpoints. OpenCode's public directory determines membership; it does not establish account permission. Authenticated lists likewise cannot guarantee future quota or inference success. Runtime protocol, context/output limits, modalities and explicit thinking effort values come from models.dev (also used by OpenCode), with fixed provider protocol adapters. Models without enough verified metadata are listed unavailable rather than assigned invented capabilities. The resulting supported entries replace that provider's Pi runtime registration, so discovery and actual session lookup share the same IDs. A removed current choice is preserved but unavailable; no automatic replacement or inference occurs.

Successful catalogs persist under ai/model-catalogs, keyed by provider and a credential fingerprint, without credentials in content. Menu opening, provider switching and restart reuse the saved catalog without age-based re-fetching. Successful credential/OAuth configuration and the explicit model-menu refresh action fetch again. Refresh errors or anomalous empty lists preserve the same connection's last successful catalog, record its stale state, and expose the actual failure; changing credentials cannot reuse another credential's cache. Source and update time remain in the local cache; the menu shows only compact refresh/settings actions and actual errors.

Providers without an implemented reliable discovery adapter have no discovered choices; the AI settings offer an advanced manual compatible-provider/model form. User-entered manual model IDs remain explicitly manual, with no fallback to a bundled provider list. Discovery performs read-only requests only. Sources: https://opencode.ai/docs/zen/ , https://opencode.ai/docs/models/ , https://models.dev/api.json , https://developers.openai.com/api/reference/resources/models/methods/list , https://platform.claude.com/docs/en/api/models/list , https://ai.google.dev/api/models .

AI settings now share the standard settings shell, category navigation, global/project switch, max-w-3xl content area and SettingsRow component. Provider management is searchable with configured providers first and uses the existing configuration dialog. Cache metadata is not displayed; advanced manual forms expand on demand. Global defaults and project inheritance/overrides remain separate, including model-supported thinking levels. No settings are written just by opening the page.
