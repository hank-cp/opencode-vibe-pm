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

function unwrapArray(result: AxioResult): unknown[] {
  if (result.statusCode !== 200) return [];
  const data = result.data as Record<string, unknown> | undefined;
  if (data?.documents && Array.isArray(data.documents)) {
    return data.documents;
  }
  return [];
}

function unwrapSingle(result: AxioResult): unknown | null {
  if (result.statusCode !== 200) return null;
  const data = result.data as Record<string, unknown> | undefined;
  if (data?.documents && Array.isArray(data.documents)) {
    return (data.documents[0] as unknown) ?? null;
  }
  return null;
}

function generateId(): string {
  return crypto.randomUUID();
}

// ─── Collection 类型别名 ───

type AxioCollection = Awaited<
  ReturnType<Awaited<ReturnType<AxioDB["createDB"]>>["createCollection"]>
>;

// ─── MemorySystem ───

export class MemorySystem implements IMemorySystem {
  private tasks!: AxioCollection;
  private discussions!: AxioCollection;
  private flowMetrics!: AxioCollection;

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

  async getTask(sessionId: string): Promise<Task | null> {
    const result = (await this.tasks
      .query({ sessionId })
      .Limit(1)
      .exec()) as AxioResult;

    return unwrapSingle(result) as Task | null;
  }

  async getActiveTask(sessionId: string): Promise<Task | null> {
    const result = (await this.tasks
      .query({ sessionId, closed: false })
      .Limit(1)
      .exec()) as AxioResult;

    return unwrapSingle(result) as Task | null;
  }

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

  async closeTask(sessionId: string): Promise<void> {
    await this.tasks
      .update({ sessionId, closed: false })
      .UpdateOne({ closed: true });
  }

  async listActiveTasks(): Promise<Task[]> {
    const result = (await this.tasks
      .query({ closed: false })
      .exec()) as AxioResult;

    return unwrapArray(result) as Task[];
  }

  // ═══════════════════════════════════════════
  // Discussion CRUD
  // ═══════════════════════════════════════════

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

  async getDiscussions(sessionId: string): Promise<Discussion[]> {
    const result = (await this.discussions
      .query({ fromSessionId: sessionId })
      .exec()) as AxioResult;

    return unwrapArray(result) as Discussion[];
  }

  async getUnresolvedDiscussions(): Promise<Discussion[]> {
    const result = (await this.discussions
      .query({})
      .exec()) as AxioResult;

    // AxioDB 不支持 $exists 在大规模文档中稳定，改为 JS 过滤
    const all = unwrapArray(result) as Discussion[];
    return all.filter((d) => !d.decision);
  }

  async resolveDiscussion(id: string, decision: string): Promise<void> {
    await this.discussions
      .update({ id })
      .UpdateOne({
        decision,
        resolvedAt: new Date().toISOString(),
      });
  }

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

  async getFlowMetrics(sessionId: string): Promise<FlowMetrics[]> {
    const result = (await this.flowMetrics
      .query({ sessionId })
      .exec()) as AxioResult;

    return unwrapArray(result) as FlowMetrics[];
  }

  async getFlowMetricsByFlow(flow: string): Promise<FlowMetrics[]> {
    const result = (await this.flowMetrics
      .query({ flow })
      .exec()) as AxioResult;

    return unwrapArray(result) as FlowMetrics[];
  }
}
