# Spec: OpenCode V2 插件接口迁移

**Status**: Implemented（2026-10-21）
**Scope**: `vibe-pm` 服务端插件 + TUI 插件从 OpenCode V1 插件 API 迁移到 V2
**Target runtime**: `@opencode/plugin@2.1.1` / `@opencode/client@2.1.1`（本机 `opencode v2.1.1`）

---

## 1. 背景与目标

OpenCode V2 引入**全新的插件 API**。官方迁移指南明确：*V1 plugin implementations do not run in V2*。
本项目当前实现基于 `@opencode-ai/plugin@1.17.4` + `@opencode-ai/sdk`，在 V2 下完全无法加载。

目标：插件在 OpenCode V2 下完整可用，保持现有业务行为（Flow FSM 管控、上下文注入、token 度量、命令/工具、TUI 侧栏）。

**决策：仅支持 V2。** 不实现官方指南中的 "one package exports both" 双形态。理由：双形态会让 hooks/tools 逻辑翻倍且无法共享，
与本项目「优雅、直达核心」原则冲突（宪章 VI）。需要回退 V1 支持时另开分支。

---

## 2. 依赖变更

| V1 | V2 |
|---|---|
| `@opencode-ai/plugin` | `@opencode/plugin` |
| `@opencode-ai/sdk` | `@opencode/client` |
| `@opencode-ai/plugin/tui` | `@opencode/plugin/tui` |

`@opencode/ai` 作为类型来源（`Message` / `ContentPart` / `SystemPart` / `GenerationOptionsFields`），
`@opencode/schema` 作为消息/用量类型来源（`TokenUsage.Info`、`SessionMessageInfo`）。

`peerDependencies` 更新为 `"@opencode/plugin": "^2.1.1"`。

> **注意**：`@opencode/ai` / `@opencode/schema` 是 `@opencode/plugin` 的传递依赖。类型是 `import type`，
> 运行时不产生 import，因此不需列为直接依赖；若 `tsc` 报解析失败则加入 `devDependencies`。

---

## 3. 入口与上下文

### 3.1 入口

```ts
// V1
export const VibePMPlugin: Plugin = async ({ directory, client }) => ({ /* hooks */ })

// V2
import { Plugin } from '@opencode/plugin'
export default Plugin.define({
  id: 'vibe-pm',           // 稳定 ID，storage 作用域依赖它
  async setup(ctx) { /* 注册一切 */ return cleanup },
})
```

`setup` 可返回 cleanup 函数。事件订阅必须在 cleanup 中 abort。

### 3.2 上下文映射

| V1 | V2 |
|---|---|
| `input.directory` | `ctx.location.directory` |
| `input.project` | `ctx.location.project` |
| `input.client` | 域方法 `ctx.session` / `ctx.tool` / `ctx.command` … |
| `input.options` | `ctx.options` |
| 返回的 `dispose()` | `setup` 返回的 cleanup |
| 返回的 `event` hook | `ctx.event.subscribe({ signal })` |
| 返回的 `config` / `tool` 变更 | 对应域的 `transform(...)` |

### 3.3 hook 映射

| V1 扩展点 | V2 API |
|---|---|
| `config`（注册 command） | `ctx.command.transform(...)` |
| `tool` map | `ctx.tool.transform(...)` |
| `experimental.chat.messages.transform` | `ctx.session.hook("context", ...)` |
| `event` | `ctx.event.subscribe()` |

> `context` hook 只覆盖 agent loop。`compaction` / `generate` / `title` 是独立 hook。
> vibe-pm 的上下文注入只作用于 agent loop，故只注册 `"context"`。

---

## 4. 行为等价性要求（逐项）

### 4.1 命令注册

V1 通过 `config.command` 写 `template`，V2 改为代码式 `CommandDefinition`：

```ts
await ctx.command.transform((editor) => {
  editor.add({
    name: 'pm-task-close',
    description: '…',
    execute: async ({ sessionID, prompt, delivery }) => {
      await ctx.session.prompt({ ...prompt, sessionID, text: `${TEMPLATE}\n\n${prompt.text}`, delivery })
    },
  })
})
```

`registerFlowCommands` 扫描 `docs/flow/*.md` 动态生成的命令同理。

### 4.2 工具注册

V1 `tool({ args: zod, execute })` → V2 `editor.add({ name, description, input: JSONSchema, execute })`。

- **schema**：V2 `Tool.ValueSchema` 支持 `JsonSchema | StandardSchemaV1 | effect Schema.Codec`。
  项目当前用 `zod@3.23`（**不满足 StandardSchemaV1**）→ 一律改用**原生 JSON Schema 字面量**，
  在 `execute` 内显式声明参数类型（现有代码已是这种写法）。
- **返回值**：V1 `execute` 直接返回 `string`；V2 必须返回 `{ content: string }`。
- **工具名**：V1 用 map key（`pm_install_flow`）；V2 用 `name` 字段，命名保持不变。

### 4.3 上下文注入 + token 度量（`context` hook）

V1 `experimental.chat.messages.transform` 的 `output.messages: Message[]`，其中
`Message = { info, parts }`。**V2 完全改模型**：

```ts
// V2 SessionContext
{ sessionID, agent, model, system: SystemPart[], messages: Message[], tools, options }
```

`@opencode/ai` 的 `Message = { id?, role: 'system'|'user'|'assistant'|'tool', content: ContentPart[] }`，
`ContentPart` 的 `type` 取值为
`text | media | tool-call | tool-result | reasoning | compaction | effort`。

| V1 | V2 |
|---|---|
| `msg.info` | `msg` 本身（`role` 在顶层） |
| `msg.parts` | `msg.content` |
| `part.type === 'tool'` | `part.type === 'tool-call'` |
| `msg.info.sessionID` | `event.sessionID`（hook 顶层） |
| `msg.info.model.providerID` | `event.model.providerID` |
| `msg.info.tokens`（ApiTelemetry） | V2 `Message` 上**没有** usage → 走 `ctx.session.context({ sessionID })` |

`ApiTelemetry` 语义与 V2 `TokenUsage.Info` 完全一致：
`{ input, output, reasoning, cache: { read, write } }`。**无需转换。**

`outOfControl` 检测（检测 `todowrite` 工具调用）改为直接读 `event.tools` 键，
不再遍历 message content。

`sessionID` 来源：V1 取 `output.messages[0].info.sessionID`；V2 直接用 `event.sessionID`。

### 4.4 Prompt 注入

`injectFlowControlPrompt` / `injectFlowWarningPrompt` / `removeControlPrompt` 操作的是
`parts` 数组。V2 改为操作 `Message.content`。注入的合成 text part 只需
`{ type: 'text', text }`（V1 的 `id` / `messageID` / `sessionID` / `synthetic` 字段在 V2 `TextPart` 中不存在，
用 `metadata` 承载 `synthetic: true` 标记以便 `removeControlPrompt` 识别）。

### 4.5 子会话（review / journal）

`SubsessionClient` 收窄到三个原语，V2 重写为：

| 操作 | V2 |
|---|---|
| 创建子会话 | `ctx.session.create({ parentID, title, permissions })` |
| 发 prompt 并等回复 | `ctx.session.prompt({ sessionID, text })` + `ctx.session.wait({ sessionID })`，再 `ctx.session.context({ sessionID })` 取最后一条 assistant 文本 |
| 取最近消息 | `ctx.session.context({ sessionID })` |

> **行为缺口（已知且接受）**：V1 `session.prompt({ body: { tools } })` 可对子会话限制工具白名单；
> V2 `SessionPromptInput` **没有 `tools` 字段**。
> 替代方案：创建子会话时传 `SessionCreateInput.permissions`（有序权限数组），显式 `deny` 掉
> `edit` / `subagent` / `websearch` 等非只读能力。
> 注意 V2 权限动作重命名：`bash` → `shell`，`task` → `subagent`，`write` / `patch` → `edit`。
> 语义从「白名单」变为「黑名单」，在 Spec 中显式记录。

### 4.6 事件订阅

V1 `event: async ({event}) => { if (event.type === 'session.created') … }`
→ V2 `ctx.event.subscribe({ signal })` 异步迭代 + `setup` cleanup 中 `controller.abort()`。

### 4.7 日志

**V2 删除了 `client.app.log()`**（V2 client 无 `app` 命名空间，`ctx.app` 只有 `name/version/channel`）。

替代：`src/core/logger.ts` 保留 `ILogger` 公共接口不变，底层改为
`console.log/info/warn/error`（官方 V2 插件示例均用 `console`，输出进服务端日志），
并可写文件到 `<dataDir>/logs/vibe-pm.log` 作为诊断兜底。调用方 0 改动。

### 4.8 TUI 插件

| V1 | V2 |
|---|---|
| `@opencode-ai/plugin/tui` 的 `TuiPlugin` / `TuiPluginApi` | `@opencode/plugin/tui` 的 `Plugin.define({id, setup(ctx)})` |
| `api.slots.register({ order, slots })` | `ctx.ui.slot({ append: 'sidebar.content', render(input) })` |
| `api.state.path.directory` | `ctx.location?.directory` |
| `props.session_id` | `input.sessionID`（slot 输入自带） |
| 模块 default export `{ id, tui }` | `export default Plugin.define({ id:'vibe-pm', setup })` |

V2 slot 采用「最后一个 claim 胜出」的 `prepend/append/before/after/replace` 模型，
vibe-pm 用 `append`（原 V1 `order: 150` 表示排在中间，V2 无 order 概念）。

---

## 5. 影响文件清单

| 路径 | 变更性质 |
|---|---|
| `package.json` | 依赖坐标替换 |
| `src/core/types.ts` | V2 类型契约（共享） |
| `src/core/plugin.ts` | 入口 + hook 注册重写 |
| `src/core/logger.ts` | 去 `app.log` |
| `src/core/commands.ts` | 命令/工具注册全面重写 |
| `src/index.ts` | default export |
| `src/engine/subsession-client.ts` | session 域 API 重写 |
| `src/engine/review-agent-manager.ts` | 工具白名单 → 权限黑名单 |
| `src/engine/journal-manager.ts` | 同上 |
| `src/engine/flow-engine.ts` | `Part[]` → `ContentPart[]` |
| `src/token/types.ts` / `token-counter.ts` | 消息模型重写 |
| `src/tui/**` | TUI 插件 API 重写 |
| `scripts/build-tui.ts` | externals 列表 |
| `tests/**` | 类型跟随 |

---

## 6. 验证

1. `bun run typecheck` —— 全量零错误（宪章 III）
2. `bun test` —— 全绿
3. `bun run build` —— 产出 `dist/index.js` + `dist/tui/index.js`
4. 冒烟：在本项目加载插件，确认 `/pm-install-flow` 命令与 `pm_*` 工具出现在 `ctx.command.list()` / `ctx.tool.list()`

## 7. 非目标

- 不实现 V1/V2 双形态入口
- 不新增功能
- 不改 Flow 文档语义与 i18n 文案

---

## 8. 实施结果（落地后回填）

### 8.1 验证状态

| 项 | 结果 |
|---|---|
| `bun run typecheck` | 零错误 |
| `bun run lint` | 零错误 |
| `bun test` | 275 pass / 0 fail / 23 files |
| `bun run build` | `dist/index.js` + `dist/tui/index.js` 均产出 |
| 端到端冒烟（对构建产物） | 15/15 |

冒烟覆盖：插件 id、cleanup 返回、8 命令 + 8 工具注册（含 `docs/flow` 动态发现）、
工具 JSON Schema 输入与 `{ content }` 返回、`context` hook 在 `<auto-slash-command>`
之后插入 `<protect>` 控制提示、todowrite 触发 warning、无活动任务时只清理不注入。

### 8.2 与本文档的偏离

1. **命令注册多收一个 `session` 参数**。`CommandDefinition.execute` 必须能投递 prompt，
   而 `CommandEditor.add` 的定义本身不含 session 域，故签名改为
   `registerCommands(editor, session)` / `registerFlowCommands(editor, projectDir, session)`。
   transform 回调仍保持同步、无副作用（仅在闭包中捕获 session 引用）。
2. **合成 prompt part 的标记字段位置变化**。V1 用顶层 `synthetic: true`，V2 `TextPart`
   无该字段，改用 `metadata: { synthetic: true }`。`removeControlPrompt` 的识别仍走文本
   判定（`isControlPromptPart` / `isWarningPromptPart`），行为不变。
3. **注入条件未变化**。V1 与 V2 都是「有活跃任务就注入」；存在 `<auto-slash-command>` 时插在其后，
   否则追加到末尾。V1 名为 `skips when no auto-slash-command` 的用例实际测的是「无活跃任务」，
   已重写为两个正反用例锁定真实语义。
4. **`todowrite` 工具名不做硬编码**。内置工具名不在 schema 类型中，且历史上出现过
   `todo_write` 拼写，改为大小写/分隔符不敏感匹配。
5. **apiTelemetry 的取数改为异步并行**。V2 `Message` 不带 usage，只能读
   `session.context()`；改为与计数循环并行发起，且首轮请求（无 assistant 消息）直接跳过。
6. **TUI slot claim 的 disposer 作为 cleanup 返回**。V2 支持插件热重载，
   `setup` 返回 `ctx.ui.slot(...)` 的返回值以确保卸载时释放 claim。
7. **新增 devDependency `@opencode/theme`**。V2 `Context.theme` 的类型来自该包；
   缺失时 `skipLibCheck` 会把 `ctx.theme` 静默降级为 `any`，主题路径拼错无法被编译发现。
8. **`eslint.config.js` 为 `src/core/logger.ts` 关闭 `no-console`**。V2 删除了
   `client.app.log()`，console 是官方 V2 插件文档给出的日志输出路径。

### 8.3 已知行为降级（接受）

| 降级 | 原因 | 影响 |
|---|---|---|
| 子会话工具**白名单 → 权限黑名单** | V2 `SessionPromptInput` 无 `tools` 字段 | 审查/记录子会话改为 deny `edit`/`subagent`/`websearch`；journaler 由「仅 read」放宽为「除上述三项外皆可用」 |
| excerpt 不含 `synthetic`/`system`/`shell` 消息 | V2 消息模型拆分 | 记录员/审查员的会话摘录可能少注入的流程文本 |
| 日志不再走 host 结构化日志 API | V2 移除 `client.app.log()` | 改为 console + 可选 `<dataDir>/logs/vibe-pm.log` 文件 |
| `session.context()` 每次模型请求拉一次全量 transcript | V2 usage 不在消息上 | 长会话有额外 IO；已并行化并跳过首轮 |
| TUI slot 无排序能力（`order: 150` 退化） | V2 slot 模型无 order 概念 | 侧栏固定追加到边界末尾 |

### 8.4 宪章同步

`docs/regulation/constitution.md` 已于 2026-10-21 随本次迁移同步更新至 **1.5.0**：

- 技术栈：宿主明确为 OpenCode V2；SDK 改为 `@opencode/plugin`；TUI 明确为 slot 机制
- 「SDK 优先」约束按 V2 域模型重写（入口 / 域 / 工具 / 命令 / Hook / transform 六项约定）
- 新增「宿主类型不得静默降级」约束（源于 `@opencode/theme` 缺失导致 `ctx.theme` 退化为 `any` 的发现）
- 零容忍新增两条：硬编码宿主未在类型层声明的标识符；仅凭源码层测试判定插件装配正确
  （两条均源于本次迁移实际暴露的问题）