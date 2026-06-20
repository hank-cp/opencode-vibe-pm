/**
 * MemorySystem — vibe-pm 数据层
 *
 * 基于 SQLite (better-sqlite3) 管理 Task / Discussion / FlowMetrics 三类结构化记忆。
 */
import Database from "better-sqlite3";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../core/logger.js";
import type {
  Task,
  CreateTaskInput,
  Discussion,
  CreateDiscussionInput,
  FlowMetrics,
  IMemorySystem,
  TokenSource,
  SourceTokenBreakdown,
  StepTokenBreakdown,
  StepTransition,
} from "./types.js";
import { DuplicateTaskError } from "./errors.js";

// ─── 内部辅助 ───

function generateId(): string {
  return crypto.randomUUID();
}

/** 解析 JSON 列，容错返回默认值 */
function parseJSON<T>(raw: unknown, fallback: T): T {
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as T; } catch {
      logger.debug(`[vibe-pm] parseJSON: failed to parse JSON, using fallback`);
    }
  }
  return fallback;
}

// ─── MemorySystem ───

/**
 * vibe-pm 的结构化记忆层。
 *
 * 基于 SQLite (better-sqlite3) 管理三类数据：
 * - tasks：FSM 驱动的任务状态
 * - discussions：非紧急讨论项（碎片时间友好，异步审阅）
 * - flowMetrics：按步骤采集的 Token 消耗、停留时间等指标
 */
export class MemorySystem implements IMemorySystem {
  private db!: Database.Database;

  // Prepared statements (lazily initialized after init())
  private stmtInsertTask!: Database.Statement;
  private stmtGetTaskBySession!: Database.Statement;
  private stmtGetActiveTaskBySession!: Database.Statement;
  private stmtUpdateTaskStep!: Database.Statement;
  private stmtCloseTask!: Database.Statement;
  private stmtListActiveTasks!: Database.Statement;
  private stmtGetTaskById!: Database.Statement;
  private stmtUpdateTaskTransitions!: Database.Statement;

  private stmtInsertDiscussion!: Database.Statement;
  private stmtGetDiscussionsBySession!: Database.Statement;
  private stmtGetAllDiscussions!: Database.Statement;
  private stmtResolveDiscussion!: Database.Statement;

  private stmtGetMetricsBySessionStep!: Database.Statement;
  private stmtUpdateMetrics!: Database.Statement;
  private stmtInsertMetrics!: Database.Statement;
  private stmtGetMetricsBySession!: Database.Statement;
  private stmtGetMetricsByFlow!: Database.Statement;

  private stmtGetClosedTasksBySession!: Database.Statement;

  /**
   * 初始化数据库连接与表结构。
   *
   * 在指定目录下创建 SQLite 数据库文件，并建立三张表。
   * 使用前必须调用一次。
   *
   * @param dataDir 数据库文件存储目录（通常为 `.vibe-pm/`）
   */
  async init(dataDir: string): Promise<void> {
    // 关闭旧连接（支持重新初始化）
    this.db?.close();
    const dbPath = `${dataDir}/vibe-pm.db`;

    // 确保父目录存在（better-sqlite3 不会自动创建）
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    // ─── DDL ───
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        flow TEXT NOT NULL,
        currentStep TEXT NOT NULL,
        currentStepName TEXT NOT NULL,
        startAt TEXT NOT NULL,
        endAt TEXT,
        closed INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL,
        specRef TEXT,
        planRef TEXT,
        stepTransitions JSON
      );

      CREATE TABLE IF NOT EXISTS discussions (
        id TEXT PRIMARY KEY,
        fromSessionId TEXT NOT NULL,
        priority TEXT NOT NULL,
        importance INTEGER NOT NULL,
        severity INTEGER NOT NULL,
        issue TEXT NOT NULL,
        reason TEXT NOT NULL,
        solution TEXT NOT NULL,
        decision TEXT,
        taskSummary TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        resolvedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS flowMetrics (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        flow TEXT NOT NULL,
        step TEXT NOT NULL,
        stepName TEXT NOT NULL,
        stepInCount INTEGER NOT NULL DEFAULT 1,
        tokensConsumed INTEGER NOT NULL DEFAULT 0,
        tokensBySource JSON,
        dwellTime INTEGER NOT NULL DEFAULT 0,
        humanInterventionTime INTEGER NOT NULL DEFAULT 0,
        userInputTokens INTEGER NOT NULL DEFAULT 0,
        taskSummary TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_sessionId ON tasks(sessionId);
      CREATE INDEX IF NOT EXISTS idx_tasks_sessionId_closed ON tasks(sessionId, closed);
      CREATE INDEX IF NOT EXISTS idx_discussions_fromSessionId ON discussions(fromSessionId);
      CREATE INDEX IF NOT EXISTS idx_flowMetrics_sessionId ON flowMetrics(sessionId);
      CREATE INDEX IF NOT EXISTS idx_flowMetrics_sessionId_step ON flowMetrics(sessionId, step);
      CREATE INDEX IF NOT EXISTS idx_flowMetrics_flow ON flowMetrics(flow);
    `);

    // ─── Prepared Statements ───
    this.stmtInsertTask = this.db.prepare(`
      INSERT INTO tasks (id, sessionId, flow, currentStep, currentStepName, startAt, endAt, closed, summary, specRef, planRef, stepTransitions)
      VALUES (@id, @sessionId, @flow, @currentStep, @currentStepName, @startAt, @endAt, @closed, @summary, @specRef, @planRef, @stepTransitions)
    `);
    this.stmtGetTaskBySession = this.db.prepare("SELECT * FROM tasks WHERE sessionId = ? LIMIT 1");
    this.stmtGetActiveTaskBySession = this.db.prepare("SELECT * FROM tasks WHERE sessionId = ? AND closed = 0 LIMIT 1");
    this.stmtUpdateTaskStep = this.db.prepare("UPDATE tasks SET currentStep = ?, currentStepName = ? WHERE id = ?");
    this.stmtCloseTask = this.db.prepare("UPDATE tasks SET closed = 1, endAt = ? WHERE id = ?");
    this.stmtListActiveTasks = this.db.prepare("SELECT * FROM tasks WHERE closed = 0");
    this.stmtGetTaskById = this.db.prepare("SELECT * FROM tasks WHERE id = ? LIMIT 1");
    this.stmtUpdateTaskTransitions = this.db.prepare("UPDATE tasks SET stepTransitions = ? WHERE id = ?");
    this.stmtGetClosedTasksBySession = this.db.prepare("SELECT * FROM tasks WHERE sessionId = ? AND closed = 1");

    this.stmtInsertDiscussion = this.db.prepare(`
      INSERT INTO discussions (id, fromSessionId, priority, importance, severity, issue, reason, solution, decision, taskSummary, createdAt, resolvedAt)
      VALUES (@id, @fromSessionId, @priority, @importance, @severity, @issue, @reason, @solution, @decision, @taskSummary, @createdAt, @resolvedAt)
    `);
    this.stmtGetDiscussionsBySession = this.db.prepare("SELECT * FROM discussions WHERE fromSessionId = ?");
    this.stmtGetAllDiscussions = this.db.prepare("SELECT * FROM discussions");
    this.stmtResolveDiscussion = this.db.prepare("UPDATE discussions SET decision = ?, resolvedAt = ? WHERE id = ?");

    this.stmtGetMetricsBySessionStep = this.db.prepare("SELECT * FROM flowMetrics WHERE sessionId = ? AND step = ? LIMIT 1");
    this.stmtUpdateMetrics = this.db.prepare(`
      UPDATE flowMetrics SET tokensConsumed = ?, tokensBySource = ?, userInputTokens = ?, stepInCount = ?, dwellTime = ?, humanInterventionTime = ?
      WHERE id = ?
    `);
    this.stmtInsertMetrics = this.db.prepare(`
      INSERT INTO flowMetrics (id, sessionId, flow, step, stepName, stepInCount, tokensConsumed, tokensBySource, dwellTime, humanInterventionTime, userInputTokens, taskSummary)
      VALUES (@id, @sessionId, @flow, @step, @stepName, @stepInCount, @tokensConsumed, @tokensBySource, @dwellTime, @humanInterventionTime, @userInputTokens, @taskSummary)
    `);
    this.stmtGetMetricsBySession = this.db.prepare("SELECT * FROM flowMetrics WHERE sessionId = ?");
    this.stmtGetMetricsByFlow = this.db.prepare("SELECT * FROM flowMetrics WHERE flow = ?");
  }

  // ═══════════════════════════════════════════
  // Task CRUD
  // ═══════════════════════════════════════════

  async createTask(input: CreateTaskInput): Promise<Task> {
    const existing = await this.getActiveTask(input.sessionId);
    if (existing) {
      throw new DuplicateTaskError(input.sessionId);
    }

    const task: Task = {
      ...input,
      id: generateId(),
      closed: false,
    };

    this.stmtInsertTask.run({
      ...task,
      endAt: null,
      specRef: task.specRef ?? null,
      planRef: task.planRef ?? null,
      stepTransitions: null,
      closed: 0,
    });

    return task;
  }

  async getTask(sessionId: string): Promise<Task | null> {
    const row = this.stmtGetTaskBySession.get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : null;
  }

  async getActiveTask(sessionId: string): Promise<Task | null> {
    const row = this.stmtGetActiveTaskBySession.get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : null;
  }

  async updateStep(id: string, step: string, stepName: string): Promise<void> {
    this.stmtUpdateTaskStep.run(step, stepName, id);
  }

  async closeTask(id: string): Promise<void> {
    const result = this.stmtCloseTask.run(new Date().toISOString(), id);
    if (result.changes === 0) {
      // Task not found - silently ignore as per original behavior
      return;
    }
  }

  async listActiveTasks(): Promise<Task[]> {
    const rows = this.stmtListActiveTasks.all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  async appendStepTransition(id: string, transition: StepTransition): Promise<void> {
    const row = this.stmtGetTaskById.get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Task not found: ${id}`);

    const existingTransitions = parseJSON<StepTransition[]>(row["stepTransitions"], []);
    const transitions = [...existingTransitions, transition];
    this.stmtUpdateTaskTransitions.run(JSON.stringify(transitions), id);
  }

  // ═══════════════════════════════════════════
  // Discussion CRUD
  // ═══════════════════════════════════════════

  async createDiscussion(input: CreateDiscussionInput): Promise<Discussion> {
    let taskSummary = input.taskSummary ?? "";
    if (!taskSummary) {
      const task = await this.getTask(input.fromSessionId);
      if (task) taskSummary = task.summary;
    }

    const discussion: Discussion = {
      id: generateId(),
      fromSessionId: input.fromSessionId,
      priority: input.priority,
      importance: input.importance,
      severity: input.severity,
      issue: input.issue,
      reason: input.reason,
      solution: input.solution,
      taskSummary,
      createdAt: new Date().toISOString(),
    };

    this.stmtInsertDiscussion.run({
      ...discussion,
      decision: null,
      resolvedAt: null,
    });

    return discussion;
  }

  async getDiscussions(sessionId: string): Promise<Discussion[]> {
    const rows = this.stmtGetDiscussionsBySession.all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToDiscussion(r));
  }

  async getUnresolvedDiscussions(): Promise<Discussion[]> {
    const rows = this.stmtGetAllDiscussions.all() as Record<string, unknown>[];
    return rows
      .map((r) => this.rowToDiscussion(r))
      .filter((d) => !d.decision);
  }

  async resolveDiscussion(id: string, decision: string): Promise<void> {
    this.stmtResolveDiscussion.run(decision, new Date().toISOString(), id);
  }

  async listDiscussions(filter?: { priority?: string; unresolved?: boolean }): Promise<Discussion[]> {
    const rows = this.stmtGetAllDiscussions.all() as Record<string, unknown>[];
    let all = rows.map((r) => this.rowToDiscussion(r));

    if (filter?.priority) {
      all = all.filter((d) => d.priority === filter.priority);
    }
    if (filter?.unresolved) {
      all = all.filter((d) => !d.decision);
    }

    return all;
  }

  // ═══════════════════════════════════════════
  // FlowMetrics CRUD
  // ═══════════════════════════════════════════

  async recordStepEntry(
    sessionId: string,
    flow: string,
    step: string,
    stepName: string,
    tokensBySource: Record<string, number>,
  ): Promise<void> {
    const newTotal = Object.values(tokensBySource).reduce((a, b) => a + b, 0);
    const newUserTokens = tokensBySource["User"] ?? 0;

    const existing = this.stmtGetMetricsBySessionStep.get(sessionId, step) as Record<string, unknown> | undefined;

    if (existing) {
      const existingTokens = parseJSON<Record<string, number>>(existing["tokensBySource"], {});
      const merged: Record<string, number> = { ...existingTokens };
      for (const [source, tokens] of Object.entries(tokensBySource)) {
        merged[source] = (merged[source] ?? 0) + tokens;
      }

      this.stmtUpdateMetrics.run(
        (existing["tokensConsumed"] as number) + newTotal,
        JSON.stringify(merged),
        (existing["userInputTokens"] as number) + newUserTokens,
        existing["stepInCount"],
        existing["dwellTime"],
        existing["humanInterventionTime"],
        existing["id"],
      );
    } else {
      let taskSummary = "";
      const task = await this.getTask(sessionId);
      if (task) taskSummary = task.summary;

      this.stmtInsertMetrics.run({
        id: generateId(),
        sessionId,
        flow,
        step,
        stepName,
        stepInCount: 1,
        tokensConsumed: newTotal,
        tokensBySource: JSON.stringify(tokensBySource),
        dwellTime: 0,
        humanInterventionTime: 0,
        userInputTokens: newUserTokens,
        taskSummary,
      });
    }
  }

  async incrementStepCount(
    sessionId: string,
    flow: string,
    step: string,
    stepName: string,
    taskSummary: string,
  ): Promise<void> {
    const existing = this.stmtGetMetricsBySessionStep.get(sessionId, step) as Record<string, unknown> | undefined;

    if (existing) {
      this.stmtUpdateMetrics.run(
        existing["tokensConsumed"],
        existing["tokensBySource"],
        existing["userInputTokens"],
        (existing["stepInCount"] as number) + 1,
        existing["dwellTime"],
        existing["humanInterventionTime"],
        existing["id"],
      );
      logger.info(`[vibe-pm] incrementStepCount: step=${step} count=${(existing["stepInCount"] as number) + 1}`);
    } else {
      this.stmtInsertMetrics.run({
        id: generateId(),
        sessionId,
        flow,
        step,
        stepName,
        stepInCount: 1,
        tokensConsumed: 0,
        tokensBySource: JSON.stringify({ System: 0, FlowControl: 0, User: 0, Assistant: 0, Tool: 0, Reasoning: 0 }),
        dwellTime: 0,
        humanInterventionTime: 0,
        userInputTokens: 0,
        taskSummary,
      });
    }
  }

  async recordStepExit(
    sessionId: string,
    step: string,
    dwellTime: number,
    humanInterventionTime: number,
  ): Promise<void> {
    const existing = this.stmtGetMetricsBySessionStep.get(sessionId, step) as Record<string, unknown> | undefined;

    if (existing) {
      this.stmtUpdateMetrics.run(
        existing["tokensConsumed"],
        existing["tokensBySource"],
        existing["userInputTokens"],
        existing["stepInCount"],
        (existing["dwellTime"] as number) + dwellTime,
        (existing["humanInterventionTime"] as number) + humanInterventionTime,
        existing["id"],
      );
      logger.info(`[vibe-pm] recordStepExit: step=${step} dwellTime=${dwellTime}ms total=${(existing["dwellTime"] as number) + dwellTime}ms`);
    }
  }

  async getFlowMetrics(sessionId: string): Promise<FlowMetrics[]> {
    const rows = this.stmtGetMetricsBySession.all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToFlowMetrics(r));
  }

  async getFlowMetricsByFlow(flow: string): Promise<FlowMetrics[]> {
    const rows = this.stmtGetMetricsByFlow.all(flow) as Record<string, unknown>[];
    return rows.map((r) => this.rowToFlowMetrics(r));
  }

  // ═══════════════════════════════════════════
  // 新增查询
  // ═══════════════════════════════════════════

  async getLastClosedTask(sessionId: string): Promise<Task | null> {
    const rows = this.stmtGetClosedTasksBySession.all(sessionId) as Record<string, unknown>[];
    const tasks = rows.map((r) => this.rowToTask(r));
    tasks.sort((a, b) => (b.endAt ?? "").localeCompare(a.endAt ?? ""));
    return tasks[0] ?? null;
  }

  async getSourceTokenBreakdown(sessionId: string): Promise<SourceTokenBreakdown[]> {
    const metrics = await this.getFlowMetrics(sessionId);
    const aggregated: Record<string, number> = {};
    for (const m of metrics) {
      if (m.tokensBySource) {
        for (const [source, tokens] of Object.entries(m.tokensBySource)) {
          aggregated[source] = (aggregated[source] ?? 0) + tokens;
        }
      }
    }
    return Object.entries(aggregated).map(([source, tokens]) => ({
      source: source as TokenSource,
      tokens,
    }));
  }

  async getStepTokenBreakdown(sessionId: string): Promise<StepTokenBreakdown[]> {
    const metrics = await this.getFlowMetrics(sessionId);
    return metrics.map((m) => ({
      step: m.step,
      stepName: m.stepName,
      stepInCount: m.stepInCount,
      tokensConsumed: m.tokensConsumed,
    }));
  }

  // ═══════════════════════════════════════════
  // Row mapping helpers
  // ═══════════════════════════════════════════

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row["id"] as string,
      sessionId: row["sessionId"] as string,
      flow: row["flow"] as string,
      currentStep: row["currentStep"] as string,
      currentStepName: row["currentStepName"] as string,
      startAt: row["startAt"] as string,
      endAt: (row["endAt"] as string) ?? undefined,
      closed: !!row["closed"],
      summary: row["summary"] as string,
      specRef: (row["specRef"] as string) ?? undefined,
      planRef: (row["planRef"] as string) ?? undefined,
      stepTransitions: parseJSON<StepTransition[]>(row["stepTransitions"], []) as StepTransition[] | undefined,
    };
  }

  private rowToDiscussion(row: Record<string, unknown>): Discussion {
    return {
      id: row["id"] as string,
      fromSessionId: row["fromSessionId"] as string,
      priority: row["priority"] as Discussion["priority"],
      importance: row["importance"] as Discussion["importance"],
      severity: row["severity"] as Discussion["severity"],
      issue: row["issue"] as string,
      reason: row["reason"] as string,
      solution: row["solution"] as string,
      decision: (row["decision"] as string) ?? undefined,
      taskSummary: row["taskSummary"] as string,
      createdAt: row["createdAt"] as string,
      resolvedAt: (row["resolvedAt"] as string) ?? undefined,
    };
  }

  private rowToFlowMetrics(row: Record<string, unknown>): FlowMetrics {
    return {
      id: row["id"] as string,
      sessionId: row["sessionId"] as string,
      flow: row["flow"] as string,
      step: row["step"] as string,
      stepName: row["stepName"] as string,
      stepInCount: row["stepInCount"] as number,
      tokensConsumed: row["tokensConsumed"] as number,
      tokensBySource: parseJSON<Record<TokenSource, number>>(
        row["tokensBySource"],
        {} as Record<TokenSource, number>,
      ),
      dwellTime: row["dwellTime"] as number,
      humanInterventionTime: row["humanInterventionTime"] as number,
      userInputTokens: row["userInputTokens"] as number,
      taskSummary: row["taskSummary"] as string,
    };
  }
}
