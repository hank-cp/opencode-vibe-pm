# vibe-pm 总体设计

**创建日期**: 2026-06-11
**状态**: Draft
**最后更新**: 2026-06-17 — 注入精简为单一 `<pm-control-rules>` 标签，任务由 messages.transform 自动创建

---

## 需求背景

vibe-pm 解决 vibe-coding 中上下文管理混乱的问题：

- **全量加载浪费上下文**：AGENTS.md 和 rules/*.md 每次全量注入
- **自动裁剪不可控**：黑盒裁剪误删关键信息

### 核心思路

**LLM 主导流程控制**。插件只注入文件引用标签（路径 + 摘要），LLM 自行读取文件、管理步骤流转、调用工具记录进度。

---

## 系统架构

```mermaid
graph TB
    subgraph OpenCode["OpenCode 宿主"]
        subgraph Plugin["vibe-pm 插件"]
            Core["Plugin Core<br/>入口 / 命令注册 / 钩子编排"]
            Engine["Flow Engine<br/>文件引用注入 / 任务生命周期 / Cmd→Flow 映射"]
            Memory["Memory System<br/>AxioDB 任务状态存储"]
            Template["Template Manager<br/>模板安装 / Command 生成 / Regulation 安装"]
        end

        subgraph External["外部"]
            FS["文件系统<br/>docs/ flow/ regulation/<br/>spec/ plan/ template/"]
        end
    end

    Core --> Engine
    Core --> Memory
    Core --> Template
    Engine --> Memory
    Template -.-> FS
```

### 分层说明

| 层 | 模块 | 职责 |
|----|------|------|
| **入口层** | Plugin Core | 插件生命周期、命令注册、钩子编排 |
| **业务层** | Flow Engine | 文件引用标签注入、任务生命周期管理、Command→Flow 映射 |
| **数据层** | Memory System | AxioDB 任务状态 CRUD |
| **参考层** | Template Manager | 模板安装、Command 文件生成、Regulation 自动安装 |

---

## 核心数据流

### 一次对话的流程

```mermaid
sequenceDiagram
    participant User as 用户
    participant Core as Plugin Core
    participant Engine as Flow Engine
    participant Mem as Memory System
    participant LLM as LLM

    User->>Core: 发送含 /pm-spec-driven-dev 的消息
    Core->>Engine: detectFlowCmd(text) → "spec-driven-dev"
    Core->>Engine: ensureTaskAndInject(sessionId, "spec-driven-dev", parts)
    Engine->>Mem: getActiveTask(sessionId) → null
    Engine->>Mem: createTask(spec-driven-dev, S1)
    Core-->>LLM: 注入 <pm-control-rules> 流程执行规则

    LLM->>LLM: 按 <pm-control-rules> 启动流程
    LLM->>LLM: Read docs/regulation/constitution.md
    LLM->>LLM: Read docs/flow/[flow]spec-driven-dev.md
    LLM->>LLM: 按步骤执行，调 pm_task_set_step 记录进度
```

### 上下文注入内容

每次对话注入 `<pm-control-rules>` 控制提示，其中包含**文件引用**让 LLM 自行读取相关文档（不含全文）：

---

## 目录结构

```
项目根目录/
├── .vibe-pm/                    # 插件运行时数据
├── .vibe-pm.json                # 插件配置
├── .opencode/
│   ├── commands/                # 生成的 Command 文件
│   └── dcp.jsonc                # DCP 保护配置
├── docs/
│   ├── flow/                    # 流程定义
│   │   └── flow-*.md
│   ├── regulation/              # 行为准则
│   │   ├── constitution.md
│   │   ├── coding_style.md
│   │   └── dictionary.md
│   ├── spec/                    # 程序规格说明
│   ├── plan/                    # 任务计划
│   └── template/                # 内置模板
├── src/
│   ├── index.ts
│   ├── core/                    # Plugin Core
│   ├── engine/                  # Flow Engine
│   ├── memory/                  # Memory System
│   └── template/                # Template Manager
```

---

## 技术栈

| 组件 | 用途 |
|------|------|
| TypeScript (ES2022, NodeNext) | 实现语言 |
| `@opencode-ai/plugin` SDK | 钩子/命令/工具注册 |
| AxioDB | 任务状态存储 |
| Zod | 运行时校验 |
