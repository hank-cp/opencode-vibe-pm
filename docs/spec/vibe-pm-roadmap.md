# vibe-pm 交付路线图

**创建日期**: 2026-06-11
**状态**: Draft
**输入来源**: 所有模块 Spec (T001-T007) + Spec 评估报告 + 消息裁剪算法调研

---

## 分阶段交付计划

```mermaid
gantt
    title vibe-pm 交付路线图
    dateFormat  YYYY-MM-DD
    section Phase 1: MVP 核心
        Plugin Core            :p1a, 2026-06-15, 7d
        Memory System          :p1b, 2026-06-15, 5d
        Flow Engine            :p1c, after p1b, 10d
        MVP 集成验证           :p1d, after p1c, 2d
    section Phase 2: 模板
        Template Manager       :p2a, after p1d, 3d
    section Phase 3: 增强
        Metrics & Analysis     :p3a, after p2a, 4d
        TUI Display            :p3b, after p2a, 4d
    section Phase 4: 收尾
        文档完善 & 发布        :p4a, after p3a, 3d
```

---

## Phase 1: MVP 核心（约 4 周）

**目标**：验证核心闭环——启动任务 → 按步注入上下文 → 记录状态。

| 模块 | 交付物 | 关键能力 |
|------|--------|---------|
| Plugin Core | 插件入口、8 个命令、配置加载 | 双路径命令注册（config + tool）、钩子编排、`/pm-task-start` 重复任务检测 |
| Memory System | AxioDB JSON 文件集成、3 个数据模型 CRUD | Task/Discussion/FlowMetrics 的完整 CRUD 接口、数据文件自动创建与容错 |
| Flow Engine | Flow 解析、三明治上下文注入、消息裁剪算法、缓存策略 | Layer 1/2/3 分层注入（含前瞻窗口）、步骤归属 → 深度层级 → Token 约束三步裁剪管道、注入指纹去重、惰性裁剪、⚠️ Human-in-loop 高亮、LLM 自主流转判断 |

### MVP 验证标准

1. 用户执行 `/pm-init` 初始化项目
2. 用户执行 `/pm-install-flow` 安装 research 流程
3. 用户执行 `/pm-task-start` 启动调研任务
4. 每次对话自动注入三明治上下文（Layer 1 全局视野 + Layer 2 当前步骤 + Layer 3 前瞻窗口）
5. Human-in-loop 步骤被 ⚠️ 高亮标记
6. LLM 自主判断步骤流转，`/pm-task-close` 关闭任务
7. Memory System 正确记录 Task 状态和步骤变更
8. 同一步骤内多次对话不重复注入（指纹去重验证）
9. 上下文使用率 > 80% 时触发消息裁剪

---

## Phase 2: 模板（约 1 周）

**目标**：内置模板文件 + 安装/卸载能力，使 Phase 1 的 MVP 立即可用。

| 模块 | 交付物 | 关键能力 |
|------|--------|---------|
| Template Manager | 5 个内置模板 + 安装卸载逻辑 | 模板扫描、安装到 `/docs/flow/`、冲突处理 |

### 内置模板清单

| 模板 | 状态 | 说明 |
|------|------|------|
| research | ✅ 已完成 | 调研任务（`rules/[rules]research.md`） |

| new-feature | 📋 待生成 | 新功能开发（基于 XMind 重任务开发） |
| bug-fix | 📋 待生成 | Bug 修复（基于 XMind Bug修复） |
| large-refactor | 📋 待生成 | 大规模重构 |

### Phase 2 验证标准

1. `/pm-install-flow` 可列出所有内置模板
2. 选择模板后正确复制到 `/docs/flow/`
3. 同名 Flow 冲突时提示确认覆盖
4. `/pm-uninstall-flow` 正确删除指定 Flow
5. 已安装的 Flow 可通过 `/pm-task-start` 直接使用

---

## Phase 3: 增强（约 2 周）

**目标**：指标采集与分析、终端状态展示。此阶段可利用 Phase 2 的模板进行边测试边开发。

| 模块 | 交付物 | 关键能力 |
|------|--------|---------|
| Metrics & Analysis | 指标采集器、流程分析器、步骤 Token 分解 | Step 进入/退出采集、StepTokenBreakdown（注入上下文/用户消息/工具调用/工具结果/LLM 回复/裁剪节省）、粘性缓存防抖、瓶颈识别、Discussion 自动生成 |
| TUI Display | 终端状态面板 | 实时展示任务进展、步骤耗时柱状图、Token 消耗与分布 |

### Phase 3 验证标准

1. 任务关闭后自动生成 Discussion 改进建议
2. TUI 面板正确显示当前任务、步骤、耗时
3. 步骤 Token 分解准确反映各类型 Token 占比
4. 粘性缓存正确防抖，面板不因缓存命中而闪烁
5. 瓶颈步骤被准确识别
6. `getFlowSummary()` 可按流程查看汇总指标

---

## Phase 4: 收尾（约 1 周）

**目标**：文档完善、测试补充、发布准备。

- 更新 AGENTS.md 和 README
- 补充端到端集成测试
- 清理 `TODO`/`FIXME` 标记
- 发布第一个可用版本

---

## 里程碑

| 里程碑 | 预计节点 | 标志 |
|--------|---------|------|
| M1: MVP 就绪 | Phase 1 结束 | 可启动任务、三明治注入上下文、记录状态、裁剪消息 |
| M2: 开箱即用 | Phase 2 结束 | 内置模板可安装使用，核心闭环完整可测 |
| M3: 完整功能 | Phase 3 结束 | 指标采集（含 Token 分解）+ TUI 展示 |
| M4: v1.0 发布 | Phase 4 结束 | 文档完善、测试覆盖、正式发布 |

---

## 模块依赖总结

```mermaid
graph TD
    PC["Plugin Core<br/>Phase 1"]
    MS["Memory System<br/>Phase 1"]
    FE["Flow Engine<br/>Phase 1"]
    TM["Template Manager<br/>Phase 2"]
    MA["Metrics & Analysis<br/>Phase 3"]
    TUI["TUI Display<br/>Phase 3"]

    PC --> FE
    MS --> FE
    PC --> TM
    MS --> MA
    MS --> TUI
    FE --> MA
```

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| OpenCode `experimental.*` API 变更 | 中 | 高 | Plugin Core 用抽象层隔离实验性 API，变更时只改抽象层 |
| AxioDB 不稳定 | 低 | 中 | Memory System 接口层便于切换存储后端 |
| LLM 误判步骤流转 | 中 | 中 | Flow 文档中 `完成后` 描述写清晰，Mermaid 状态图 + Layer 3 前瞻窗口提供可视化参考 |
| Prompt cache 命中率低 | 中 | 中 | 分层注入 + 指纹去重 + 惰性裁剪三重策略，目标 80%+ 命中率 |
| 消息裁剪误删关键上下文 | 低 | 高 | 保护机制（深度 0 不可裁、用户消息最大深度 2、最少保留 3 条）、惰性裁剪默认不触发 |
