# StepTokenMetrics 无用字段清理

**创建日期**: 2026-06-26
**状态**: Final
**输入来源**: 用户需求 — "StepTokenMetrics去掉没用的字段dwellTime, humanInterventionTime, userInputTokens"

---

## 需求背景

`StepTokenMetrics` 接口定义了步骤级 Token 指标的数据结构。经用户确认，以下三个字段需要完整删除：

| 字段 | 删除原因 |
|------|----------|
| `dwellTime` | 步骤驻留时间，虽在代码中活跃使用，但用户决定不再需要此指标 |
| `humanInterventionTime` | 人工介入时间，调用方始终传 `0`，无任何消费者读取，实质死代码 |
| `userInputTokens` | 已标记 `@deprecated`，可通过 `tokensBySource.User` 推导，冗余数据 |

删除范围包含 **TypeScript 类型定义、SQLite schema、prepared statements、业务逻辑、测试断言、Spec 文档**。

---

## 设计要点

### 领域模型

**变更前** — `StepTokenMetrics` 接口 (src/memory/types.ts:78-93):

```typescript
export interface StepTokenMetrics {
  id: string;
  sessionId: string;
  flow: string;
  step: string;
  stepName: string;
  stepInCount: number;
  tokensConsumed: number;
  tokensBySource: Record<string, number>;
  dwellTime: number;            // ← 删除
  humanInterventionTime: number; // ← 删除
  userInputTokens: number;       // ← 删除 (@deprecated)
  taskSummary: string;
}
```

**变更后**:

```typescript
export interface StepTokenMetrics {
  id: string;
  sessionId: string;
  flow: string;
  step: string;
  stepName: string;
  stepInCount: number;
  tokensConsumed: number;
  tokensBySource: Record<string, number>;
  taskSummary: string;
}
```

### 关键路径

逐文件变更清单（共 6 个源码文件 + 2 个 Spec 文档）：

#### 1. `src/memory/types.ts`

| 位置 | 变更 |
|------|------|
| L88-91 | 从 `StepTokenMetrics` 接口删除 3 个字段 |
| L193-194 | 从 `IMemorySystem.recordStepExit()` 签名删除 `dwellTime`、`humanInterventionTime` 参数 |

#### 2. `src/memory/memory-system.ts`

**DDL (L155-157)**：从 `CREATE TABLE step_token_metrics` 删除 3 列

```sql
-- 删除
dwell_time            INTEGER NOT NULL DEFAULT 0,
human_intervention_time INTEGER NOT NULL DEFAULT 0,
user_input_tokens     INTEGER NOT NULL DEFAULT 0,
```

**Prepared Statements**：

| 语句 | 行号 | 变更 |
|------|------|------|
| `stmtUpdateMetrics` | L242 | 删除 `user_input_tokens = ?, dwell_time = ?, human_intervention_time = ?` |
| `stmtInsertMetrics` | L246-247 | 删除 3 列名和 `$dwellTime, $humanInterventionTime, $userInputTokens` |
| `stmtUpsertMetrics` | L250-251 | 同上 |

**方法变更**：

| 方法 | 行号 | 变更 |
|------|------|------|
| `recordStepTokens` (更新分支) | L444-446 | 从 `prefixKeys({...})` 删除 `dwellTime`、`humanInterventionTime`、`userInputTokens` |
| `recordStepTokens` (插入分支) | L459-461 | 同上 |
| `incrementStepCount` (更新分支) | L477-484 | 从 `stmtUpdateMetrics.run(...)` 删除 `existing["user_input_tokens"]`、`existing["dwell_time"]`、`existing["human_intervention_time"]` 参数 |
| `incrementStepCount` (插入分支) | L497-499 | 从 `prefixKeys({...})` 删除 `dwellTime`、`humanInterventionTime`、`userInputTokens` |
| `recordStepExit` | L505-525 | 删除 `dwellTime`/`humanInterventionTime` 参数，删除累加逻辑，删除 `user_input_tokens` 透传，简化日志 |
| `rowToStepTokenMetrics` | L689-691 | 删除 3 个字段映射 |

**`recordStepExit` 完整重构**：

```typescript
// 变更前
async recordStepExit(
  sessionId: string, step: string,
  dwellTime: number, humanInterventionTime: number,
): Promise<void> {
  const existing = this.stmtGetMetricsBySessionStep.get(sessionId, step) as Record<string, unknown> | undefined;
  if (existing) {
    this.stmtUpdateMetrics.run(
      existing["tokens_consumed"], existing["tokens_by_source"],
      existing["user_input_tokens"], existing["step_in_count"],
      (existing["dwell_time"] as number) + dwellTime,
      (existing["human_intervention_time"] as number) + humanInterventionTime,
      existing["id"],
    );
    logger.info(`recordStepExit: step=${step} dwellTime=${dwellTime}ms ...`);
  }
}

// 变更后 — 仅更新 step_in_count（此方法语义变为"标记步骤离开"，不再记录时间指标）
async recordStepExit(sessionId: string, step: string): Promise<void> {
  const existing = this.stmtGetMetricsBySessionStep.get(sessionId, step) as Record<string, unknown> | undefined;
  if (existing) {
    this.stmtUpdateMetrics.run(
      existing["tokens_consumed"], existing["tokens_by_source"],
      existing["step_in_count"],
      existing["id"],
    );
  }
}
```

#### 3. `src/engine/flow-engine.ts`

| 行号 | 变更 |
|------|------|
| L241 | `recordStepExit(sessionId, oldStep, stepDwellTime, 0)` → `recordStepExit(sessionId, oldStep)` |
| L254 | 日志移除 `dwellTime=${stepDwellTime}ms` |
| L270 | `recordStepExit(sessionId, task.currentStep, stepDwellTime, 0)` → `recordStepExit(sessionId, task.currentStep)` |

**注意**：`stepDwellTime` 变量仍然被计算（L236-238），但不再传递给 `recordStepExit`，仅用于日志输出前可安全删除。日志行 L254 中只有 `dwellTime` 部分移除。

#### 4. `tests/engine/task-start.test.ts`

| 行号/区域 | 变更 |
|-----------|------|
| L115 | 删除注释 `// ─── setStep dwellTime ───────` |
| L134 | 删除测试用例 `"setStep_records_dwellTime_from_transitions"` |
| L149 | 删除断言 `expect(s2Metric!.dwellTime).toBeGreaterThan(0)` |
| L152 | 删除测试用例 `"closeTask_records_final_dwellTime"` |
| L159 | 删除断言 `expect(s3Metric!.dwellTime).toBeGreaterThanOrEqual(0)` |

#### 5. `tests/memory/task-crud.test.ts`

| 行号 | 变更 |
|------|------|
| L101 | 删除 `expect(metrics[0].userInputTokens).toBe(100)` |

#### 6. `tests/memory/task-query.test.ts`

| 行号 | 变更 |
|------|------|
| L114 | 删除 `expect(metrics[0].userInputTokens).toBe(300)` |

#### 7. `docs/spec/vibe-pm-metrics-collection.md`

删除/更新 `dwellTime`、`humanInterventionTime`、`userInputTokens` 相关行（L158-159, L161, L226, L431, L433-434）。

#### 8. `docs/spec/vibe-pm-memory-system.md`

删除/更新对应字段引用（L53-55, L104-126, L179-185）。

### SQLite 迁移策略

由于 SQLite 3.35.0+ (2021-03-12) 支持 `ALTER TABLE DROP COLUMN`，且 Bun 绑定的 SQLite 版本满足此要求，直接在 `CREATE TABLE IF NOT EXISTS` 中删除列声明即可。已有数据库文件（`.vibe-pm/vibe-pm.db`）中的旧列会保留但不再被读写，不影响运行。

> **风险**：`stmtUpdateMetrics` 的 `?` 参数数量从 6 个减少到 3 个，`stmtInsertMetrics`/`stmtUpsertMetrics` 的列数也减少。所有调用这些 prepared statement 的方法必须同步调整参数数量，否则运行时会抛出 `SQLITE_RANGE: column index out of range`。

### 接口设计

**`IMemorySystem.recordStepExit` 签名变更**：

```typescript
// 变更前
recordStepExit(
  sessionId: string,
  step: string,
  dwellTime: number,
  humanInterventionTime: number,
): Promise<void>;

// 变更后
recordStepExit(
  sessionId: string,
  step: string,
): Promise<void>;
```

---

## 边界与错误情况

| 场景 | 预期行为 |
|------|---------|
| Prepared statement 参数数量与 SQL `?` 不匹配 | 运行时 `SQLITE_RANGE` 错误 — 必须逐方法验证参数数量 |
| 旧 DB 文件中残留已删除列 | 不影响运行 — 新代码不读写这些列，SQLite 容忍多余列 |
| 测试断言引用已删除字段 | TypeScript 编译失败 — 需连同测试一起更新 |
| `tokensBySource.User` 替代 `userInputTokens` 的逻辑完整性 | `userInputTokens` 始终等于 `tokensBySource.User ?? 0`（在 `recordStepTokens` 中），删除后消费方应直接读取 `tokensBySource.User` |

---

## 约束与限制

### 技术约束

- SQLite DDL 变更通过修改 `CREATE TABLE IF NOT EXISTS` 语句实现，不编写单独的 migration 脚本
- 已存在的 `.vibe-pm/vibe-pm.db` 文件不会自动迁移旧列 — 手动删除数据库文件或接受列残留

### 业务约束

- 删除后 `StepTokenMetrics` 不再包含步骤时间相关指标，后续如需恢复需重新设计

### 已知风险

- Prepared statement 参数数量不匹配是最高风险点，需在实现后运行 `bun test` 验证所有 SQL 调用
- `incrementStepCount` 中 `stmtUpdateMetrics.run()` 的参数顺序必须与 `SET` 子句严格对应

### 影响范围

| 模块 | 影响程度 | 说明 |
|------|----------|------|
| `src/memory/types.ts` | 中 | 接口定义变更 |
| `src/memory/memory-system.ts` | 高 | DDL + 3 个 prepared statement + 3 个方法 + 1 个映射函数 |
| `src/engine/flow-engine.ts` | 低 | 2 处调用参数简化 + 1 处日志简化 |
| `tests/engine/task-start.test.ts` | 中 | 删除 2 个测试用例 |
| `tests/memory/task-crud.test.ts` | 低 | 删除 1 个断言 |
| `tests/memory/task-query.test.ts` | 低 | 删除 1 个断言 |

---

## 测试用例

### task-start.test.ts

- **测试文件**: `tests/engine/task-start.test.ts`
- **关联设计文档**: 本文档
- **动作**: 删除 `setStep_records_dwellTime_from_transitions` 和 `closeTask_records_final_dwellTime` 两个测试用例

### task-crud.test.ts

- **测试文件**: `tests/memory/task-crud.test.ts`
- **关联设计文档**: 本文档
- **动作**: 删除第 101 行 `expect(metrics[0].userInputTokens).toBe(100)`

### task-query.test.ts

- **测试文件**: `tests/memory/task-query.test.ts`
- **关联设计文档**: 本文档
- **动作**: 删除第 114 行 `expect(metrics[0].userInputTokens).toBe(300)`

---

## 实施规划

> 本部分在开发过程中持续更新。以里程碑为粒度拆解，每个里程碑关联功能点和风险。

### [x] 里程碑 1 — 字段清理

- [x] `src/memory/types.ts` — 删除 StepTokenMetrics 中 3 个字段 + recordStepExit 参数
- [x] `src/memory/memory-system.ts` — DDL + prepared statements + 方法体清理
  - 已知问题/风险: Prepared statement 参数对齐 — 已通过 `bun test` 验证，无运行时报错
- [x] `src/engine/flow-engine.ts` — recordStepExit 调用简化 + 日志清理
- [x] `tests/engine/task-start.test.ts` — 删除 dwellTime 相关测试
- [x] `tests/memory/task-crud.test.ts` — 删除 userInputTokens 断言
- [x] `tests/memory/task-query.test.ts` — 删除 userInputTokens 断言
- [x] `docs/spec/` 更新引用（metrics-collection + memory-system）
- [x] `bun test` 全量通过（137 pass）+ `bun run typecheck` 类型检查通过
