/**
 * MemorySystem — vibe-pm 数据层
 *
 * 基于 SQLite (bun:sqlite) 管理 Task / Discussion / StepTokenMetrics 三类结构化记忆。
 */
import { Database, Statement } from 'bun:sqlite';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../core';
import type {
  CreateDiscussionInput,
  CreateTaskInput,
  Discussion,
  StepTokenMetrics,
  IMemorySystem,
  SessionTokenMetrics,
  StepTokenBreakdown,
  StepTransition,
  SubagentTokenMetrics,
  Task,
} from './types.js';
import { DuplicateTaskError } from './errors.js';
import { ApiTelemetry, TokenCount } from '../token';

// ─── 内部辅助 ───

function generateId(): string {
  return crypto.randomUUID();
}

/** 解析 JSON 列，容错返回默认值 */
function parseJSON<T>(raw: unknown, fallback: T): T {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      logger.debug(`parseJSON: failed to parse JSON, using fallback`);
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
 * - stepTokenMetrics：按步骤采集的 Token 消耗、停留时间等指标
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
  private stmtUpsertMetrics!: Statement;
  private stmtInsertMetrics!: Statement;
  private stmtGetMetricsBySession!: Statement;
  private stmtGetMetricsByFlow!: Statement;

  private stmtGetClosedTasksBySession!: Statement;
  private stmtCheckDupUserRequest!: Statement;

  private stmtInitSessionTokens!: Statement;
  private stmtGetSessionTokens!: Statement;
  private stmtUpsertSessionTokens!: Statement;

  private stmtUpsertSubagentTokens!: Statement;
  private stmtGetSubagentTokens!: Statement;

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
    this.db.run('PRAGMA journal_mode = WAL');

    // ─── DDL ───
    for (const stmt of `
      CREATE TABLE IF NOT EXISTS tasks (
        id              TEXT NOT NULL,
        session_id      TEXT NOT NULL,
        flow            TEXT NOT NULL,
        current_step    TEXT NOT NULL,
        current_step_name TEXT NOT NULL,
        started_at      TEXT NOT NULL,
        ended_at        TEXT,
        closed          INTEGER NOT NULL DEFAULT 0,
        summary         TEXT NOT NULL,
        user_request    TEXT,
        step_transitions TEXT,
        CONSTRAINT tasks_id_pkey PRIMARY KEY (id)
      );

      CREATE TABLE IF NOT EXISTS discussions (
        id              TEXT NOT NULL,
        from_session_id TEXT NOT NULL,
        priority        TEXT NOT NULL,
        importance      INTEGER NOT NULL,
        severity        INTEGER NOT NULL,
        issue           TEXT NOT NULL,
        reason          TEXT NOT NULL,
        solution        TEXT NOT NULL,
        decision        TEXT,
        task_summary    TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        resolved_at     TEXT,
        CONSTRAINT discussions_id_pkey PRIMARY KEY (id)
      );

      CREATE TABLE IF NOT EXISTS step_token_metrics (
        id                    TEXT NOT NULL,
        session_id            TEXT NOT NULL,
        flow                  TEXT NOT NULL,
        step                  TEXT NOT NULL,
        step_name             TEXT NOT NULL,
        step_in_count         INTEGER NOT NULL DEFAULT 1,
        tokens_consumed       INTEGER NOT NULL DEFAULT 0,
        tokens_by_source      TEXT,
        task_summary          TEXT NOT NULL,
        CONSTRAINT step_token_metrics_id_pkey PRIMARY KEY (id)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_session_id_closed ON tasks(session_id, closed);
      CREATE INDEX IF NOT EXISTS idx_discussions_from_session_id ON discussions(from_session_id);
      CREATE INDEX IF NOT EXISTS idx_step_token_metrics_session_id ON step_token_metrics(session_id);
      CREATE INDEX IF NOT EXISTS idx_step_token_metrics_session_id_step ON step_token_metrics(session_id, step);
      CREATE INDEX IF NOT EXISTS idx_step_token_metrics_flow ON step_token_metrics(flow);

      CREATE TABLE IF NOT EXISTS session_tokens (
        session_id      TEXT NOT NULL,
        text            INTEGER NOT NULL DEFAULT 0,
        "user"          INTEGER NOT NULL DEFAULT 0,
        assistant       INTEGER NOT NULL DEFAULT 0,
        flow_control    INTEGER NOT NULL DEFAULT 0,
        tool            INTEGER NOT NULL DEFAULT 0,
        reasoning       INTEGER NOT NULL DEFAULT 0,
        api_input       INTEGER NOT NULL DEFAULT 0,
        api_output      INTEGER NOT NULL DEFAULT 0,
        api_reasoning   INTEGER NOT NULL DEFAULT 0,
        api_cache_read  INTEGER NOT NULL DEFAULT 0,
        api_cache_write INTEGER NOT NULL DEFAULT 0,
        scale_factor    REAL NOT NULL DEFAULT 1.0,
        started_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        CONSTRAINT session_tokens_session_id_pkey PRIMARY KEY (session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_session_tokens_session_id ON session_tokens(session_id);

      CREATE TABLE IF NOT EXISTS subagent_tokens (
        session_id       TEXT NOT NULL,
        parent_session_id TEXT NOT NULL,
        "user"           INTEGER NOT NULL DEFAULT 0,
        assistant        INTEGER NOT NULL DEFAULT 0,
        api_input        INTEGER NOT NULL DEFAULT 0,
        api_output       INTEGER NOT NULL DEFAULT 0,
        api_reasoning    INTEGER NOT NULL DEFAULT 0,
        api_cache_read   INTEGER NOT NULL DEFAULT 0,
        api_cache_write  INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT subagent_tokens_session_id_pkey PRIMARY KEY (session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_subagent_tokens_parent_session_id ON subagent_tokens(parent_session_id);
    `.split(';')) {
      const trimmed = stmt.trim();
      if (trimmed) this.db.run(trimmed);
    }

    // Migration: add user_request column (idempotent, fails silently if column exists)
    try {
      this.db.run('ALTER TABLE tasks ADD COLUMN user_request TEXT');
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_tasks_session_id_user_request ON tasks(session_id, user_request)'
      );
    } catch {
      /* column/index already exists */
    }

    // ─── Prepared Statements ───
    this.stmtInsertTask = this.db.prepare(`
      INSERT INTO tasks (id, session_id, flow, current_step, current_step_name, started_at, ended_at, closed, summary, user_request, step_transitions)
      VALUES ($id, $sessionId, $flow, $currentStep, $currentStepName, $startAt, $endAt, $closed, $summary, $userRequest, $stepTransitions)
    `);
    this.stmtGetTaskBySession = this.db.prepare('SELECT * FROM tasks WHERE session_id = ? LIMIT 1');
    this.stmtGetActiveTaskBySession = this.db.prepare(
      'SELECT * FROM tasks WHERE session_id = ? AND closed = 0 LIMIT 1'
    );
    this.stmtUpdateTaskStep = this.db.prepare(
      'UPDATE tasks SET current_step = ?, current_step_name = ? WHERE id = ?'
    );
    this.stmtCloseTask = this.db.prepare('UPDATE tasks SET closed = 1, ended_at = ? WHERE id = ?');
    this.stmtListActiveTasks = this.db.prepare('SELECT * FROM tasks WHERE closed = 0');
    this.stmtGetTaskById = this.db.prepare('SELECT * FROM tasks WHERE id = ? LIMIT 1');
    this.stmtUpdateTaskTransitions = this.db.prepare(
      'UPDATE tasks SET step_transitions = ? WHERE id = ?'
    );
    this.stmtGetClosedTasksBySession = this.db.prepare(
      'SELECT * FROM tasks WHERE session_id = ? AND closed = 1'
    );
    this.stmtCheckDupUserRequest = this.db.prepare(
      'SELECT COUNT(*) AS cnt FROM tasks WHERE session_id = ? AND user_request = ? AND user_request IS NOT NULL AND closed = 0'
    );

    this.stmtInsertDiscussion = this.db.prepare(`
      INSERT INTO discussions (id, from_session_id, priority, importance, severity, issue, reason, solution, decision, task_summary, created_at, resolved_at)
      VALUES ($id, $fromSessionId, $priority, $importance, $severity, $issue, $reason, $solution, $decision, $taskSummary, $createdAt, $resolvedAt)
    `);
    this.stmtGetDiscussionsBySession = this.db.prepare(
      'SELECT * FROM discussions WHERE from_session_id = ?'
    );
    this.stmtGetAllDiscussions = this.db.prepare('SELECT * FROM discussions');
    this.stmtResolveDiscussion = this.db.prepare(
      'UPDATE discussions SET decision = ?, resolved_at = ? WHERE id = ?'
    );

    this.stmtGetMetricsBySessionStep = this.db.prepare(
      'SELECT * FROM step_token_metrics WHERE session_id = ? AND step = ? LIMIT 1'
    );
    this.stmtUpdateMetrics = this.db.prepare(`
      UPDATE step_token_metrics SET tokens_consumed = ?, tokens_by_source = ?, step_in_count = ?
      WHERE id = ?
    `);
    this.stmtInsertMetrics = this.db.prepare(`
      INSERT INTO step_token_metrics (id, session_id, flow, step, step_name, step_in_count, tokens_consumed, tokens_by_source, task_summary)
      VALUES ($id, $sessionId, $flow, $step, $stepName, $stepInCount, $tokensConsumed, $tokensBySource, $taskSummary)
    `);
    this.stmtUpsertMetrics = this.db.prepare(`
      INSERT OR REPLACE INTO step_token_metrics (id, session_id, flow, step, step_name, step_in_count, tokens_consumed, tokens_by_source, task_summary)
      VALUES ($id, $sessionId, $flow, $step, $stepName, $stepInCount, $tokensConsumed, $tokensBySource, $taskSummary)
    `);
    this.stmtGetMetricsBySession = this.db.prepare(
      'SELECT * FROM step_token_metrics WHERE session_id = ?'
    );
    this.stmtGetMetricsByFlow = this.db.prepare('SELECT * FROM step_token_metrics WHERE flow = ?');

    this.stmtInitSessionTokens = this.db.prepare(`
       INSERT OR IGNORE INTO session_tokens (session_id, text, "user", assistant, flow_control, tool, reasoning, api_input, api_output, api_reasoning, api_cache_read, api_cache_write, scale_factor, started_at, updated_at)
      VALUES ($sessionId, $text, $user, $assistant, $flowControl, $tool, $reasoning, $apiInput, $apiOutput, $apiReasoning, $apiCacheRead, $apiCacheWrite, $scaleFactor, $startedAt, $updatedAt)
    `);
    this.stmtGetSessionTokens = this.db.prepare(
      'SELECT * FROM session_tokens WHERE session_id = ?'
    );
    this.stmtUpsertSessionTokens = this.db.prepare(`
       INSERT OR REPLACE INTO session_tokens (session_id, text, "user", assistant, flow_control, tool, reasoning, api_input, api_output, api_reasoning, api_cache_read, api_cache_write, scale_factor, started_at, updated_at)
       VALUES ($sessionId, $text, $user, $assistant, $flowControl, $tool, $reasoning, $apiInput, $apiOutput, $apiReasoning, $apiCacheRead, $apiCacheWrite, $scaleFactor, $startedAt, $updatedAt)
    `);
    this.stmtUpsertSubagentTokens = this.db.prepare(`
      INSERT OR REPLACE INTO subagent_tokens (session_id, parent_session_id, "user", assistant, api_input, api_output, api_reasoning, api_cache_read, api_cache_write)
      VALUES ($sessionId, $parentSessionId, $user, $assistant, $apiInput, $apiOutput, $apiReasoning, $apiCacheRead, $apiCacheWrite)
    `);
    this.stmtGetSubagentTokens = this.db.prepare(
      'SELECT * FROM subagent_tokens WHERE parent_session_id = ?'
    );
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

    this.stmtInsertTask.run(
      prefixKeys({
        ...task,
        endAt: null,
        userRequest: task.userRequest ?? null,
        stepTransitions: null,
        closed: 0,
      })
    );

    return task;
  }

  async checkDuplicateUserRequest(sessionId: string, userRequest: string): Promise<boolean> {
    if (!userRequest) return false;
    const row = this.stmtCheckDupUserRequest.get(sessionId, userRequest) as
      { cnt: number } | undefined;
    return (row?.cnt ?? 0) > 0;
  }

  async getTask(sessionId: string): Promise<Task | null> {
    const row = this.stmtGetTaskBySession.get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : null;
  }

  async getActiveTask(sessionId: string): Promise<Task | null> {
    const row = this.stmtGetActiveTaskBySession.get(sessionId) as
      Record<string, unknown> | undefined;
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

    const existingTransitions = parseJSON<StepTransition[]>(row['step_transitions'], []);
    const transitions = [...existingTransitions, transition];
    this.stmtUpdateTaskTransitions.run(JSON.stringify(transitions), id);
  }

  // ═══════════════════════════════════════════
  // Discussion CRUD
  // ═══════════════════════════════════════════

  async createDiscussion(input: CreateDiscussionInput): Promise<Discussion> {
    let taskSummary = input.taskSummary ?? '';
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

    this.stmtInsertDiscussion.run(
      prefixKeys({
        ...discussion,
        decision: null,
        resolvedAt: null,
      })
    );

    return discussion;
  }

  async getDiscussions(sessionId: string): Promise<Discussion[]> {
    const rows = this.stmtGetDiscussionsBySession.all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToDiscussion(r));
  }

  async getUnresolvedDiscussions(): Promise<Discussion[]> {
    const rows = this.stmtGetAllDiscussions.all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToDiscussion(r)).filter((d) => !d.decision);
  }

  async resolveDiscussion(id: string, decision: string): Promise<void> {
    this.stmtResolveDiscussion.run(decision, new Date().toISOString(), id);
  }

  async listDiscussions(filter?: {
    priority?: string;
    unresolved?: boolean;
  }): Promise<Discussion[]> {
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
  // StepTokenMetrics CRUD
  // ═══════════════════════════════════════════

  async recordStepTokens(
    sessionId: string,
    flow: string,
    step: string,
    stepName: string,
    tokenCount: TokenCount
  ): Promise<void> {
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
    const existing = this.stmtGetMetricsBySessionStep.get(sessionId, step) as
      Record<string, unknown> | undefined;

    if (existing) {
      const existingTokens = parseJSON<Record<string, number>>(existing['tokens_by_source'], {});
      const merged: Record<string, number> = { ...existingTokens };
      for (const [source, tokens] of Object.entries(tokensBySource)) {
        merged[source] = (merged[source] ?? 0) + tokens;
      }
      this.stmtUpsertMetrics.run(
        prefixKeys({
          id: existing['id'] as string,
          sessionId,
          flow,
          step,
          stepName,
          stepInCount: (existing['step_in_count'] as number) ?? 1,
          tokensConsumed: ((existing['tokens_consumed'] as number) ?? 0) + newTotal,
          tokensBySource: JSON.stringify(merged),
          taskSummary: (existing['task_summary'] as string) ?? '',
        })
      );
    } else {
      let taskSummary = '';
      const task = await this.getTask(sessionId);
      if (task) taskSummary = task.summary;
      this.stmtUpsertMetrics.run(
        prefixKeys({
          id: generateId(),
          sessionId,
          flow,
          step,
          stepName,
          stepInCount: 1,
          tokensConsumed: newTotal,
          tokensBySource: JSON.stringify(tokensBySource),
          taskSummary,
        })
      );
    }
  }

  async incrementStepCount(
    sessionId: string,
    flow: string,
    step: string,
    stepName: string,
    taskSummary: string
  ): Promise<void> {
    const existing = this.stmtGetMetricsBySessionStep.get(sessionId, step) as
      Record<string, unknown> | undefined;

    if (existing) {
      this.stmtUpdateMetrics.run(
        existing['tokens_consumed'],
        existing['tokens_by_source'],
        (existing['step_in_count'] as number) + 1,
        existing['id']
      );
      logger.info(
        `incrementStepCount: step=${step} count=${(existing['step_in_count'] as number) + 1}`
      );
    } else {
      this.stmtInsertMetrics.run(
        prefixKeys({
          id: generateId(),
          sessionId,
          flow,
          step,
          stepName,
          stepInCount: 1,
          tokensConsumed: 0,
          tokensBySource: JSON.stringify({
            System: 0,
            FlowControl: 0,
            User: 0,
            Assistant: 0,
            Tool: 0,
            Reasoning: 0,
          }),
          taskSummary,
        })
      );
    }
  }

  async recordStepExit(sessionId: string, step: string): Promise<void> {
    const existing = this.stmtGetMetricsBySessionStep.get(sessionId, step) as
      Record<string, unknown> | undefined;

    if (existing) {
      this.stmtUpdateMetrics.run(
        existing['tokens_consumed'],
        existing['tokens_by_source'],
        existing['step_in_count'],
        existing['id']
      );
    }
  }

  async getStepTokenMetrics(sessionId: string): Promise<StepTokenMetrics[]> {
    const rows = this.stmtGetMetricsBySession.all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToStepTokenMetrics(r));
  }

  async getStepTokenMetricsByFlow(flow: string): Promise<StepTokenMetrics[]> {
    const rows = this.stmtGetMetricsByFlow.all(flow) as Record<string, unknown>[];
    return rows.map((r) => this.rowToStepTokenMetrics(r));
  }

  // ═══════════════════════════════════════════
  // Session Tokens CRUD
  // ═══════════════════════════════════════════

  async initSessionTokens(sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    this.stmtInitSessionTokens.run(
      prefixKeys({
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
      })
    );
  }

  async recordSessionTokens(
    sessionId: string,
    tokenCount: TokenCount,
    apiTelemetry?: ApiTelemetry
  ): Promise<void> {
    const now = new Date().toISOString();

    let scaleFactor = 1.0;
    if (apiTelemetry) {
      const denominator = tokenCount.text + tokenCount.user + tokenCount.assistant;
      scaleFactor =
        denominator === 0
          ? 1.0
          : (apiTelemetry.input +
              (apiTelemetry.cache?.read ?? 0) +
              (apiTelemetry.cache?.write ?? 0)) /
            denominator;
    }

    this.stmtUpsertSessionTokens.run(
      prefixKeys({
        sessionId,
        text: tokenCount.text,
        user: tokenCount.user,
        assistant: tokenCount.assistant,
        flowControl: tokenCount.flowControl,
        tool: tokenCount.tool,
        reasoning: tokenCount.reasoning,
        apiInput: apiTelemetry?.input ?? 0,
        apiOutput: apiTelemetry?.output ?? 0,
        apiReasoning: apiTelemetry?.reasoning ?? 0,
        apiCacheRead: apiTelemetry?.cache?.read ?? 0,
        apiCacheWrite: apiTelemetry?.cache?.write ?? 0,
        scaleFactor,
        startedAt: now,
        updatedAt: now,
      })
    );
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
    tasks.sort((a, b) => (b.endAt ?? '').localeCompare(a.endAt ?? ''));
    return tasks[0] ?? null;
  }

  async getStepTokenBreakdown(sessionId: string): Promise<StepTokenBreakdown[]> {
    const metrics = await this.getStepTokenMetrics(sessionId);
    return metrics.map((m) => ({
      step: m.step,
      stepName: m.stepName,
      stepInCount: m.stepInCount,
      tokensConsumed: m.tokensConsumed,
    }));
  }

  // ═══════════════════════════════════════════
  // Subagent Tokens CRUD
  // ═══════════════════════════════════════════

  async recordSubagentTokens(
    sessionId: string,
    parentSessionId: string,
    tokenCount: TokenCount,
    apiTelemetry?: ApiTelemetry
  ): Promise<void> {
    this.stmtUpsertSubagentTokens.run(
      prefixKeys({
        sessionId,
        parentSessionId,
        user: tokenCount.user,
        assistant: tokenCount.assistant,
        apiInput: apiTelemetry?.input ?? 0,
        apiOutput: apiTelemetry?.output ?? 0,
        apiReasoning: apiTelemetry?.reasoning ?? 0,
        apiCacheRead: apiTelemetry?.cache?.read ?? 0,
        apiCacheWrite: apiTelemetry?.cache?.write ?? 0,
      })
    );
  }

  async getSubagentTokens(parentSessionId: string): Promise<SubagentTokenMetrics[]> {
    const rows = this.stmtGetSubagentTokens.all(parentSessionId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSubagentTokenMetrics(r));
  }

  // ═══════════════════════════════════════════
  // Row mapping helpers
  // ═══════════════════════════════════════════

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row['id'] as string,
      sessionId: row['session_id'] as string,
      flow: row['flow'] as string,
      currentStep: row['current_step'] as string,
      currentStepName: row['current_step_name'] as string,
      startAt: row['started_at'] as string,
      endAt: (row['ended_at'] as string) ?? undefined,
      closed: !!row['closed'],
      summary: row['summary'] as string,
      userRequest: (row['user_request'] as string) ?? undefined,
      stepTransitions: parseJSON<StepTransition[]>(row['step_transitions'], []) as
        StepTransition[] | undefined,
    };
  }

  private rowToDiscussion(row: Record<string, unknown>): Discussion {
    return {
      id: row['id'] as string,
      fromSessionId: row['from_session_id'] as string,
      priority: row['priority'] as Discussion['priority'],
      importance: row['importance'] as Discussion['importance'],
      severity: row['severity'] as Discussion['severity'],
      issue: row['issue'] as string,
      reason: row['reason'] as string,
      solution: row['solution'] as string,
      decision: (row['decision'] as string) ?? undefined,
      taskSummary: row['task_summary'] as string,
      createdAt: row['created_at'] as string,
      resolvedAt: (row['resolved_at'] as string) ?? undefined,
    };
  }

  private rowToStepTokenMetrics(row: Record<string, unknown>): StepTokenMetrics {
    return {
      id: row['id'] as string,
      sessionId: row['session_id'] as string,
      flow: row['flow'] as string,
      step: row['step'] as string,
      stepName: row['step_name'] as string,
      stepInCount: row['step_in_count'] as number,
      tokensConsumed: row['tokens_consumed'] as number,
      tokensBySource: parseJSON<Record<string, number>>(
        row['tokens_by_source'],
        {} as Record<string, number>
      ),
      taskSummary: row['task_summary'] as string,
    };
  }

  private rowToSessionTokenMetrics(row: Record<string, unknown>): SessionTokenMetrics {
    return {
      sessionId: row['session_id'] as string,
      user: row['user'] as number,
      assistant: row['assistant'] as number,
      flowControl: row['flow_control'] as number,
      text: row['text'] as number,
      tool: row['tool'] as number,
      reasoning: row['reasoning'] as number,
      apiInput: row['api_input'] as number,
      apiOutput: row['api_output'] as number,
      apiReasoning: row['api_reasoning'] as number,
      apiCacheRead: row['api_cache_read'] as number,
      apiCacheWrite: row['api_cache_write'] as number,
      scaleFactor: row['scale_factor'] as number,
      startedAt: row['started_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  private rowToSubagentTokenMetrics(row: Record<string, unknown>): SubagentTokenMetrics {
    return {
      sessionId: row['session_id'] as string,
      parentSessionId: row['parent_session_id'] as string,
      user: row['user'] as number,
      assistant: row['assistant'] as number,
      apiInput: row['api_input'] as number,
      apiOutput: row['api_output'] as number,
      apiReasoning: row['api_reasoning'] as number,
      apiCacheRead: row['api_cache_read'] as number,
      apiCacheWrite: row['api_cache_write'] as number,
    };
  }
}
