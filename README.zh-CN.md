# vibe-pm

![NPM Version](https://img.shields.io/npm/v/@laxture/vibe-pm)
![GitHub](https://img.shields.io/github/license/hank-cp/opencode-vibe-pm)
![GitHub last commit](https://img.shields.io/github/last-commit/hank-cp/opencode-vibe-pm.svg)

> **OpenCode 的结构化开发工作流插件。**
>
> vibe-pm是一个OpenCode插件, 它能让 vibe-coding 不跑偏。

## 为什么需要 vibe-pm？

当前痛点：

- `AGENTS.md` 和 `rules/*.md` 强制全量加载，**浪费上下文窗口**
- 现有的自动裁剪工具**过程不透明** — 你不知道什么被丢弃了、为什么
- 遗忘越来越严重 — 重要上下文悄无声息地消失

vibe-pm 的解法：**只注入当前步骤所需的内容** — 不多不少。每个任务由三个要素驱动：

| 要素 | 回答 |
|------|------|
| **Spec** | 要做什么 |
| **Task Plan** | 怎么做 |
| **Task State** | 做到哪了 |

关键节点需要人工确认，杜绝无声漂移。

## 设计哲学

- **让 Coding Agent 做一个循规蹈矩的员工。** 不懂就问，而非天马行空的熊孩子。
- **握住缰绳的是你。** Vibe-coding 时代，你是 AI 的 Boss 和教练，技术决策不放手。

## 功能

1. 将任务流程控制引入LLM上下文，通过插件保证 vibe-coding 过程**稳定受控**
2. 团队可按需**定制任务流程**，并持续调整优化
3. **Spec+任务驱动**：每次对话以 Spec → Plan → State 锚定
4. 关键步骤强制人工审核, 确保Coding Agent每一步都不会偏离预期
5. 支持使用**本地语言**进行vibe-coding, 通过一个统一的字典文档消除命名歧义
6. 实时统计Token用量并在TUI侧边栏显示

本项目完全使用vibe-pm插件和中文语言开发.

## 适合哪些人

- **细节控和控制狂** — 希望准确把控每个技术细节和决策, 而不是任由LLM自由发挥
- **经验丰富的软件工程师和架构师** — 你可能需要经历过传统项目开发管理，有相当程度的项目管理理解, 才能更好地将你的项目管理理念投射到Coding Agent身上 (将其视为你忠诚而愚笨的员工)，

如果你曾被过"AI 是不是跳过了某一步"或"这个决策是怎么来的"这类问题困扰过 — vibe-pm 就是为你准备的。

## 安装

```bash
# 全局安装
opencode plugin @laxture/vibe-pm@latest --global
```

## 快速开始
```
# 初始化配置
/pm-config init

# 安装流程模板
/pm-install-flow bug-fix

# 启动流程
/pm-bug-fix "重置密码后登录报 500 错误"
```

## 典型用例

```
# 梳理需求、调研分析
/pm-research 分析从 REST 迁移到 GraphQL 的方案

# 撰写 Spec
/pm-design-spec 需要支持用户通过银行卡支付

# 新功能开发（全流程 Spec 驱动）
/pm-spec-driven-dev 根据 @docs/spec/spec-new-feature.md 执行开发

# 修改功能
/pm-spec-driven-dev 用户支付前, 检查可用库存量, 如果不足完成订单, 则阻止支付

# Bug 修复（含根因分析）
/pm-bug-fix 重置密码后登录报 500 错误

# 大规模重构（含影响评估）
/pm-large-refactor "将支付模块拆分为独立微服务"

# 流程优化
/pm-refine-flow 修改bug-fix流程, 如果我没有提供Bug编号, 要求我必须提供
```

## 内置流程模板

| 模板                | 命令                    | 适用场景                                |
|-------------------|-----------------------|-------------------------------------|
| `design-spec`     | `/pm-design-spec`     | 渐进式 Spec 设计                         |
| `spec-driven-dev` | `/pm-spec-driven-dev` | 新功能开发 与 功能变更(同步更新Spec)              |
| `bug-fix`         | `/pm-bug-fix`         | 与期望不符的 Bug 修复, 含根因分析和修复方案评审         |
| `large-refactor`  | `/pm-large-refactor`  | 大规模重构                               |
| `side-job`        | `/pm-side-job`        | 快速任务(执行前需确认方案)                      |
| `research`        | `/pm-research`        | 通用调研任务, 可将分析报告输出到临时位置, 再根据分析报告进行下一步 |

## 命令

| 命令 | 用途 |
|------|------|
| `/pm-config` | 查看/修改插件配置，`init` 启动初始化向导，`coding-style` 安装/更新编码风格文件 |
| `/pm-install-flow` | 从模板库安装流程 |
| `/pm-uninstall-flow` | 移除流程 |
| `/pm-task-set-step` | 手动跳转到指定步骤 |
| `/pm-task-close` | 关闭任务，触发分析 |
| `/pm-task-current-step` | 查看当前步骤 |
| `/pm-task-refresh` | 为当前步骤重新注入上下文 |

流程专用命令（如 `/pm-research`、`/pm-bug-fix`）会在安装对应流程模板后自动生成。

## 最佳搭档

vibe-pm 与以下优秀插件配合，获得更完整的 vibe-coding 体验：

- **[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)** 或 **[oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)** — 实现多 Agent 协作
- **[DCP](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)** — 智能上下文裁剪


## License

Apache 2.0
