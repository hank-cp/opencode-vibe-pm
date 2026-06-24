# vibe-pm

## 概述

这是一个OpenCode的插件, 设计目的是让llm按照设计好的即定流程执行开发任务, 让所有设计开发工作稳定可控。

## 主要功能描述

### 要解决的问题

`AGENTS.md` / `rules/*.md` 全量强制加载浪费上下文窗口，且现有自动裁剪工具过程不透明、遗忘严重。

### 设计理念

将流程控制内容精确嵌入上下文与 Agent 交互，保证 vibe-coding 过程稳定可控，用户可按需定制流程。

### 任务驱动

每个任务以 Spec（做什么）、Task Plan（怎么做）、Task State（做到哪了）三要素驱动，由插件管理 FSM 步骤流转，关键节点 human-in-loop。

### 上下文注入

从 SQLite 读取当前步骤，提取 Flow、任务状态、Constitution、Regulation、Spec、Plan 等上下文，移除无关消息，注入最少但最相关的内容。

### 数据驱动优化

按步骤采集指标，任务结束后自动分析生成 Discussion 改进建议，用户可在碎片时间异步审阅落地。

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

## 开发环境说明

### 本地开发环境

目录结构、文件定位、符号查找 → **不手工维护**。使用以下命令自动生成/更新：

```bash
/understand          # 生成/刷新知识图谱（.understand-anything/knowledge-graph.json）
/understand-chat     # 基于知识图谱问答：「某个功能在哪个文件？」「X 的依赖关系是什么？」
/understand-dashboard # 启动交互式可视化面板
```

首次使用前运行一次 `/understand`，后续代码变更后重新运行即可。知识图谱自动跟踪文件结构、符号位置、依赖关系、架构分层，无需手动同步 AGENTS.md。

### 开发命令

```bash
bun run build       # tsc --emitDeclarationOnly + bun build 到 dist/
bun test            # bun test（一次性）
bun test --watch    # bun test watch 模式
bun run typecheck   # tsc --noEmit 仅类型检查
```

## 命令

| 命令 | 用途 |
|------|------|
| `/pm-init` | 引导式初始化向导 |
| `/pm-install-flow` | 从模板库安装流程 → 自动生成 `/pm-*` 命令文件 |
| `/pm-uninstall-flow` | 移除流程 → 同步清理命令文件 |
| `/pm-refine-flow` | 迭代优化流程定义 |
| `/pm-task-set-step` | 手动跳转到指定步骤 |
| `/pm-task-refresh` | 为当前步骤重新注入上下文 |
| `/pm-task-close` | 关闭任务，触发分析 |
| `/pm-research` | 启动调研任务（自动生成） |
| `/pm-project-build` | 启动项目搭建任务（自动生成） |
| `/pm-new-feature` | 启动新功能开发任务（自动生成） |
| `/pm-bug-fix` | 启动 Bug 修复任务（自动生成） |
| `/pm-large-refactor` | 启动大规模重构任务（自动生成） |

## 开发设计原则

### 最高原则

**以 `docs/regulation/constitution.md`（项目宪章）为最高权威。**

所有开发决策、代码变更、架构选择必须以宪章为准。宪章定义的核心原则概览：

| 原则 | 要点 |
|------|------|
| I. 流程+Spec+测试驱动 | Flow → Spec → Plan → Implement → Test，不可省略 |
| II. 类型安全至上 | 禁止 `any`、`@ts-ignore`、空 catch 块 |
| III. 验证强制性 | LSP 诊断、构建、测试三层验证必须通过 |
| IV. Mermaid 图表优先 | 禁止 ASCII art 图表 |
| V. 模块独立性 | 跨模块通过明确接口通信 |
| VI. 最小变更 | Bug 修复 ≠ 重构，优先编辑现有文件 |
| VII. SDK 优先开发 | 与 OpenCode 交互必须通过 `@opencode-ai/plugin` SDK |
| VIII. 中文优先沟通 | Thinking/Reply 用中文，代码/日志用英文 |
| IX. 尊重人工修改 | 禁止未经同意覆盖用户重构代码 |

宪章优先于具体规则，具体规则优先于口头惯例。规则冲突时以宪章裁决。

### 设计原则

- **精准优先于数量**：只注入当前步骤所需内容
- **LLM 判断流转**：模型决定 FSM 转换，非硬编码
- **关键节点人机协作**：用户审查计划、验收交付物
- **多语言支持**：字典优先的本地化
- **碎片时间友好**：非紧急讨论项暂存，异步审阅

### ANTI-PATTERNS（本项目的禁止做法）

- **不要**在代码中硬编码流程步骤 —— 步骤定义在 `docs/flow/` 的 Markdown 中
- **不要**绕过 TypeScript strict mode —— `tsconfig.json` 已启用 `strict: true`
- **不要**在测试中 mock SQLite 内部实现 —— 直接使用真实 SQLite 实例（嵌入式数据库无副作用）
- **不要**在 `template-manager.ts` 中引入接口抽象层 —— 纯文件操作模块，直接按约定路径读写
- **不要**修改 `docs/template/` 下内置模板的 `**Template ID**` 字段 —— 这是安装/卸载的唯一标识
- **不要**手动创建 `.opencode/commands/` 下的文件 —— 由模板安装流程自动生成

### 注意事项

- SQLite 运行时数据在 `.vibe-pm/`，已通过 `.gitignore` 排除
- `docs/flow/` 和 `docs/regulation/` 由用户操作产生，不纳入版本控制
- Spec 文档（`docs/spec/`）是设计权威来源，代码修改前先确认对应 Spec
- 测试镜像 `src/` 的目录结构：`tests/core/`、`tests/engine/`、`tests/memory/`、`tests/template/`
