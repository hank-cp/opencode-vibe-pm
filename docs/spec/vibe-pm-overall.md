# vibe-pm 总体设计

**创建日期**: 2026-06-11
**状态**: Draft
**输入来源**: XMind 设计文档 + S4 访谈 + OpenCode 插件 API 调研

---

## 需求背景

### 要解决的问题

当前 vibe-coding 存在两个核心痛点：

**1. AGENTS.md 和 rules/*.md 的强制性全量加载**

每次对话都会将 AGENTS.md 和 rules 目录下所有规则文件全部注入上下文。这导致：

- **浪费上下文窗口**：大量与当前任务状态无关的规则占据宝贵的上下文空间，挤压了真正有用的对话信息
- **依赖人工强化关键词**：为了让特定场景按预期运行，用户必须在 prompt 中反复强调关键词来"唤醒"相关规则。如果不做这种手动强化，规则可能被 LLM 忽略

**2. 自动裁剪/优化上下文工具的缺陷**

现有的上下文裁剪方案（如自动压缩、动态剪枝）存在根本性问题：

- **过程不透明**：用户无法知道哪些内容被裁剪了、为什么被裁剪——这是一个黑盒
- **重要与否全靠赌**：什么内容重要、什么不重要，完全由裁剪算法猜测，无法体现用户意图
- **遗忘情况更严重**：自动裁剪往往误删关键上下文，导致 LLM 在长对话中遗忘关键决策和约束

### 愿景

vibe-pm 的核心思路是：**将流程控制相关内容以更精确、更可控的方式嵌入上下文和 Agent 交互中，保证 vibe-coding 过程稳定可控**。

具体目标：

- **任务驱动**：以任务为组织单元，每次对话根据任务当前状态（哪个流程、哪个步骤）精准注入上下文。任务三要素：Spec（做什么）→ Plan（怎么做）→ State（做到哪了）
- **持续优化流程**：根据用户需要和流程运行情况，持续调整和优化开发流程。在任务执行中采集指标数据，任务结束后分析并提出改进建议
- **碎片时间友好**：不紧急的待讨论项暂存起来，用户可在主流程之外的碎片时间异步审阅和决策
- **多语言本地化**：字典优先的本地化方案，按用户配置的语言输出

### 如何做到

- **可定制的开发流程**：用户/团队根据自身偏好和实际情况定义 vibe-coding 开发流程（Flow），不强制使用固定模板
- **流程数据采集与分析**：在 vibe-coding 过程中采集开发数据（每步骤的进入次数、Token 消耗、停留时间、人工介入时间等），任务结束后自动分析并提出流程优化建议
- **双层记忆体系**：MD 文档记忆（沉淀的稳定知识，一般不修改） + 结构化记忆（频繁读写的事务性数据，存储在 AxioDB 中）
- **碎片时间利用**：非紧急 Discussion 项暂存，用户空闲时异步审阅并落地修改

### 目标用户

对 vibe-coding 过程有**结构化管理需求**的细节型开发者与团队——认为"全量加载所有规则"浪费上下文、自动裁剪不透明不值得信任的人群。

---

## 系统架构

```mermaid
graph TB
    subgraph OpenCode["OpenCode 宿主"]
        subgraph Plugin["vibe-pm 插件"]
            Core["Plugin Core<br/>入口 / 命令注册 / 配置 / 生命周期"]
            Engine["Flow Engine<br/>流程解析 / FSM / 上下文注入"]
            Memory["Memory System<br/>AxioDB JSON 文件存储"]
            Metrics["Metrics & Analysis<br/>指标采集 / 分析 / 建议"]
            TUI["TUI Display<br/>终端状态展示"]
            Template["Template Manager<br/>模板文件组织指南"]
        end

        subgraph External["外部"]
            FS["文件系统<br/>docs/ flow/ regulation/<br/>spec/ plan/ template/"]
            API["OpenCode Plugin API<br/>tool / chat.message /<br/>messages.transform /<br/>system.transform / event / config"]
        end
    end

    Core --> Engine
    Core --> Memory
    Core --> Template
    Engine --> Memory
    Memory --> Metrics
    Memory --> TUI
    Core -.-> API
    Engine -.-> API
    Engine -.-> FS
    Template -.-> FS
```

### 分层说明

| 层 | 模块 | 职责 |
|----|------|------|
| **入口层** | Plugin Core | 插件生命周期、命令注册、配置加载、钩子编排 |
| **业务层** | Flow Engine | Flow 解析、FSM 状态机、上下文注入、步骤管理 |
| **数据层** | Memory System | AxioDB（JSON 文件）读写、数据模型、结构化记忆 CRUD |
| **分析层** | Metrics & Analysis | 流程指标采集、任务后分析、Discussion 改进建议生成 |
| **展示层** | TUI Display | 终端状态展示（任务进度、步骤、耗时） |
| **参考层** | Template Manager | 内置模板文件组织规范、模板选择指南 |

---

## 核心数据流

### 一次对话的完整流程

```mermaid
sequenceDiagram
    participant User as 用户
    participant Core as Plugin Core
    participant Engine as Flow Engine
    participant Memory as Memory System
    participant LLM as LLM

    User->>Core: 发送消息
    Core->>Memory: 读取当前 session 任务状态
    Memory-->>Core: Task { flow, currentStep }
    
    alt 无活跃任务
        Core-->>LLM: 透传，不做干预
    else 有活跃任务
        Core->>Engine: 触发 system.transform
        Engine->>Memory: 读取 Step 指定的 Regulation
        Engine-->>Core: 注入 Constitution + Step 指令 + Regulation
        
        Core->>Engine: 触发 messages.transform
        Engine->>Engine: 识别与当前 Step 无关的消息
        Engine-->>Core: 替换为占位符
        
        Core-->>LLM: 发送精准上下文
        LLM-->>User: 根据 Step 指令执行任务
        
        Note over LLM,Memory: LLM 判断 FSM 流转
        LLM->>Memory: 更新 currentStep（如推进）
    end

    Note over Memory: 会话 idle 时触发
    Memory->>Memory: 生成 Discussion + 更新 FlowMetrics
```

### 上下文注入内容

每次对话注入以下内容（按优先级排序）：

1. **Constitution** — 始终加载的最高原则
2. **当前 Step 执行指令** — 来自 Flow 文档
3. **Step 指定的 Regulation** — 如 CodingStyle、Checklist
4. **Spec 文档引用** — 与当前任务关联的功能规格说明
5. **任务计划引用** — 当前任务的执行计划

---

## 模块关系

```mermaid
graph LR
    Core["Plugin Core"] --> Engine["Flow Engine"]
    Core --> Memory["Memory System"]
    Core --> Template["Template Manager"]
    Engine --> Memory
    Memory --> Metrics["Metrics & Analysis"]
    Memory --> TUI["TUI Display"]
    Template --> Core
```

**数据方向**：
- **写路径**: Flow Engine → Memory System（Task 状态、FlowMetrics）
- **写路径**: Metrics & Analysis → Memory System（Discussion）
- **读路径**: Plugin Core / TUI / Metrics ← Memory System
- **文件读**: Flow Engine 读取 `docs/flow/`、`docs/regulation/`、`docs/spec/`
- **文件读**: Template Manager 读取 `docs/template/`

---

## 技术栈分层

```mermaid
graph TB
    subgraph API["OpenCode Plugin API"]
        direction LR
        A1["@opencode-ai/plugin"]
    end
    
    subgraph Business["业务逻辑层 TypeScript"]
        direction LR
        B1["Plugin Core"]
        B2["Flow Engine"]
    end
    
    subgraph Data["数据访问层"]
        direction LR
        C1["Memory System<br/>AxioDB (JSON)"]
        C2["File System<br/>Node.js fs"]
    end
    
    subgraph Display["分析与展示"]
        direction LR
        D1["Metrics & Analysis"]
        D2["TUI Display"]
    end

    API --> Business
    Business --> Data
    Data --> Display
```

### 关键依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@opencode-ai/plugin` | latest | 插件入口、hooks、tool 注册 |
| `axiodb` | latest | 嵌入式结构化记忆数据库（JSON 文件存储） |
| TypeScript | 5.x | 类型安全 |

---

## 配置设计

### `.vibe-pm.json`

```jsonc
{
  "language": "zh-CN",       // 输出语言：zh-CN | en-US
  "dataDir": ".vibe-pm",     // AxioDB 数据文件目录（相对于项目根目录）
  "autoAnalyze": true,       // 任务结束后是否自动分析
  "contextInjection": {
    "maxStepTokens": 4000,   // 每个 Step 注入的上下文最大 Token 数
    "pruneIrrelevant": true  // 是否裁剪无关消息
  }
}
```

---

## 目录结构

```
项目根目录/
├── .vibe-pm/                    # 插件运行时数据
│   └── data.json                # AxioDB 数据库文件（JSON 格式）
├── .vibe-pm.json                # 插件配置
├── docs/
│   ├── flow/                    # 流程定义
│   │   └── [flow]_*.md
│   ├── regulation/              # 行为准则
│   │   ├── constitution.md
│   │   ├── coding_style.md
│   │   ├── checklist.md
│   │   └── dictionary.md
│   ├── spec/                    # 程序规格说明
│   ├── plan/                    # 任务计划
│   │   └── [plan]_*.md
│   └── template/                # 内置流程模板文件
├── rules/                       # OpenCode 会话规则（每次加载）
│   └── [rules]*.md
├── src/                         # 插件源代码
│   ├── index.ts                 # 插件入口
│   ├── core/                    # Plugin Core
│   ├── engine/                  # Flow Engine
│   ├── memory/                  # Memory System
│   ├── metrics/                 # Metrics & Analysis
│   ├── tui/                     # TUI Display
│   └── template/                # Template Manager
├── package.json
└── tsconfig.json
```

---

## 安全与权限

| 操作 | 权限策略 |
|------|---------|
| 读取 docs/ 文件 | `allow`（只读文件系统） |
| 写 AxioDB 数据 | `allow`（插件内部操作） |
| 修改消息内容 | `allow`（插件 hook 内） |
| 修改系统提示 | `allow`（插件 hook 内） |
| 删除文件 | `deny`（永不执行） |
| 网络请求 | `deny`（当前阶段不联网） |
