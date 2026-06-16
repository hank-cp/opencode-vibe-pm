# vibe-pm 项目宪章

**版本**: 1.0.0 | **批准日期**: 2026-06-11 | **最后修订**: 2026-06-11

---

## 核心原则

### I. 流程+Spec+测试驱动开发（Flow + Spec + Test-Driven Development）

三者缺一不可：

- **流程（Flow）** — 保证团队理解一致。通过结构化步骤流转消除歧义，让每个参与者对"做什么、做到哪了"有统一认知。
- **Spec（技术规格）** — 沉淀技术决策。将架构选择、接口约定、边界条件等关键决策固化为文档，避免口口相传导致的信息衰减。
- **测试（Test）** — 保证交付质量。以可验证的方式定义"完成"，让回归问题在第一时间被发现。

具体执行：

- 所有非琐碎开发任务必须经过 Flow → Spec → Plan → Implement → Test 流程
- 使用 `/pm-task-start` 启动任务，由插件管理步骤流转
- Feature Spec 需经需求澄清访谈（S4）完善，减少"需求不明确"导致的返工
- 任务计划必须通过人工评审（S6）后才能进入实现阶段

### II. 类型安全至上（NON-NEGOTIABLE）

- **禁止** `any`、`@ts-ignore`、`@ts-expect-error` 等类型逃逸手段
- **禁止** 空 catch 块 `catch(e) {}`
- 接口定义在使用方，接受接口返回具体类型
- 所有错误必须显式处理（传递/包装/处理/终止）

### III. 验证强制性（Verification Mandatory）

所有代码变更必须经过三层验证：

1. **LSP 诊断**: 变更文件的 `lsp_diagnostics` 必须零 error
2. **构建**: 项目构建命令退出码必须为 0
3. **测试**: 测试命令必须全部通过（或明确标记为预存失败）

**禁止** 跳过测试、删除失败测试来"通过"、或在未验证的情况下声称"应该可以"。

### IV. Mermaid 图表优先

所有架构图、流程图、状态图、时序图**必须使用 Mermaid** 绘制。

- **禁止**使用 ASCII art 绘制图表
- Mermaid 支持类型：`graph`、`sequenceDiagram`、`stateDiagram`、`classDiagram`、`flowchart` 等
- 若 Mermaid 无法表达（如复杂 UI 布局），可例外使用文字描述

### V. 模块独立性（Module Independence）

- 模块间通过明确接口通信，禁止跨模块直接访问内部实现
- 遵循固定目录约定，不将不同职责的代码混放
- 插件核心逻辑与 TUI 展示层分离

### VI. 最小变更原则（Minimal Change）

**Bug 修复 ≠ 重构**。修复只改问题本身，不清理周围代码。

- 修复 bug 时绝不引入无关重构。如有重构需要，独立成单独的任务
- 不创建无必要的抽象层（**重复 > 过早抽象**）
- 优先编辑现有文件，不创建新文件除非绝对必要
- 不添加"不可能发生"的错误处理代码。只在系统边界验证（用户输入、外部 API）

### VII. 优先基于 SDK 开发（SDK-First Development）

与 OpenCode 宿主环境的交互**必须**通过 `@opencode-ai/plugin` SDK 进行：

- 插件入口类型使用 `Plugin` / `PluginInput`，**禁止**手写 OpenCode 交互类型
- 工具注册使用 `tool()` 工厂函数配合 Zod schema，**禁止**手动构造工具对象
- Hook 签名使用 SDK 提供的 `Hooks` 类型，**禁止**本地定义替代
- 当 SDK 能力不足时，先评估是否为暂时性缺失（等待 SDK 更新）还是永久性缺口（再手写补充）

例外：项目自有领域类型（如 `PluginConfig`、`IPluginContext`）不受此限制。

### VIII. 中文优先沟通（Chinese-First Communication）

- **Thinking** 思考过程用中文表述
- **Reply** 回答用中文
- 代码注释和标识符使用英文
- 日志输出使用英文（便于工具处理）

---

## 附加约束

### 技术栈

- **语言**: TypeScript（严格模式）
- **SDK**: `@opencode-ai/plugin`（OpenCode 插件开发）
- **数据库**: AxioDB（结构化记忆存储）
- **运行环境**: OpenCode 插件运行时
- **TUI**: 终端信息展示

### 架构约束

- 插件通过 `@opencode-ai/plugin` SDK 与 OpenCode 宿主通信，禁止手写 OpenCode 交互类型
- 结构化记忆通过 AxioDB 读写，不直接操作文件
- MD 文档记忆通过文件系统读取，不缓存过时内容
- TUI 展示与插件核心逻辑解耦

### 目录约束

```
/docs/flow/         — 流程定义（不可随意修改，变更需走流程）
/docs/regulation/   — 宪法、编码风格、检查清单、字典
/docs/spec/         — 程序规格说明
/docs/plan/         — 任务计划
/docs/template/     — 流程模板
src/                 — 源代码
tests/               — 测试代码（或被测文件同目录）
```

### 零容忍

| 违规行为 | 处理 |
|----------|------|
| 类型逃逸（`any` / `@ts-ignore`） | 必须重写 |
| 跳过需求澄清 S4 直接实现 | 回退所有变更 |
| 删除失败测试"通过" | 恢复测试 + 修复根因 |
| 在 bug 修复中掺入重构 | 拆分为独立任务 |

---

## 规约变更管理

### 规则文件层级

```
docs/
├── flow/
├── regulation/
│   ├── constitution.md               ← 顶层宪章（本文件），不可妥协的原则
│   ├── coding_style.md               ← TypeScript 编码风格
│   ├── checklist.md                  ← 质量门控清单
│   └── dictionary.md                 ← 术语中英对照
├── spec/
├── plan/
└── template/
```

### 冲突裁决

宪章优先于具体规则，具体规则优先于口头惯例。
