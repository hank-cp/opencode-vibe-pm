# vibe-pm

OpenCode 插件。将 `AGENTS.md`/`rules/*.md` 全量加载替换为基于步骤感知的精准上下文注入：按当前流程步骤裁剪消息，注入最少但最相关的上下文，按步骤采集指标。

## 交互要求
- **Thinking** 思考过程用中文表述
- **Reply** 回答也要用中文

## 技术栈

| 组件 | 用途 |
|------|------|
| TypeScript (ES2022, NodeNext) | 实现语言 |
| `@opencode-ai/plugin` SDK | 钩子/命令/工具注册 |
| SQLite (better-sqlite3) | 嵌入式结构化记忆（任务状态、指标） |
| Zod | 运行时校验 |
| tiktoken | Token 计数 |
| Vitest | 测试框架 |

## 代码索引

目录结构、文件定位、符号查找 → **不手工维护**。使用以下命令自动生成/更新：

```bash
/understand          # 生成/刷新知识图谱（.understand-anything/knowledge-graph.json）
/understand-chat     # 基于知识图谱问答：「某个功能在哪个文件？」「X 的依赖关系是什么？」
/understand-dashboard # 启动交互式可视化面板
```

首次使用前运行一次 `/understand`，后续代码变更后重新运行即可。知识图谱自动跟踪文件结构、符号位置、依赖关系、架构分层，无需手动同步 AGENTS.md。

## 命令

| 命令 | 用途 |
|------|------|
| `/pm-init` | 引导式初始化向导 |
| `/pm-install-flow` | 从模板库安装流程 → 自动生成 `/pm-*` 命令文件 |
| `/pm-uninstall-flow` | 移除流程 → 同步清理命令文件 |
| `/pm-refine-flow` | 迭代优化流程定义 |
| `/pm-task-start` | 在流程下开始新任务 |
| `/pm-task-set-step` | 手动跳转到指定步骤 |
| `/pm-task-refresh` | 为当前步骤重新注入上下文 |
| `/pm-task-close` | 关闭任务，触发分析 |
| `/pm-research` | 启动调研任务（自动生成） |
| `/pm-project-build` | 启动项目搭建任务（自动生成） |
| `/pm-new-feature` | 启动新功能开发任务（自动生成） |
| `/pm-bug-fix` | 启动 Bug 修复任务（自动生成） |
| `/pm-large-refactor` | 启动大规模重构任务（自动生成） |

## 开发命令

```bash
bun run build       # tsc --emitDeclarationOnly + bun build 到 dist/
bun test            # bun test（一次性）
bun test --watch    # bun test watch 模式
bun run typecheck   # tsc --noEmit 仅类型检查
```

## 核心概念

### 记忆体系（双层）

| 类型 | 存储 | 特点 |
|------|------|------|
| MD 文档记忆 | `docs/flow/`, `docs/regulation/`, `docs/spec/` | 稳定，沉淀记忆 |
| 结构化记忆 | `SQLite`（`.vibe-pm/`） | 频繁读写：任务状态、Discussion、FlowMetrics |

### 任务模型（FSM 驱动）

每个任务：**Spec（做什么）→ Task Plan（怎么做）→ Task State（做到哪了）**。
LLM 判断 FSM 状态转换，非硬编码规则。

### 上下文注入（每次对话）

1. 从 SQLite 读取当前流程和步骤
2. 提取相关上下文：Flow 文档、任务状态、Constitution、当前步骤指定的 Regulation
3. 移除无关消息（裁剪）

### 数据采集（按步骤）

进入次数、Token 消耗、停留时间、人工介入时间、用户输入量。
任务结束后自动生成 Discussion 改进建议。

### Command 文件自动生成

安装流程模板时，若模板包含 `**Command**:` 元数据字段，自动在 `.opencode/commands/` 下创建对应 Markdown prompt 文件，包含适用场景、输入要求和执行步骤。卸载时同步清理。

## 设计原则

- **精准优先于数量**：只注入当前步骤所需内容
- **LLM 判断流转**：模型决定 FSM 转换，非硬编码
- **关键节点人机协作**：用户审查计划、验收交付物
- **多语言支持**：字典优先的本地化
- **碎片时间友好**：非紧急讨论项暂存，异步审阅

## ANTI-PATTERNS（本项目的禁止做法）

- **不要**在代码中硬编码流程步骤 —— 步骤定义在 `docs/flow/` 的 Markdown 中
- **不要**绕过 TypeScript strict mode —— `tsconfig.json` 已启用 `strict: true`
- **不要**在测试中 mock SQLite 内部实现 —— 直接使用真实 SQLite 实例（嵌入式数据库无副作用）
- **不要**在 `template-manager.ts` 中引入接口抽象层 —— 纯文件操作模块，直接按约定路径读写
- **不要**修改 `docs/template/` 下内置模板的 `**Template ID**` 字段 —— 这是安装/卸载的唯一标识
- **不要**手动创建 `.opencode/commands/` 下的文件 —— 由模板安装流程自动生成

## 注意事项

- SQLite 运行时数据在 `.vibe-pm/`，已通过 `.gitignore` 排除
- `docs/flow/` 和 `docs/regulation/` 由用户操作产生，不纳入版本控制
- Spec 文档（`docs/spec/`）是设计权威来源，代码修改前先确认对应 Spec
- 测试镜像 `src/` 的目录结构：`tests/core/`、`tests/engine/`、`tests/memory/`、`tests/template/`
