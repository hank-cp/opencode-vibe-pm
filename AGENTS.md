# vibe-pm

OpenCode 插件，用于结构化的 vibe-coding 项目管理。将粗暴的 `AGENTS.md`/`rules/*.md` 全量加载模式替换为精准的、基于步骤感知的上下文注入。

## 交互要求
- **Thinking** 思考过程用中文表述
- **Reply** 回答也要用中文

## 解决了什么问题

根据当前任务状态（哪个流程、哪个步骤），向每次 OpenCode 对话注入*最少但最相关的上下文*。移除无关消息。按步骤采集指标数据。任务完成后提出流程优化建议。

## 技术栈

- **TypeScript** — 实现语言
- **AxioDB** — 结构化记忆数据库（任务状态、讨论项、流程指标）。仓库：https://github.com/nexoral/AxioDB
- **TUI 集成** — 在终端显示当前任务、步骤和耗时

## 固定目录约定

```
/docs/flow/         — 流程定义（每个场景/流程一个 .md）
/docs/regulation/   — 宪法、编码风格、检查清单、字典
/docs/spec/         — 程序规格说明
/docs/plan/         — 任务计划：/docs/plan/[plan]_*.md
/docs/template/     — /pm-install-flow 使用的流程模板
```

## 核心概念

### 记忆体系（双层）

| 类型 | 内容 | 特点 |
|------|------|------|
| **MD 文档记忆** | Flow、Regulation、Spec、Template | 稳定，沉淀记忆，一般不轻易修改 |
| **结构化记忆** | 任务状态、Discussion、FlowMetrics | 频繁读写 — 存储在 AxioDB 中 |

### 行为准则（Regulation）类型
- **Constitution（宪法）** — 始终加载的最高原则
- **CodingStyle（编码风格）** — 代码规范
- **Checklist（检查清单）** — 自查列表
- **Dictionary（字典）** — 项目术语

### 任务模型（FSM 驱动）

每个任务包含三个要素：**Spec（做什么）→ Task Plan（怎么做）→ Task State（做到哪了）**。
插件管理步骤流转，由 LLM 判断何时推进到下一步。

### 每次对话的上下文注入

每次对话轮次：
1. 从结构化记忆中读取当前流程和步骤
2. 提取相关内容：Flow 文档、任务状态、宪法、当前步骤指定的 Regulation、Spec 文档、任务计划
3. 移除与当前步骤无关的消息

### 流程数据采集（按任务、按步骤）

- 每个步骤进入次数
- 每个步骤 Token 消耗量
- 每个步骤停留时间
- 每个步骤人工介入时间
- 每个步骤用户输入字数/Token 数

任务结束后：分析执行情况 → 生成 Discussion 改进建议 → 用户空闲时审阅 → 落地修改。

## 命令

| 命令 | 用途 | 必填参数 |
|---------|---------|----------------|
| `/pm-init` | 引导式初始化向导（使用 `question` 工具） | — |
| `/pm-install-flow` | 从模板库安装流程 | flow 名称 |
| `/pm-uninstall-flow` | 移除一个流程 | flow 名称 |
| `/pm-refine-flow` | 迭代优化流程定义 | flow 名称 |
| `/pm-task-start` | 在某个流程下开始新任务 | — |
| `/pm-task-set-step` | 手动跳转到指定步骤 | — |
| `/pm-task-refresh` | 为当前步骤重新注入上下文 | — |
| `/pm-task-close` | 关闭任务，触发分析 | — |

## 设计原则

- **精准优先于数量**：只注入当前步骤所需的内容，而非全量加载
- **LLM 判断流转**：由模型决定 FSM 状态转换，而非硬编码规则
- **关键节点人机协作**：用户审查任务计划，验收交付物
- **多语言支持**：字典优先的本地化方案，按用户配置的语言输出
- **碎片时间友好**：非紧急讨论项暂存，用户可在主流程之外异步审阅

## 目标用户

对 vibe-coding 过程有结构化管理需求的细节型开发者与团队——认为"全量加载所有规则"浪费上下文、自动裁剪不透明不值得信任的人群。

## 参考

- https://github.com/awesome-skills/code-review-skill — Skill 设计参考
- https://github.com/Opencode-DCP/opencode-dynamic-context-pruning — 上下文裁剪参考
