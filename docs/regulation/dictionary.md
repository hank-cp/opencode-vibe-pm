# 术语字典

本项目使用以下术语。代码中的标识符使用英文，文档和沟通中可混用。

---

## 核心概念

| 中文 | 英文 | 说明 |
|------|------|------|
| 流程 | Flow | 一个完整的任务执行流程，定义在 `/docs/flow/` 中 |
| 步骤 | Step | 流程中的一个阶段，如 S1, S2, ... |
| 任务 | Task | 在某流程下启动的一次具体执行 |
| 行为准则 | Regulation | 项目中的规则文档，包括宪法、编码风格等 |
| 宪法 | Constitution | 始终加载的最高原则，位于 `constitution.md` |
| 检查清单 | Checklist | 质量门控自查列表 |
| 字典 | Dictionary | 术语对照表（即本文件） |
| 代理 | Agent | OpenCode 中的执行单元（Assistant / Task / explore 等） |

## 任务模型

| 中文 | 英文 | 说明 |
|------|------|------|
| 规格说明 | Spec | 定义"做什么"（WHAT）的文档 |
| 任务计划 | Task Plan / Plan | 定义"怎么做"（HOW）的文档 |
| 任务状态 | Task State | 当前"做到哪了"（WHERE）的状态记录 |
| 交付报告 | Delivery Report | 任务完成时的结构化交付文档 |

## 记忆体系

| 中文      | 英文 | 说明 |
|---------|------|------|
| MD 文档记忆 | MD Document Memory | 以 Markdown 文件存储的长期记忆 |
| 结构化记忆   | Structured Memory | 以 AxioDB 存储的事务性/索引型记忆 |
| 讨论项     | Discussion | 任务完成后自动生成的流程改进建议 |
| Token指标 | TokenMetrics | 按步骤采集的运行数据（次数/Token/耗时等） |

## 流程相关

| 中文      | 英文                  | 说明                 |
|---------|---------------------|--------------------|
| 状态机     | FSM / State Machine | 用 Mermaid 定义步骤流转逻辑 |
| 人机协作    | Human-in-loop       | 需要用户介入的步骤          |
| 步骤流转    | Step Transition     | 从一个步骤推进到下一个步骤      |
| 上下文注入   | Context Injection   | 根据当前步骤向对话注入相关内容    |
| 流程控制提示词 | Flow Control Prompt | 用于控制流程执行的提示词       |

## 技术栈

| 中文 | 英文 | 说明 |
|------|------|------|
| 插件 | Plugin | OpenCode 插件 |
| 宿主 | Host | OpenCode 应用本身 |
| 会话 | Session | 一次 OpenCode 对话 |
| TUI | Terminal UI | 终端界面展示 |
