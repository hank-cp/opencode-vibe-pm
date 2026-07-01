# 术语字典

本项目使用以下术语。代码中的标识符使用英文，文档和沟通中可混用。

---

## 核心概念

| 英文                    | 中文                  | 说明                                                |
|-----------------------|---------------------|---------------------------------------------------|
| Flow                  | 流程                  | 一个完整的任务执行流程，定义在 `/docs/flow/` 中                   |
| Step                  | 步骤                  | 流程中的一个阶段，如 S1, S2, ...                            |
| Task                  | 任务                  | 在某流程下启动的一次具体执行                                    |
| Regulation            | 规则                  | 项目中的规则文档，包括宪法、编码风格等, 与Coding Agent常用的Rules区别是按需加载 |
| Constitution          | 宪法                  | 始终加载的最高规则，位于 `/docs/regulation/constitution.md`   |
| Checklist             | 检查清单                | 质量门控自查列表                                          |
| Dictionary            | 字典                  | 术语对照表（即本文件）                                       |
| Discussion            | 讨论项                 | 任务完成后自动生成的流程改进建议                                  |
| TokenMetrics          | Token指标             | 按步骤采集的运行数据（次数/Token/耗时等）                          |
| Spec                  | 规格说明                | 定义"做什么"（WHAT）的文档                                  |
| Task Plan / Plan      | 任务计划                | 定义"怎么做"（HOW）的文档                                   |
| Task State            | 任务状态                | 当前"做到哪了"（WHERE）的状态记录                              |
| Delivery Report       | 交付报告                | 任务完成时对任务执行过程的一个总结性报告                              |
| Deliverables          | 交付物                 | 任务完成时需要交付的清单和标准                                   |
| Referenced Regulation | 引用规则                | 流程文档中对规则文档的引用                                     |
| 状态机                   | FSM / State Machine | 用 Mermaid 定义步骤流转逻辑                                |
| 人机协作                  | Human-in-loop       | 需要用户介入的步骤                                         |
| 步骤流转                  | Step Transition     | 从一个步骤推进到下一个步骤                                     |
| 上下文注入                 | Context Injection   | 根据当前步骤向对话注入相关内容                                   |
| 流程控制提示词               | Flow Control Prompt | 用于控制流程执行的提示词                                      |

## 技术栈

| 英文          | 中文  | 说明             |
|-------------|-----|----------------|
| Plugin      | 插件  | OpenCode 插件    |
| Session     | 会话  | 一次 OpenCode 对话 |
| Terminal UI | TUI | 终端界面展示         |

## 翻译控制

- 不要翻译专用词
  - FSM
  - Human-in-loop
  - Command
-  Flow文档的Meta信息字段标题不翻译
  - Flow第3-7行的字段标题部分不翻译
