/**
 * Memory System 实体与接口定义
 *
 * 管理三类结构化记忆：Task（任务状态）、Discussion（讨论项）、FlowMetrics（流程指标）。
 */

// ─── Task ───

export interface Task {
  documentId: string;
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

// ─── IMemorySystem ───

export interface IMemorySystem {
  // Task
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(sessionId: string): Promise<Task | null>;
  getActiveTask(sessionId: string): Promise<Task | null>;
  updateStep(documentId: string, step: string, stepName: string): Promise<void>;
  closeTask(documentId: string): Promise<void>;
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
  recordStepEntry(
    sessionId: string,
    flow: string,
    step: string,
    stepName: string,
    tokensBySource: Record<string, number>,
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

  // 初始化
  init(dataDir: string): Promise<void>;
}
