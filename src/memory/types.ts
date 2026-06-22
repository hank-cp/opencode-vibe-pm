/**
 * Memory System 实体与接口定义
 *
 * 管理三类结构化记忆：Task（任务状态）、Discussion（讨论项）、FlowMetrics（流程指标）。
 */

// ─── Task ───

import {ApiTelemetry, TokenCount} from "../token";

/** 步骤转换记录：每次 setStep 时写入一条，按时间顺序追加 */
export interface StepTransition {
  /** 离开的步骤 ID */
  fromStep: string;
  /** 进入的步骤 ID */
  toStep: string;
  /** 转换发生时间（ISO 8601） */
  at: string;
}

export interface Task {
  id: string;
  sessionId: string;
  flow: string;
  currentStep: string;
  currentStepName: string;
  startAt: string;
  /** 任务结束时间（ISO 8601），由 closeTask 写入 */
  endAt?: string;
  closed: boolean;
  summary: string;
  specRef?: string;
  planRef?: string;
  /** 用户原始请求内容（<user-request> 标签内文本），用于去重 */
  userRequest?: string;
  /** 步骤转换历史，按时间顺序记录。从第二条记录开始，可通过相邻记录的 at 差值计算停留时间 */
  stepTransitions?: StepTransition[];
}

export interface CreateTaskInput {
  sessionId: string;
  flow: string;
  currentStep: string;
  currentStepName: string;
  startAt: string;
  summary: string;
  specRef?: string;
  planRef?: string;
  userRequest?: string;
}

// ─── Discussion ───

export interface Discussion {
  id: string;
  fromSessionId: string;
  priority: "high" | "medium" | "low";
  importance: 1 | 2 | 3 | 4 | 5;
  severity: 1 | 2 | 3 | 4 | 5;
  issue: string;
  reason: string;
  solution: string;
  decision?: string;
  taskSummary: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface CreateDiscussionInput {
  fromSessionId: string;
  priority: "high" | "medium" | "low";
  importance: 1 | 2 | 3 | 4 | 5;
  severity: 1 | 2 | 3 | 4 | 5;
  issue: string;
  reason: string;
  solution: string;
  taskSummary?: string;
}

// ─── FlowMetrics ───

/** Token 来源分类 — 6 个固定分类 */
export type TokenSource =
  | "System"
  | "FlowControl"
  | "User"
  | "Assistant"
  | "Tool"
  | "Reasoning";

export interface FlowMetrics {
  id: string;
  sessionId: string;
  flow: string;
  step: string;
  stepName: string;
  stepInCount: number;
  tokensConsumed: number;
  /** 按来源分类的 Token 分布，各项独立累加 */
  tokensBySource: Record<TokenSource, number>;
  dwellTime: number;
  humanInterventionTime: number;
  /** @deprecated 可通过 tokensBySource.User 推导，保留以兼容旧数据 */
  userInputTokens: number;
  taskSummary: string;
}

/** 跨步骤聚合的来源级 Token 分布 */
export interface SourceTokenBreakdown {
  source: TokenSource;
  tokens: number;
}

/** 按步骤的 Token 汇总 */
export interface StepTokenBreakdown {
  step: string;
  stepName: string;
  stepInCount: number;
  tokensConsumed: number;
}

// ─── Session Tokens ───

/** Session 级 Token 存储 — 层级式列设计 */
export interface SessionTokenMetrics {
  sessionId: string;
  /** 基础类型 */
  user: number;         // = User
  assistant: number;    // = Assistant
  /** 按用途分 */
  flowControl: number;  // ⊆ user
  text: number;         // = text part tokens
  tool: number;         // ⊆ assistant
  reasoning: number;    // ⊆ assistant
  /** LLM API 遥测（仅当 LLM 返回时写入） */
  apiInput: number;
  apiOutput: number;
  apiReasoning: number;
  apiCacheRead: number;
  apiCacheWrite: number;
  /** 校准因子 = (apiInput + apiCacheRead + apiCacheWrite) / (user + assistant) */
  scaleFactor: number;
  /** 时间戳 */
  startedAt: string;
  updatedAt: string;
}

/** recordSessionTokens 的输入参数 — 按 TokenCounter 6 来源分类 */
export interface RecordSessionTokensInput {
  text: number;
  user: number;
  assistant: number;
  flowControl: number;
  tool: number;
  reasoning: number;
}

// ─── IMemorySystem ───

export interface IMemorySystem {
  // Task
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(sessionId: string): Promise<Task | null>;
  getActiveTask(sessionId: string): Promise<Task | null>;
  updateStep(id: string, step: string, stepName: string): Promise<void>;
  closeTask(id: string): Promise<void>;
  listActiveTasks(): Promise<Task[]>;

  // Discussion
  createDiscussion(input: CreateDiscussionInput): Promise<Discussion>;
  getDiscussions(sessionId: string): Promise<Discussion[]>;
  getUnresolvedDiscussions(): Promise<Discussion[]>;
  resolveDiscussion(id: string, decision: string): Promise<void>;
  listDiscussions(filter?: {
    priority?: string;
    unresolved?: boolean;
  }): Promise<Discussion[]>;

  // FlowMetrics
  recordStepTokens(
    sessionId: string,
    flow: string,
    step: string,
    stepName: string,
    tokenCount: TokenCount
  ): Promise<void>;
  incrementStepCount(
    sessionId: string,
    flow: string,
    step: string,
    stepName: string,
    taskSummary: string,
  ): Promise<void>;
  recordStepExit(
    sessionId: string,
    step: string,
    dwellTime: number,
    humanInterventionTime: number,
  ): Promise<void>;
  getFlowMetrics(sessionId: string): Promise<FlowMetrics[]>;
  getFlowMetricsByFlow(flow: string): Promise<FlowMetrics[]>;

  // 新增查询
  getLastClosedTask(sessionId: string): Promise<Task | null>;
  getSourceTokenBreakdown(sessionId: string): Promise<SourceTokenBreakdown[]>;
  getStepTokenBreakdown(sessionId: string): Promise<StepTokenBreakdown[]>;

  // Session Tokens
  initSessionTokens(sessionId: string): Promise<void>;
  recordSessionTokens(sessionId: string, tokenCount: TokenCount, apiTelemetry?: ApiTelemetry): Promise<void>;
  getSessionTokens(sessionId: string): Promise<SessionTokenMetrics | null>;

  // 初始化
  init(dataDir: string): Promise<void>;
}
