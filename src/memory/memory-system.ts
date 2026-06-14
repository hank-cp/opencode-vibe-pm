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

interface AxioResult {
  statusCode: number;
  data: unknown;
  message?: string;
}

// ─── 内部辅助 ───

/**
 * 从 AxioDB 查询结果中提取文档数组。
 * 当 statusCode 非 200 或无有效文档时返回空数组，避免调用方处理 null。
 *
 * @param result - AxioDB query 的原始返回结果
 * @returns 文档数组，无效结果时返回 `[]`
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
 * 无结果时返回 `null`，由调用方自行判空。
 *
 * @param result - AxioDB query 的原始返回结果
 * @returns 第一条文档，无效结果时返回 `null`
 */
function unwrapSingle(result: AxioResult): unknown | null {
  if (result.statusCode !== 200) return null;
  const data = result.data as Record<string, unknown> | undefined;
  if (data?.documents && Array.isArray(data.documents)) {
    return (data.documents[0] as unknown) ?? null;
  }
  return null;
}

/**
 * 生成 UUID v4 作为 Discussion / FlowMetrics 等实体的唯一标识。
 */
function generateId(): string {
  return crypto.randomUUID();
}

// ─── Collection 类型别名 ───

type AxioCollection = Awaited<
  ReturnType<Awaited<ReturnType<AxioDB["createDB"]>>["createCollection"]>
>;

// ─── MemorySystem ───

export class MemorySystem implements IMemorySystem {
  /** Task 集合：管理任务生命周期（创建、更新步骤、关闭） */
  private tasks!: AxioCollection;
  /** Discussion 集合：存储修复过程中产生的讨论项，按 session 关联 */
  private discussions!: AxioCollection;
  /** FlowMetrics 集合：记录每个步骤的进入次数、Token 消耗、停留时间等指标 */
  private flowMetrics!: AxioCollection;

  /**
   * 初始化 MemorySystem，创建 AxioDB 数据库及三个集合。
   * 必须在使用任何 CRUD 操作前调用。
   *
   * @param dataDir - AxioDB 数据存储目录路径
   */
  async init(dataDir: string): Promise<void> {
    const db = new AxioDB({
      CustomPath: dataDir,
      RootName: "vibe-pm",
    });

    const appDb = await db.createDB("vibe-pm");
    this.tasks = await appDb.createCollection("tasks");
    this.discussions = await appDb.createCollection("discussions");
    this.flowMetrics = await appDb.createCollection("flowMetrics");
  }

  // ═══════════════════════════════════════════
  // Task CRUD
  // ═══════════════════════════════════════════

  /**
   * 创建新 Task。同一 session 在同一时刻只能有一个活跃 Task。
   *
   * @param input - 任务输入（sessionId, flow, summary 等）
   * @returns 创建的 Task 对象
   * @throws {DuplicateTaskError} 该 session 已存在活跃 Task 时抛出
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

  /**
   * 按 sessionId 获取 Task（不区分是否已关闭）。
   *
   * @param sessionId - 会话 ID
   * @returns Task 对象，不存在时返回 `null`
   */
  async getTask(sessionId: string): Promise<Task | null> {
    const result = (await this.tasks
      .query({ sessionId })
      .Limit(1)
      .exec()) as AxioResult;

    return unwrapSingle(result) as Task | null;
  }

  /**
   * 获取 session 当前活跃（未关闭）的 Task。
   * 同一 session 最多一个活跃 Task。
   *
   * @param sessionId - 会话 ID
   * @returns 活跃的 Task，不存在时返回 `null`
   */
  async getActiveTask(sessionId: string): Promise<Task | null> {
    const result = (await this.tasks
      .query({ sessionId, closed: false })
      .Limit(1)
      .exec()) as AxioResult;

    return unwrapSingle(result) as Task | null;
  }

  /**
   * 更新会话当前活跃 Task 的步骤信息。
   * 仅更新 closed=false 的 Task。
   *
   * @param sessionId - 会话 ID
   * @param step - 步骤编号（如 'S1', 'S2'）
   * @param stepName - 步骤名称（如 '理解 Bug 描述'）
   */
  async updateStep(
    sessionId: string,
    step: string,
    stepName: string,
  ): Promise<void> {
    await this.tasks
      .update({ sessionId, closed: false })
      .UpdateOne({
        currentStep: step,
        currentStepName: stepName,
      });
  }

  /**
   * 关闭 session 的活跃 Task（设置 closed=true）。
   * 关闭后可创建新 Task。
   *
   * @param sessionId - 会话 ID
   */
  async closeTask(sessionId: string): Promise<void> {
    await this.tasks
      .update({ sessionId, closed: false })
      .UpdateOne({ closed: true });
  }

  /**
   * 列出所有未关闭的 Task，用于查看当前进行中的任务。
   *
   * @returns 活跃 Task 数组
   */
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
   * 创建一条 Discussion（讨论项），用于记录修复过程中的观察和改进建议。
   * 若未传入 taskSummary，会自动从关联的活跃 Task 中提取。
   *
   * @param input - 讨论项输入（fromSessionId, priority, issue 等）
   * @returns 创建的 Discussion 对象
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

  /**
   * 获取指定 session 的所有 Discussion。
   *
   * @param sessionId - 会话 ID
   * @returns Discussion 数组
   */
  async getDiscussions(sessionId: string): Promise<Discussion[]> {
    const result = (await this.discussions
      .query({ fromSessionId: sessionId })
      .exec()) as AxioResult;

    return unwrapArray(result) as Discussion[];
  }

  /**
   * 获取所有尚未决策的 Discussion（decision 字段为空）。
   * 由于 AxioDB 不支持 $exists 查询，改为全量拉取后 JS 过滤。
   *
   * @returns 未决策的 Discussion 数组
   */
  async getUnresolvedDiscussions(): Promise<Discussion[]> {
    const result = (await this.discussions
      .query({})
      .exec()) as AxioResult;

    // AxioDB 不支持 $exists 在大规模文档中稳定，改为 JS 过滤
    const all = unwrapArray(result) as Discussion[];
    return all.filter((d) => !d.decision);
  }

  /**
   * 对指定 Discussion 做出决策，标记为已解决。
   *
   * @param id - Discussion 的唯一标识
   * @param decision - 决策内容
   */
  async resolveDiscussion(id: string, decision: string): Promise<void> {
    await this.discussions
      .update({ id })
      .UpdateOne({
        decision,
        resolvedAt: new Date().toISOString(),
      });
  }

  /**
   * 获取 Discussion 列表，支持按优先级和是否已解决过滤。
   * 过滤逻辑在 JS 侧完成，非数据库查询条件。
   *
   * @param filter - 可选过滤条件
   * @param filter.priority - 按优先级过滤（'high' | 'medium' | 'low'）
   * @param filter.unresolved - 仅返回未决策项
   * @returns 过滤后的 Discussion 数组
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
   * 记录一次步骤进入事件。如已有此 session+step 的记录则累加计数和 Token；
   * 否则创建新记录。
   *
   * @param sessionId - 会话 ID
   * @param flow - 流程名称
   * @param step - 步骤编号
   * @param stepName - 步骤名称
   * @param tokensConsumed - 本次消耗的 Token 数
   * @param userInputTokens - 用户输入占用的 Token 数
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
   * 记录步骤退出事件，累加停留时间和人工介入时间。
   * 仅在有已存在的 session+step 记录时才更新（无记录时静默跳过）。
   *
   * @param sessionId - 会话 ID
   * @param step - 步骤编号
   * @param dwellTime - 本次在该步骤停留的时间（ms）
   * @param humanInterventionTime - 本次人工介入时间（ms）
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

  /**
   * 获取指定 session 的所有流程指标记录。
   *
   * @param sessionId - 会话 ID
   * @returns FlowMetrics 数组
   */
  async getFlowMetrics(sessionId: string): Promise<FlowMetrics[]> {
    const result = (await this.flowMetrics
      .query({ sessionId })
      .exec()) as AxioResult;

    return unwrapArray(result) as FlowMetrics[];
  }

  /**
   * 获取指定流程的所有指标记录（跨 session 汇总）。
   *
   * @param flow - 流程名称
   * @returns FlowMetrics 数组
   */
  async getFlowMetricsByFlow(flow: string): Promise<FlowMetrics[]> {
    const result = (await this.flowMetrics
      .query({ flow })
      .exec()) as AxioResult;

    return unwrapArray(result) as FlowMetrics[];
  }
}
