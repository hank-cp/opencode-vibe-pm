# Memory System Spec

**创建日期**: 2026-06-11
**状态**: Implemented
**输入来源**: XMind 设计文档 + S4 访谈（AxioDB 嵌入式、JSON 存储）
**最后更新**: 2026-06-12 — Memory System 实现完成

---

## 需求背景

Memory System 是 vibe-pm 的数据层，负责结构化记忆的持久化存储。使用 AxioDB 作为嵌入式数据库，存储载体为 JSON 文件。管理三类核心数据：Task（任务状态）、Discussion（讨论项）、FlowMetrics（流程指标）。

---

## 设计要点

### 领域模型

```mermaid
erDiagram
    Task {
        string sessionId PK
        string flow "流程名称"
        string currentStep "当前步骤 S1-Sn"
        string currentStepName "当前步骤名称"
        string startAt "任务开始时间"
        boolean closed "是否已关闭"
        string summary "任务摘要"
    }

    Discussion {
        string id PK
        string fromSessionId FK "来源会话"
        string priority "high/medium/low"
        string importance "1-5"
        string severity "1-5"
        string issue "问题描述"
        string reason "根因分析"
        string solution "改进方案"
        string decision "最终决议"
        string taskSummary "关联任务摘要"
    }

    FlowMetrics {
        string id PK
        string sessionId FK "来源会话"
        string flow "流程名称"
        string step "步骤编号"
        string stepName "步骤名称"
        string stepInCount "进入次数"
        string tokensConsumed "Token 消耗"
        string dwellTime "停留时间(ms)"
        string humanInterventionTime "人工介入时间(ms)"
        string userInputTokens "用户输入 Token 数"
        string taskSummary "关联任务摘要"
    }

    Task ||--o{ Discussion : "生成"
    Task ||--o{ FlowMetrics : "采集"
```

### 数据模型详情

#### Task

```typescript
interface Task {
  sessionId: string;          // OpenCode session ID
  flow: string;               // 流程名称，如 "project-build"
  currentStep: string;        // 当前步骤 ID，如 "S3"
  currentStepName: string;    // 当前步骤名称，如 "需求澄清访谈"
  startAt: string;            // ISO 8601 时间戳
  closed: boolean;            // 是否已关闭
  summary: string;            // 任务摘要（任务目标的一句话描述）
  // 扩展字段
  specRef?: string;           // 关联的 Spec 文档路径
  planRef?: string;           // 关联的 Plan 文档路径
}
```

#### Discussion

```typescript
interface Discussion {
  id: string;                 // 自动生成 UUID
  fromSessionId: string;      // 来源 session ID
  priority: "high" | "medium" | "low";
  importance: 1 | 2 | 3 | 4 | 5;
  severity: 1 | 2 | 3 | 4 | 5;
  issue: string;              // 问题描述
  reason: string;             // 根因分析
  solution: string;           // 改进方案
  decision?: string;          // 最终决议（用户审阅后填写）
  taskSummary: string;        // 关联任务的摘要（从 Task.summary 复制）
  createdAt: string;          // ISO 8601
  resolvedAt?: string;        // 决议时间
}
```

#### FlowMetrics

```typescript
interface FlowMetrics {
  id: string;                 // 自动生成 UUID
  sessionId: string;          // 来源 session ID
  flow: string;               // 流程名称
  step: string;               // 步骤编号，如 "S4"
  stepName: string;           // 步骤名称，如 "需求澄清访谈"
  stepInCount: number;        // 进入该步骤的次数
  tokensConsumed: number;     // 该步骤消耗的 Token 数
  dwellTime: number;          // 停留时间（毫秒）
  humanInterventionTime: number; // 人工介入时间（毫秒）
  userInputTokens: number;    // 用户输入 Token 数
  taskSummary: string;        // 关联任务的摘要（从 Task.summary 复制）
}
```

### 关键路径

#### 任务生命周期

```mermaid
stateDiagram-v2
    [*] --> Created: session.created
    Created --> Running: /pm-task-start
    Running --> Running: Step 推进(S1→S2→...)
    Running --> Completed: /pm-task-close
    Completed --> [*]
    
    note right of Running
        每次 Step 变更时:
        - 更新 currentStep
        - 记录 FlowMetrics
    end note
    
    note right of Completed
        关闭时触发:
        - 设置 closed=true
        - 触发 analysis
        - 生成 Discussion
    end note
```

#### 数据文件组织

```
.vibe-pm/
├── data.json              # 主数据文件：所有记录在一个 JSON 文件中
│   ├── tasks: Task[]
│   ├── discussions: Discussion[]
│   └── flowMetrics: FlowMetrics[]
└── .schema                # Schema 版本标记（用于迁移）
```

### 接口设计

```typescript
interface IMemorySystem {
  // --- Task CRUD ---
  createTask(task: Omit<Task, "closed">): Promise<Task>;
  getTask(sessionId: string): Promise<Task | null>;
  getActiveTask(sessionId: string): Promise<Task | null>;   // closed === false
  updateStep(sessionId: string, step: string, stepName: string): Promise<void>;
  closeTask(sessionId: string): Promise<void>;
  listActiveTasks(): Promise<Task[]>;                        // 所有未关闭的任务

  // --- Discussion CRUD ---
  createDiscussion(discussion: Omit<Discussion, "id" | "createdAt">): Promise<Discussion>;
  getDiscussions(sessionId: string): Promise<Discussion[]>;
  getUnresolvedDiscussions(): Promise<Discussion[]>;         // decision 为空的
  resolveDiscussion(id: string, decision: string): Promise<void>;
  listDiscussions(filter?: { priority?: string; unresolved?: boolean }): Promise<Discussion[]>;

  // --- FlowMetrics CRUD ---
  recordStepEntry(
    sessionId: string,
    flow: string,
    step: string,
    stepName: string,
    tokensConsumed: number,
    userInputTokens: number,
  ): Promise<void>;
  recordStepExit(
    sessionId: string,
    step: string,
    dwellTime: number,
    humanInterventionTime: number,
  ): Promise<void>;
  getFlowMetrics(sessionId: string): Promise<FlowMetrics[]>;
  getFlowMetricsByFlow(flow: string): Promise<FlowMetrics[]>; // 按流程聚合

  // --- 初始化 ---
  init(dataDir: string): Promise<void>;  // 确保数据文件和目录存在
}
```

### AxioDB 集成

基于 AxioDB v9.6.6，关键发现：
- **不支持 `$set` 操作符**：`UpdateOne({ field: value })` 直接传纯对象
- **Query 返回格式**：`{ statusCode: 200, data: { documents: [...] } }`
- **单实例限制**：每进程只能创建一个 AxioDB 实例

```typescript
import { AxioDB } from "axiodb";

class MemorySystem implements IMemorySystem {
  private db: AxioDB;

  async init(dataDir: string): Promise<void> {
    this.db = new AxioDB({
      CustomPath: dataDir,
      RootName: "vibe-pm",
    });
    const appDb = await this.db.createDB("vibe-pm");
    this.tasks = await appDb.createCollection("tasks");
    this.discussions = await appDb.createCollection("discussions");
    this.flowMetrics = await appDb.createCollection("flowMetrics");
  }
}
```

---

---

## 测试用例

### task-crud.test.ts

- **测试文件**: `tests/memory/task-crud.test.ts`
- **关联设计文档**: `vibe-pm-memory-system.md`
- **Setup/Teardown**: 创建临时 `.vibe-pm/` 目录，初始化 Memory System，测试后清理

| 动作指令 | 测试方法 | Given | When | Then | Notes |
|----------|----------|-------|------|------|-------|
| 新增 | `create_and_get_task` | 空数据库 | 创建 Task 后查询 | 返回的 Task 字段完整，closed=false，summary 和 currentStepName 有值 | 基本 CRUD 流程 |
| 新增 | `getActiveTask_filters_closed` | 数据库有 1 个 active + 1 个 closed Task | 查询 active task | 仅返回 closed=false 的那条 | closed 过滤 |
| 新增 | `updateStep_updates_both` | active Task 在 S3 | updateStep("S4", "设计方案") | currentStep="S4", currentStepName="设计方案" | 步骤名同步更新 |
| 新增 | `duplicate_task_rejected` | 已有 active Task for session X | 再次 createTask(session X) | 抛出 DuplicateTaskError | 唯一性约束 |

### discussion-crud.test.ts

- **测试文件**: `tests/memory/discussion-crud.test.ts`
- **关联设计文档**: `vibe-pm-memory-system.md`
- **Setup/Teardown**: 创建临时数据库，预置一个 closed Task，测试后清理

| 动作指令 | 测试方法 | Given | When | Then | Notes |
|----------|----------|-------|------|------|-------|
| 新增 | `create_discussion_with_task_summary` | closed Task | createDiscussion() | Discussion.taskSummary 等于 Task.summary | 关联确保 |
| 新增 | `get_unresolved_only` | 1 个 resolved + 2 个 unresolved | getUnresolvedDiscussions() | 返回 2 条，不包含 resolved | decision 为空即 unresolved |
| 新增 | `resolve_discussion` | 1 个 unresolved | resolveDiscussion(id, "采纳") | decision="采纳", resolvedAt 有时间戳 | 决议流程 |

### flowmetrics-crud.test.ts

- **测试文件**: `tests/memory/flowmetrics-crud.test.ts`
- **关联设计文档**: `vibe-pm-memory-system.md`
- **Setup/Teardown**: 创建临时数据库，预置 Task，测试后清理

| 动作指令 | 测试方法 | Given | When | Then | Notes |
|----------|----------|-------|------|------|-------|
| 新增 | `record_step_entry_and_exit` | active Task 在 S1 | recordStepEntry + recordStepExit | FlowMetrics 包含 stepName、taskSummary、stepInCount=1 | 完整指标记录 |
| 新增 | `step_in_count_increments` | S4 已有 1 次记录 | 再次 recordStepEntry("S4") | stepInCount 变为 2 | 重复进入计数 |
| 新增 | `get_metrics_by_flow_aggregates` | 2 个 session 的 FlowMetrics | getFlowMetricsByFlow("project-build") | 返回所有该 flow 的 Metrics | 按流程聚合 |

### data-file.test.ts

- **测试文件**: `tests/memory/data-file.test.ts`
- **关联设计文档**: `vibe-pm-memory-system.md`
- **Setup/Teardown**: 创建临时目录，测试后清理

| 动作指令 | 测试方法 | Given | When | Then | Notes |
|----------|----------|-------|------|------|-------|
| 新增 | `init_creates_json_on_first_run` | 空 `.vibe-pm/` | 调用 `init()` | `data.json` 文件被创建，内容为合法 JSON | 首次运行 |
| 新增 | `corrupted_json_backup_and_reset` | `data.json` 内容为非法 JSON | 调用 `init()` | 原文件备份为 `data.json.bak`，创建新的空 JSON | 容错恢复 |

---

## 边界与错误情况

| 场景 | 预期行为 |
|------|---------|
| `data.json` 文件不存在 | 首次 `init()` 时自动创建空的 JSON 结构 |
| JSON 文件损坏 | 备份损坏文件为 `data.json.bak`，创建新文件 |
| 同一 session 创建重复 Task | `createTask` 检查是否已存在 active task，存在时抛出 `DuplicateTaskError` |
| 并发写入（同一 session 多个 Step） | AxioDB 应提供原子写入（待确认）；若不支持，用内存锁串行化 |
| FlowMetrics 数据量过大 | 每个 session 结束后归档汇总数据到 FlowMetrics，删除原始步骤级数据（可配置） |
| 查询不存在的 Task | 返回 `null`，不抛异常 |

---

## 约束与限制

### 技术约束

- 依赖 AxioDB，其 API 可能变化
- JSON 文件作为存储载体，大数据量下性能可能下降——初期项目规模下影响可忽略
- 若 AxioDB 不支持索引/查询，可能需要内存缓存 + 全量 JSON 读写

### 业务约束

- 不存储用户对话内容（仅存储 Task 元数据和 Metrics）
- Discussion 的 `decision` 字段由用户审阅后手动填写，系统不自动决策

### 已知风险

- AxioDB 的稳定性、并发安全性待验证
- JSON 文件随项目增长可能变大，需设计归档/清理策略
- 若未来需要多项目共享数据，JSON 文件方案不可行——但当前阶段仅单项目使用

### 影响范围

- 无现有代码影响（新模块）
- 被 Flow Engine、Metrics & Analysis、TUI Display 依赖

---

## 开发进度

### 已实现功能

- AxioDB 嵌入式数据库集成（v9.6.6）
- Task CRUD（创建、查询、更新步骤、关闭、列表）
- Discussion CRUD（创建、决议、按条件过滤）
- FlowMetrics CRUD（步骤进入/退出指标记录、聚合查询）
- 容错处理（数据文件自动创建、重复任务检查）
- 4 个测试文件，14 个测试用例全部通过

### 未实现功能

- 大数据量归档/清理策略
- 数据迁移/Migration 机制
- AxioDBCloud 远程数据库支持

### 技术笔记

- AxioDB `UpdateOne()` 不支持 `$set` 操作符，需传纯对象
- AxioDB 查询返回 `data.documents` 嵌套包装
- AxioDB 单进程实例限制，测试需共享 MemorySystem（beforeAll/afterAll）
