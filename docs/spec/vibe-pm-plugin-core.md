# Plugin Core Spec

**创建日期**: 2026-06-11
**状态**: Implemented
**输入来源**: XMind 设计文档 + OpenCode 插件 API 调研
**最后更新**: 2026-06-17 — 重构：LLM 主导流程控制，Hook 精简（移除 chat.message/system.transform），文件日志，模块直连

---

## 需求背景

Plugin Core 是 vibe-pm 插件的入口层，负责：插件初始化、命令注册（`/pm-*`）、配置加载、管理生命周期钩子，并编排各业务模块。

---

## 设计要点

### 领域模型

| 实体 | 属性 | 关系 |
|------|------|------|
| Plugin | `name`, `version`, `config`, `modules` | 包含 1:N 个 Module |
| Module | `name`, `init()`, `hooks` | 由 Plugin 组装到 Hooks |
| Command | `name`, `description`, `handler` | 通过 tool / config hook 注册 |
| PluginConfig | `language`, `dataDir`, `autoAnalyze`, `contextInjection` | 从 `.vibe-pm.json` 加载 |

### 关键路径

```mermaid
sequenceDiagram
    participant OC as OpenCode
    participant PC as Plugin Core
    participant Config as Config Manager
    participant Mem as MemorySystem
    participant Engine as FlowEngine

    OC->>PC: Plugin 初始化
    PC->>Config: ensureDefaultConfig() 创建 .vibe-pm.json（如不存在）
    Config-->>PC: 配置就绪
    PC->>Config: loadConfig() 加载配置
    Config-->>PC: PluginConfig
    PC->>Mem: new MemorySystem().init(dataDir)
    Mem-->>PC: AxioDB 就绪
    PC->>Engine: new FlowEngine(memory, projectDir)
    Engine-->>PC: 就绪
    PC->>OC: 注册 hooks (config/tool/messages.transform/event)
```

启动时确保 `.vibe-pm.json` 存在（不存在则创建默认配置）。目录结构（`docs/flow/` 等）由 `/pm-install-flow` 按需创建。

### 命令注册

vibe-pm 通过两种方式注册命令：

#### 方式 1: config hook（声明式）

```typescript
config: async (opencodeConfig) => {
  openencodeConfig.command ??= {};
  openencodeConfig.command["pm-init"] = {
    template: "Initialize vibe-pm project with guided questions",
    description: "Start vibe-pm initialization wizard",
    agent: "build",
  };
  openencodeConfig.command["pm-task-start"] = {
    template: "Start a new task in the current flow",
    description: "Begin a new task",
    agent: "build",
  };
  // ... 其他命令
};
```

#### 方式 2: tool hook（可执行）

```typescript
tool: {
  pm_init: tool({
    description: "Initialize vibe-pm project structure",
    args: { language: z.enum(["zh-CN", "en-US"]).optional() },
    async execute(args, ctx) {
      return await commands.init(args, ctx);
    }
  }),
  pm_task_start: tool({
    description: "Start a new task under a flow",
    args: { flow: z.string().optional() },
    async execute(args, ctx) {
      return await commands.taskStart(args, ctx);
    }
  }),
  // ... 其他工具
}
```

### 命令清单

| 命令 | 实现方式 | 功能 |
|------|---------|------|
| `/pm-install-flow` | config（声明式）+ Plugin Core 处理 | 从内置模板目录选择并安装流程 |
| `/pm-uninstall-flow` | config（声明式）+ Plugin Core 处理 | 移除一个流程 |
| `/pm-refine-flow` | config（声明式）+ Plugin Core 处理 | 迭代优化流程定义 |
| `/pm-task-start` | config + tool | 启动新任务 |
| `/pm-task-set-step` | config + tool | 手动跳转步骤 |
| `/pm-task-refresh` | config + tool | 重新注入当前步骤上下文 |
| `/pm-task-close` | config + tool | 关闭任务，触发分析 |
| `/pm-task-current-step` | config + tool | 获取当前活跃任务所在步骤，返回 JSON |
| `/pm-config` | config（声明式）| 查看或修改 .vibe-pm.json 配置 |

### 生命周期钩子编排

```mermaid
graph TD
    Init["Plugin 初始化"]
    Event["event hook"]
    Config["config hook"]
    MsgTransform["messages.transform"]

    Init --> Config
    Config --> Event
    Event -->|"session.created"| MsgTransform
    MsgTransform -->|"检测 flow → 创建任务 → 注入 <pm-control-rules>"| MsgTransform
```

Plugin Core 负责将各模块的实现函数绑定到对应钩子：

```typescript
export const VibePMPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  ensureDefaultConfig(ctx.directory);
  const config = loadConfig(ctx.directory);
  const dataDir = path.resolve(ctx.directory, config.dataDir);
  const pluginCtx: IPluginContext = { config, projectDir: ctx.directory, dataDir };

  const memory = new MemorySystem();
  await memory.init(dataDir);
  const engine = new FlowEngine(memory, ctx.directory);

  return {
    // 1. 命令注册（声明式）
    config: async (c: Config) => { registerCommands(c); },

    // 2. 工具注册（可执行命令）
    tool: registerTools(pluginCtx, engine),

    // 3. 消息转换：检测 flow 命令 → 自动创建任务 → 注入 <pm-control-rules>
    "experimental.chat.messages.transform": async (_input, output) => {
      for (const msg of output.messages) {
        const info = msg.info as { role?: string; id?: string; sessionID?: string };
        if (info.role !== "user") continue;
        const parts = msg.parts as { type: string; text: string }[];
        const flow = engine.detectFlowCmd(parts.filter(p => p.type === "text").map(p => p.text).join("\n"));
        if (flow && info.sessionID) {
          await engine.ensureTaskAndInject(info.sessionID, flow, parts, info.id ?? "", info.sessionID);
          return;
        }
      }
      // 无 flow 命令 → 清理旧控制提示
      for (const msg of output.messages) {
        engine.removeControlPrompt(msg.parts as { type: string; text: string }[]);
      }
    },

    // 4. 生命周期事件：清除命令映射缓存
    event: async ({ event }) => {
      if (event.type === "session.created") engine.clearCommandFlowCache();
    },
  };
};
```

### 配置管理

```typescript
// PluginConfig 类型定义
interface PluginConfig {
  language: "zh-CN" | "en-US";
  dataDir: string;                           // 默认 ".vibe-pm"
  autoAnalyze: boolean;                      // 默认 true
  contextInjection: {
    maxStepTokens: number;                   // 默认 0（不限制）
    pruneIrrelevant: boolean;                // 默认 true
  };
  debug?: {
    logFullRequest?: boolean;                // 默认 false。在 system.transform 末尾输出完整请求上下文
  };
}

// 加载逻辑
function loadConfig(projectDir: string): PluginConfig {
  const configPath = path.join(projectDir, ".vibe-pm.json");

  if (!fs.existsSync(configPath)) {
    // 返回默认配置，由 /pm-init 创建
    return DEFAULT_CONFIG;
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return { ...DEFAULT_CONFIG, ...raw };
}

// DEFAULT_CONFIG 完整定义
const DEFAULT_CONFIG: PluginConfig = {
  language: "zh-CN",
  dataDir: ".vibe-pm",
  autoAnalyze: true,
  contextInjection: {
    maxStepTokens: 0,       // 0 = 不限制
    pruneIrrelevant: true,
  },
  debug: {
    logFullRequest: false,  // 生产环境默认关闭
  },
};
```

### 项目技术栈

- **语言**: TypeScript
- **模块格式**: NodeNext ESM
- **编译目标**: ES2022
- **包管理器**: pnpm
- **测试框架**: vitest
- **参数校验**: zod

### 日志系统

文件日志，通过 `ILogger` 接口（debug/info/warn/error），异步写入 `~/.config/vibe-pm/logs/daily/YYYY-MM-DD.log`。按日滚动，静默失败不阻塞应用。文件日志取代 console 输出，避免破坏 OpenCode TUI。

---

## 接口设计

### Plugin Core 对外接口（供 Flow Engine / Memory 使用）

```typescript
interface IPluginContext {
  readonly config: PluginConfig;
  readonly projectDir: string;
  readonly dataDir: string;  // config.dataDir 的绝对路径
}
```

### 模块注册接口

`ModuleHooks` 和 `ModuleInit` 类型定义保留在 `types.ts` 中，以备将来扩展。当前 Plugin Core 直接实例化模块（见上），不使用注册模式。

```typescript
import type { Hooks } from "@opencode-ai/plugin";

interface ModuleHooks extends Partial<Hooks> {
  // 模块可以贡献任意钩子子集
}

type ModuleInit = (ctx: IPluginContext) => ModuleHooks;
```

### 模块接入机制

Plugin Core 直接通过 `new` 实例化 `MemorySystem` 和 `FlowEngine`，不通过 `ModuleInit`/`ModuleHooks` 注册模式。`ModuleHooks` 和 `ModuleInit` 类型定义保留在 `types.ts` 中，以备将来扩展。

---

## 测试用例

### plugin-config.test.ts

- **测试文件**: `tests/core/config.test.ts`
- **关联设计文档**: `vibe-pm-plugin-core.md`
- **Setup/Teardown**: 创建临时目录和 `.vibe-pm.json` 文件，测试后清理

| 动作指令 | 测试方法 | Given | When | Then | Notes |
|----------|----------|-------|------|------|-------|
| 新增 | `loadConfig_defaults` | `.vibe-pm.json` 不存在 | 调用 `loadConfig()` | 返回 DEFAULT_CONFIG | 首次使用的项目 |
| 新增 | `loadConfig_override` | `.vibe-pm.json` 存在，`language: "en-US"` | 调用 `loadConfig()` | 返回合并后的配置（language=en-US，其余默认） | 部分覆盖 |
| 新增 | `loadConfig_invalid_json` | `.vibe-pm.json` 内容为非法 JSON | 调用 `loadConfig()` | 返回 DEFAULT_CONFIG + 记录 warning | 容错处理 |

### plugin-init.test.ts

- **测试文件**: `tests/core/plugin.test.ts`
- **关联设计文档**: `vibe-pm-plugin-core.md`
- **Setup/Teardown**: 创建临时项目目录，Mock OpenCode PluginContext

| 动作指令 | 测试方法 | Given | When | Then | Notes |
|----------|----------|-------|------|------|-------|
| 新增 | `init_creates_data_dir` | 项目目录下无 `.vibe-pm/` | Plugin 初始化 | 创建 `.vibe-pm/` 目录和数据文件 | 首次安装 |
| 新增 | `init_registers_all_hooks` | 正常配置 | Plugin 初始化 | 返回的 hooks 对象包含 config, tool, messages.transform, event | 完整性检查 |
| 新增 | `init_creates_config_if_missing` | `.vibe-pm.json` 不存在 | Plugin 初始化 | 自动创建默认配置文件 | 首次使用的项目 |
| 新增 | `no_active_task_passthrough` | 当前 session 无活跃 Task + 无 flow 命令 | `messages.transform` 钩子触发 | 清理旧控制提示，不做注入 | 无任务时不干预 |

### plugin-commands.test.ts

- **测试文件**: `tests/core/commands.test.ts`
- **关联设计文档**: `vibe-pm-plugin-core.md`
- **Setup/Teardown**: Mock OpenCode config 对象

| 动作指令 | 测试方法 | Given | When | Then | Notes |
|----------|----------|-------|------|------|-------|
| 新增 | `register_all_commands` | 空 command 配置 | 调用 `registerCommands()` | config.command 包含全部 8 个 `/pm-*` 命令 | 命令完整性 |
| 新增 | `command_no_duplicate_key` | 已有同名命令 | 再次注册 | 后者覆盖前者，不抛异常 | 幂等性 |

---

## 边界与错误情况

| 场景 | 预期行为 |
|------|---------|
| `.vibe-pm.json` 不存在 | 自动创建默认配置文件 |
| `.vibe-pm/data.json` 不存在 | MemorySystem 自动创建空数据库 |
| 会话无活跃任务 + 检测到 flow 命令 | 自动创建任务 + 注入 `<pm-control-rules>` |
| 会话无活跃任务 + 无 flow 命令 | messages.transform 清理旧控制提示，不做注入 |
| 配置项格式错误 | 使用默认值，记录 warning 日志 |
| 命令重复注册 | 后者覆盖前者 |

---

## 约束与限制

### 技术约束

- Plugin Core 通过 `@opencode-ai/plugin` SDK 获取 OpenCode 交互类型（`Plugin`、`PluginInput`、`Hooks`、`tool()`）
- `experimental.*` 钩子可能在后续版本变化，Plugin Core 需通过抽象层隔离实验性 API
- 命令注册分 config + tool 两层，需保证两者一致

### 业务约束

- 不联网（当前阶段）
- 不删除任何用户文件
- 配置文件变更需 `/pm-init` 或 `/pm-refine-flow` 触发，不能自动修改

### 已知风险

- `experimental.chat.messages.transform` 在后续 OpenCode 版本中可能被移除或合并

### 影响范围

- 无现有代码影响（新项目）

---

## 开发进度

> 本部分在开发过程中持续更新。

### 已实现功能

- Plugin Core 入口（`VibePMPlugin`）+ 启动时自动创建默认配置
- 配置管理（`loadConfig` + `DEFAULT_CONFIG` + `ensureDefaultConfig`，支持深度合并/自动创建）
- 8 个 `/pm-*` 命令注册（config hook + tool hook）
- 文件日志系统（`ILogger` → 按日滚动）
- FlowEngine 集成（任务自动创建 + `<pm-control-rules>` 注入 + 控制提示清理）
- 核心类型定义（`PluginConfig`, `IPluginContext`, `ILogger`，OpenCode 交互类型来自 SDK）
