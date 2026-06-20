/**
 * MemorySystem — vibe-pm 数据层
 *
 * 基于 SQLite (bun:sqlite) 管理 Task / Discussion / FlowMetrics 三类结构化记忆。
 */
import {Database, Statement} from "bun:sqlite";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {logger} from "../core/logger.js";
import type {
  CreateDiscussionInput,
  CreateTaskInput,
  Discussion,
  FlowMetrics,
  IMemorySystem,
  SessionTokenMetrics,
  SourceTokenBreakdown,
  StepTokenBreakdown,
  StepTransition,
  Task,
  TokenSource
} from "./types.js";
import {DuplicateTaskError} from "./errors.js";
import {ApiTelemetry, TokenCount} from "../token/types";

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

function prefixKeys(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[`$${k}`] = v;
  }
  return out;
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
  private db!: Database;

  // Prepared statements (lazily initialized after init())
  private stmtInsertTask!: Statement;
  private stmtGetTaskBySession!: Statement;
  private stmtGetActiveTaskBySession!: Statement;
  private stmtUpdateTaskStep!: Statement;
  private stmtCloseTask!: Statement;
  private stmtListActiveTasks!: Statement;
  private stmtGetTaskById!: Statement;
  private stmtUpdateTaskTransitions!: Statement;

  private stmtInsertDiscussion!: Statement;
  private stmtGetDiscussionsBySession!: Statement;
  private stmtGetAllDiscussions!: Statement;
  private stmtResolveDiscussion!: Statement;

  private stmtGetMetricsBySessionStep!: Statement;
  private stmtUpdateMetrics!: Statement;
  private stmtInsertMetrics!: Statement;
  private stmtGetMetricsBySession!: Statement;
  private stmtGetMetricsByFlow!: Statement;

  private stmtGetClosedTasksBySession!: Statement;

  private stmtInitSessionTokens!: Statement;
  private stmtGetSessionTokens!: Statement;
  private stmtUpdateSessionTokens!: Statement;

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

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");

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

      CREATE TABLE IF NOT EXISTS session_tokens (
        sessionId       TEXT PRIMARY KEY,
        text            INTEGER NOT NULL DEFAULT 0,
        "user"          INTEGER NOT NULL DEFAULT 0,
        assistant       INTEGER NOT NULL DEFAULT 0,
        flowControl     INTEGER NOT NULL DEFAULT 0,
        tool            INTEGER NOT NULL DEFAULT 0,
        reasoning       INTEGER NOT NULL DEFAULT 0,
        apiInput        INTEGER NOT NULL DEFAULT 0,
        apiOutput       INTEGER NOT NULL DEFAULT 0,
        apiReasoning    INTEGER NOT NULL DEFAULT 0,
        apiCacheRead    INTEGER NOT NULL DEFAULT 0,
        apiCacheWrite   INTEGER NOT NULL DEFAULT 0,
        scaleFactor     REAL NOT NULL DEFAULT 1.0,
        startedAt       TEXT NOT NULL,
        updatedAt       TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_tokens_sessionId ON session_tokens(sessionId);
    `);

    // ─── Prepared Statements ───
    this.stmtInsertTask = this.db.prepare(`
      INSERT INTO tasks (id, sessionId, flow, currentStep, currentStepName, startAt, endAt, closed, summary, specRef, planRef, stepTransitions)
      VALUES ($id, $sessionId, $flow, $currentStep, $currentStepName, $startAt, $endAt, $closed, $summary, $specRef, $planRef, $stepTransitions)
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
      VALUES ($id, $fromSessionId, $priority, $importance, $severity, $issue, $reason, $solution, $decision, $taskSummary, $createdAt, $resolvedAt)
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
      VALUES ($id, $sessionId, $flow, $step, $stepName, $stepInCount, $tokensConsumed, $tokensBySource, $dwellTime, $humanInterventionTime, $userInputTokens, $taskSummary)
    `);
    this.stmtGetMetricsBySession = this.db.prepare("SELECT * FROM flowMetrics WHERE sessionId = ?");
    this.stmtGetMetricsByFlow = this.db.prepare("SELECT * FROM flowMetrics WHERE flow = ?");

    this.stmtInitSessionTokens = this.db.prepare(`
       INSERT OR IGNORE INTO session_tokens (sessionId, text, "user", assistant, flowControl, tool, reasoning, apiInput, apiOutput, apiReasoning, apiCacheRead, apiCacheWrite, scaleFactor, startedAt, updatedAt)
      VALUES ($sessionId, $text, $user, $assistant, $flowControl, $tool, $reasoning, $apiInput, $apiOutput, $apiReasoning, $apiCacheRead, $apiCacheWrite, $scaleFactor, $startedAt, $updatedAt)
    `);
    this.stmtGetSessionTokens = this.db.prepare("SELECT * FROM session_tokens WHERE sessionId = ?");
    this.stmtUpdateSessionTokens = this.db.prepare(`
       UPDATE session_tokens SET text = $text, "user" = $user, assistant = $assistant, flowControl = $flowControl, tool = $tool, reasoning = $reasoning, apiInput = $apiInput, apiOutput = $apiOutput, apiReasoning = $apiReasoning, apiCacheRead = $apiCacheRead, apiCacheWrite = $apiCacheWrite, scaleFactor = $scaleFactor, updatedAt = $updatedAt WHERE sessionId = $sessionId
    `);
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

    this.stmtInsertTask.run(prefixKeys({
      ...task,
      endAt: null,
      specRef: task.specRef ?? null,
      planRef: task.planRef ?? null,
      stepTransitions: null,
      closed: 0,
    }));

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

    this.stmtInsertDiscussion.run(prefixKeys({
      ...discussion,
      decision: null,
      resolvedAt: null,
    }));

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
    tokenCount: TokenCount
  ): Promise<void> {
    // Convert TokenCount to tokensBySource Record for storage (omit zero values)
    const rawBySource: Record<string, number> = {
      System: tokenCount.text,
      User: tokenCount.user,
      Assistant: tokenCount.assistant,
      FlowControl: tokenCount.flowControl,
      Tool: tokenCount.tool,
      Reasoning: tokenCount.reasoning,
    };
    const tokensBySource: Record<string, number> = {};
    for (const [src, tk] of Object.entries(rawBySource)) {
      if (tk > 0) tokensBySource[src] = tk;
    }

    const newTotal = tokenCount.text + tokenCount.user + tokenCount.assistant;
    const newUserTokens = tokenCount.user ?? 0;

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

      this.stmtInsertMetrics.run(prefixKeys({
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
      }));
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
      this.stmtInsertMetrics.run(prefixKeys({
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
      }));
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
  // Session Tokens CRUD
  // ═══════════════════════════════════════════

  async initSessionTokens(sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    this.stmtInitSessionTokens.run(prefixKeys({
      sessionId,
      text: 0,
      user: 0,
      assistant: 0,
      flowControl: 0,
      tool: 0,
      reasoning: 0,
      apiInput: 0,
      apiOutput: 0,
      apiReasoning: 0,
      apiCacheRead: 0,
      apiCacheWrite: 0,
      scaleFactor: 1.0,
      startedAt: now,
      updatedAt: now,
    }));
  }

  async recordSessionTokens(sessionId: string, tokenCount: TokenCount, apiTelemetry?: ApiTelemetry): Promise<void> {
    let existing = this.stmtGetSessionTokens.get(sessionId) as Record<string, unknown> | undefined;

    if (!existing) {
      await this.initSessionTokens(sessionId);
      existing = this.stmtGetSessionTokens.get(sessionId) as Record<string, unknown>;
    }

    const now = new Date().toISOString();

    let scaleFactor = 1.0;
    if (apiTelemetry) {
      const denominator = tokenCount.text + tokenCount.user + tokenCount.assistant;
      scaleFactor = denominator === 0 ? 1.0 : (apiTelemetry.input + (apiTelemetry.cache?.read ?? 0) + (apiTelemetry.cache?.write ?? 0)) / denominator;
    }

    this.stmtUpdateSessionTokens.run(prefixKeys({
      sessionId,
      text: (existing["text"] as number ?? 0) + tokenCount.text,
      user: (existing["user"] as number ?? 0) + tokenCount.user,
      assistant: (existing["assistant"] as number ?? 0) + tokenCount.assistant,
      flowControl: (existing["flowControl"] as number ?? 0) + tokenCount.flowControl,
      tool: (existing["tool"] as number ?? 0) + tokenCount.tool,
      reasoning: (existing["reasoning"] as number ?? 0) + tokenCount.reasoning,
      apiInput: (existing["apiInput"] as number ?? 0) + (apiTelemetry?.input ?? 0),
      apiOutput: (existing["apiOutput"] as number ?? 0) + (apiTelemetry?.output ?? 0),
      apiReasoning: (existing["apiReasoning"] as number ?? 0) + (apiTelemetry?.reasoning ?? 0),
      apiCacheRead: (existing["apiCacheRead"] as number ?? 0) + (apiTelemetry?.cache?.read ?? 0),
      apiCacheWrite: (existing["apiCacheWrite"] as number ?? 0) + (apiTelemetry?.cache?.write ?? 0),
      scaleFactor,
      updatedAt: now,
    }));
  }

  async getSessionTokens(sessionId: string): Promise<SessionTokenMetrics | null> {
    const row = this.stmtGetSessionTokens.get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.rowToSessionTokenMetrics(row) : null;
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

  private rowToSessionTokenMetrics(row: Record<string, unknown>): SessionTokenMetrics {
    return {
      sessionId: row["sessionId"] as string,
      user: row["user"] as number,
      assistant: row["assistant"] as number,
      flowControl: row["flowControl"] as number,
      text: row["text"] as number,
      tool: row["tool"] as number,
      reasoning: row["reasoning"] as number,
      apiInput: row["apiInput"] as number,
      apiOutput: row["apiOutput"] as number,
      apiReasoning: row["apiReasoning"] as number,
      apiCacheRead: row["apiCacheRead"] as number,
      apiCacheWrite: row["apiCacheWrite"] as number,
      scaleFactor: row["scaleFactor"] as number,
      startedAt: row["startedAt"] as string,
      updatedAt: row["updatedAt"] as string,
    };
  }
}
