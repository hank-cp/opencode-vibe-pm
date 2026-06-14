/**
 * MemorySystem — vibe-pm 数据层
 *
 * 基于 AxioDB 嵌入式 JSON 数据库，管理 Task / Discussion / FlowMetrics 三类结构化记忆。
 */

import { AxioDB } from "axiodb";
import * as crypto from "node:crypto";
import type {
  Task,
  CreateTaskInput,
  Discussion,
  CreateDiscussionInput,
  FlowMetrics,
  IMemorySystem,
} from "./types.js";
import { DuplicateTaskError } from "./errors.js";

// ─── AxioDB 返回类型 ───

/**
 * AxioDB 查询执行结果的结构。
 * `data.documents` 通常包含匹配到的文档数组。
 */
interface AxioResult {
  statusCode: number;
  data: unknown;
  message?: string;
}

// ─── 内部辅助 ───

/**
 * 从 AxioDB 查询结果中提取文档数组。
 * 返回空数组作为安全兜底，而非抛出异常。
 */
function unwrapArray(result: AxioResult): unknown[] {
  if (result.statusCode !== 200) return [];
  const data = result.data as Record<string, unknown> | undefined;
  if (data?.documents && Array.isArray(data.documents)) {
    return data.documents;
  }
  return [];
}

/**
 * 从 AxioDB 查询结果中提取第一条文档。
 * 无匹配时返回 null。
 */
function unwrapSingle(result: AxioResult): unknown | null {
  if (result.statusCode !== 200) return null;
  const data = result.data as Record<string, unknown> | undefined;
  if (data?.documents && Array.isArray(data.documents)) {
    return (data.documents[0] as unknown) ?? null;
  }
  return null;
}

/** 生成 UUID v4，用于 Discussion 和 FlowMetrics 文档的 id 字段。 */
function generateId(): string {
  return crypto.randomUUID();
}

// ─── Collection 类型别名 ───

/**
 * AxioDB collection 实例的类型。
 * 通过类型推导避免直接依赖 AxioDB 内部类型。
 */
type AxioCollection = Awaited<
  ReturnType<Awaited<ReturnType<AxioDB["createDB"]>>["createCollection"]>
>;

// ─── MemorySystem ───

/**
 * vibe-pm 的结构化记忆层。
 *
 * 基于 AxioDB 管理三类数据：
 * - tasks：FSM 驱动的任务状态
 * - discussions：非紧急讨论项（碎片时间友好，异步审阅）
 * - flowMetrics：按步骤采集的 Token 消耗、停留时间等指标
 */
export class MemorySystem implements IMemorySystem {
  private tasks!: AxioCollection;
  private discussions!: AxioCollection;
  private flowMetrics!: AxioCollection;

  /**
   * 初始化数据库连接与集合。
   *
   * 在指定目录下创建 AxioDB 实例，并建立 tasks / discussions / flowMetrics 三个 collection。
   * 使用前必须调用一次。
   *
   * @param dataDir AxioDB 数据文件存储目录（通常为 `.vibe-pm/`）
   */
  async init(dataDir: string): Promise<void> {
    const db = new AxioDB({
      CustomPath: dataDir,
      // "." 让 AxioDB 不额外创建 RootName 子目录，数据直接放在 dataDir 下
      RootName: ".",
    });

    const appDb = await db.createDB("data");
    this.tasks = await appDb.createCollection("tasks");
    this.discussions = await appDb.createCollection("discussions");
    this.flowMetrics = await appDb.createCollection("flowMetrics");
  }

  // ═══════════════════════════════════════════
  // Task CRUD
  // ═══════════════════════════════════════════

  /**
   * 创建新任务。
   *
   * 同一 session 不允许同时存在多个活跃任务 ——
   * 若已有未关闭的 Task，抛出 {@link DuplicateTaskError}。
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    // 检查是否已有 active task
    const existing = await this.getActiveTask(input.sessionId);
    if (existing) {
      throw new DuplicateTaskError(input.sessionId);
    }

    const task: Task = {
      ...input,
      closed: false,
    };

    await this.tasks.insert(task);
    return task;
  }

  /** 按 sessionId 查询任务。无匹配时返回 null。 */
  async getTask(sessionId: string): Promise<Task | null> {
    const result = (await this.tasks
      .query({ sessionId })
      .Limit(1)
      .exec()) as AxioResult;

    return unwrapSingle(result) as Task | null;
  }

  /** 查询 session 下未关闭的活跃任务。无匹配时返回 null。 */
  async getActiveTask(sessionId: string): Promise<Task | null> {
    const result = (await this.tasks
      .query({ sessionId, closed: false })
      .Limit(1)
      .exec()) as AxioResult;

    return unwrapSingle(result) as Task | null;
  }

  /** 更新当前活跃任务的步骤信息（步骤 ID + 名称）。 */
  async updateStep(
    sessionId: string,
    step: string,
    stepName: string,
  ): Promise<void> {
    const result = await this.tasks
      .update({ sessionId, closed: false })
      .UpdateOne({
        currentStep: step,
        currentStepName: stepName,
      });

    if ((result as AxioResult).statusCode !== 200) {
      throw new Error(
        `Failed to update step for session ${sessionId}: ${(result as AxioResult).message ?? "unknown error"}`,
      );
    }
  }

  /** 关闭活跃任务（设置 closed = true）。若无活跃任务则静默跳过。 */
  async closeTask(sessionId: string): Promise<void> {
    try {
      const result = await this.tasks
        .update({ sessionId, closed: false })
        .UpdateOne({ closed: true });

      const status = (result as AxioResult).statusCode;
      if (status !== 200) {
        // 无匹配文档（已关闭或不存在）→ 不做任何事
        const msg = (result as AxioResult).message ?? "";
        if (msg.includes("No data found")) return;
        throw new Error(
          `Failed to close task for session ${sessionId}: ${msg || "unknown error"}`,
        );
      }
    } catch (err) {
      // closeTask 是 best-effort；调用方（如 session.idle）不应因关闭失败而中断
      if (err instanceof Error && !err.message.startsWith("Failed to close")) {
        throw err;
      }
    }
  }

  /** 查询所有未关闭的任务。 */
  async listActiveTasks(): Promise<Task[]> {
    const result = (await this.tasks
      .query({ closed: false })
      .exec()) as AxioResult;

    return unwrapArray(result) as Task[];
  }

  // ═══════════════════════════════════════════
  // Discussion CRUD
  // ═══════════════════════════════════════════

  /**
   * 创建讨论项。
   *
   * 若未传入 `taskSummary`，自动从关联 Task 的 `summary` 字段填充。
   */
  async createDiscussion(input: CreateDiscussionInput): Promise<Discussion> {
    // 若未传 taskSummary，从关联 Task 自动填充
    let taskSummary = input.taskSummary ?? "";
    if (!taskSummary) {
      const task = await this.getTask(input.fromSessionId);
      if (task) {
        taskSummary = task.summary;
      }
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

    await this.discussions.insert(discussion);
    return discussion;
  }

  /** 查询指定 session 关联的所有讨论项。 */
  async getDiscussions(sessionId: string): Promise<Discussion[]> {
    const result = (await this.discussions
      .query({ fromSessionId: sessionId })
      .exec()) as AxioResult;

    return unwrapArray(result) as Discussion[];
  }

  /**
   * 查询所有未解决的讨论项。
   *
   * 判断依据：decision 字段为空（即尚未做出决定）。
   */
  async getUnresolvedDiscussions(): Promise<Discussion[]> {
    const result = (await this.discussions
      .query({})
      .exec()) as AxioResult;

    // AxioDB 不支持 $exists 在大规模文档中稳定，改为 JS 过滤
    const all = unwrapArray(result) as Discussion[];
    return all.filter((d) => !d.decision);
  }

  /** 为指定讨论项设置决定内容，并记录解决时间。 */
  async resolveDiscussion(id: string, decision: string): Promise<void> {
    await this.discussions
      .update({ id })
      .UpdateOne({
        decision,
        resolvedAt: new Date().toISOString(),
      });
  }

  /**
   * 按条件列出讨论项。
   *
   * @param filter.priority 按优先级过滤
   * @param filter.unresolved 仅返回未解决项
   */
  async listDiscussions(
    filter?: { priority?: string; unresolved?: boolean },
  ): Promise<Discussion[]> {
    const result = (await this.discussions
      .query({})
      .exec()) as AxioResult;

    let all = unwrapArray(result) as Discussion[];

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

  /**
   * 记录进入步骤事件。
   *
   * 两次调用逻辑：
   * - 该 session+step 已有记录 → 累加 `stepInCount` 和 `tokensConsumed`
   * - 无记录 → 创建新的 FlowMetrics 文档，同时回填 `taskSummary`
   */
  async recordStepEntry(
    sessionId: string,
    flow: string,
    step: string,
    stepName: string,
    tokensConsumed: number,
    userInputTokens: number,
  ): Promise<void> {
    // 查找是否已有此 session+step 的记录
    const existing = (await this.flowMetrics
      .query({ sessionId, step })
      .Limit(1)
      .exec()) as AxioResult;

    const existingRecord = unwrapSingle(existing) as FlowMetrics | null;

    if (existingRecord) {
      // 累加计数和 token
      await this.flowMetrics
        .update({ id: existingRecord.id })
        .UpdateOne({
          stepInCount: existingRecord.stepInCount + 1,
          tokensConsumed: existingRecord.tokensConsumed + tokensConsumed,
          userInputTokens:
            existingRecord.userInputTokens + userInputTokens,
        });
    } else {
      // 获取 taskSummary
      let taskSummary = "";
      const task = await this.getTask(sessionId);
      if (task) {
        taskSummary = task.summary;
      }

      const metrics: FlowMetrics = {
        id: generateId(),
        sessionId,
        flow,
        step,
        stepName,
        stepInCount: 1,
        tokensConsumed,
        dwellTime: 0,
        humanInterventionTime: 0,
        userInputTokens,
        taskSummary,
      };

      await this.flowMetrics.insert(metrics);
    }
  }

  /**
   * 记录退出步骤事件。
   *
   * 累加 `dwellTime` 和 `humanInterventionTime`。
   * 如果找不到对应的进入记录（异常情况），静默跳过。
   */
  async recordStepExit(
    sessionId: string,
    step: string,
    dwellTime: number,
    humanInterventionTime: number,
  ): Promise<void> {
    // 查找 session+step 记录并更新退出时间
    const existing = (await this.flowMetrics
      .query({ sessionId, step })
      .Limit(1)
      .exec()) as AxioResult;

    const existingRecord = unwrapSingle(existing) as FlowMetrics | null;

    if (existingRecord) {
      await this.flowMetrics
        .update({ id: existingRecord.id })
        .UpdateOne({
          dwellTime: existingRecord.dwellTime + dwellTime,
          humanInterventionTime:
            existingRecord.humanInterventionTime + humanInterventionTime,
        });
    }
  }

  /** 查询指定 session 的所有步骤指标记录。 */
  async getFlowMetrics(sessionId: string): Promise<FlowMetrics[]> {
    const result = (await this.flowMetrics
      .query({ sessionId })
      .exec()) as AxioResult;

    return unwrapArray(result) as FlowMetrics[];
  }

  /** 查询指定流程的所有步骤指标记录（跨 session 汇总）。 */
  async getFlowMetricsByFlow(flow: string): Promise<FlowMetrics[]> {
    const result = (await this.flowMetrics
      .query({ flow })
      .exec()) as AxioResult;

    return unwrapArray(result) as FlowMetrics[];
  }
}
