/**
 * Memory System entity and interface definitions
 *
 * Manages three categories of Structured Memory: Task (Task State),
 * Discussion (Discussion items), StepTokenMetrics (Flow Metrics).
 */

// ─── Task ───

import type { ApiTelemetry, TokenCount } from '../token';

/** Step transition record: written once per setStep call, appended in chronological order */
export interface StepTransition {
  /** Source Step ID */
  fromStep: string;
  /** Destination Step ID */
  toStep: string;
  /** Transition timestamp (ISO 8601) */
  at: string;
}export interface Task {
  id: string;
  sessionId: string;
  flow: string;
  currentStep: string;
  currentStepName: string;
  startAt: string;
  /** Task end time (ISO 8601), written by closeTask */
  endAt?: string;
  closed: boolean;
  summary: string;
  /** User's original request content (text within <user-request> tag), used for deduplication */
  userRequest?: string;
  /** Step transition history in chronological order. From the second record onward, dwell time can be computed from the `at` delta of adjacent records. */
  stepTransitions?: StepTransition[];
}

export interface CreateTaskInput {
  sessionId: string;
  flow: string;
  currentStep: string;
  currentStepName: string;
  startAt: string;
  summary: string;
  userRequest?: string;
}

// ─── Discussion ───

export interface Discussion {
  id: string;
  fromSessionId: string;
  priority: 'high' | 'medium' | 'low';
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
  priority: 'high' | 'medium' | 'low';
  importance: 1 | 2 | 3 | 4 | 5;
  severity: 1 | 2 | 3 | 4 | 5;
  issue: string;
  reason: string;
  solution: string;
  taskSummary?: string;
}

// ─── StepTokenMetrics ───

export interface StepTokenMetrics {
  id: string;
  sessionId: string;
  flow: string;
  step: string;
  stepName: string;
  stepInCount: number;
  tokensConsumed: number;
  /** Token distribution by source, independently accumulated per source */
  tokensBySource: Record<string, number>;
  taskSummary: string;
}

/** Per-Step Token summary */
export interface StepTokenBreakdown {
  step: string;
  stepName: string;
  stepInCount: number;
  tokensConsumed: number;
}

// ─── Session Tokens ───

/** Session-level Token storage — hierarchical column design */
export interface SessionTokenMetrics {
  sessionId: string;
  /** Base types */
  user: number; // = User
  assistant: number; // = Assistant
  /** By purpose */
  flowControl: number; // ⊆ user
  text: number; // = text part tokens
  tool: number; // ⊆ assistant
  reasoning: number; // ⊆ assistant
  /** LLM API telemetry (written only when the LLM returns data) */
  apiInput: number;
  apiOutput: number;
  apiReasoning: number;
  apiCacheRead: number;
  apiCacheWrite: number;
  /** Calibration factor = (apiInput + apiCacheRead + apiCacheWrite) / (user + assistant) */
  scaleFactor: number;
  /** Timestamp */
  startedAt: string;
  updatedAt: string;
}

/** Input parameters for recordSessionTokens — categorized by TokenCounter's 6 sources */
export interface RecordSessionTokensInput {
  text: number;
  user: number;
  assistant: number;
  flowControl: number;
  tool: number;
  reasoning: number;
}

// ─── Subagent Tokens ───

/** Subagent Token storage — distinguished by role + API telemetry */
export interface SubagentTokenMetrics {
  sessionId: string;
  parentSessionId: string;
  user: number;
  assistant: number;
  apiInput: number;
  apiOutput: number;
  apiReasoning: number;
  apiCacheRead: number;
  apiCacheWrite: number;
}

// ─── Review Record ───

/** Structured review conclusion written by the Review Agent Manager */
export type ReviewConclusion = 'pass' | 'fail' | 'degraded' | 'timeout';

/** Review failure reason classification (rollback target selector) */
export type ReviewFailReason =
  | 'Execution problem'
  | 'Design problem'
  | 'Unreasonable acceptance criteria';

/** A step output review outcome, persisted per review-agent verification */
export interface ReviewRecord {
  id: string;
  taskId: string;
  sessionId: string;
  flow: string;
  step: string;
  conclusion: ReviewConclusion;
  /** Present only when conclusion is "fail" */
  failReason?: ReviewFailReason;
  feedback: string;
  createdAt: string;
}

export interface CreateReviewInput {
  taskId: string;
  sessionId: string;
  flow: string;
  step: string;
  conclusion: ReviewConclusion;
  failReason?: ReviewFailReason;
  feedback: string;
}

// ─── Journal Entry ───

/** Metadata for one journaler briefing appended to the task journal file */
export interface JournalEntry {
  id: string;
  taskId: string;
  fromStep: string;
  toStep: string;
  /** The step transition timestamp (ISO 8601), inherited from setStep */
  at: string;
  /** Journal file path the briefing was appended to */
  filePath: string;
  /** Entry write time (ISO 8601) */
  createdAt: string;
}

export interface CreateJournalEntryInput {
  taskId: string;
  fromStep: string;
  toStep: string;
  at: string;
  filePath: string;
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
  listDiscussions(filter?: { priority?: string; unresolved?: boolean }): Promise<Discussion[]>;

  // StepTokenMetrics
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
    taskSummary: string
  ): Promise<void>;
  recordStepExit(sessionId: string, step: string): Promise<void>;
  getStepTokenMetrics(sessionId: string): Promise<StepTokenMetrics[]>;
  getStepTokenMetricsByFlow(flow: string): Promise<StepTokenMetrics[]>;

  // Additional Queries
  getLastClosedTask(sessionId: string): Promise<Task | null>;
  getStepTokenBreakdown(sessionId: string): Promise<StepTokenBreakdown[]>;

  // Session Tokens
  initSessionTokens(sessionId: string): Promise<void>;
  recordSessionTokens(
    sessionId: string,
    tokenCount: TokenCount,
    apiTelemetry?: ApiTelemetry
  ): Promise<void>;
  getSessionTokens(sessionId: string): Promise<SessionTokenMetrics | null>;

  // Subagent Tokens
  recordSubagentTokens(
    sessionId: string,
    parentSessionId: string,
    tokenCount: TokenCount,
    apiTelemetry?: ApiTelemetry
  ): Promise<void>;
  getSubagentTokens(parentSessionId: string): Promise<SubagentTokenMetrics[]>;

  // Reviews
  recordReview(input: CreateReviewInput): Promise<ReviewRecord>;
  getReviews(taskId: string): Promise<ReviewRecord[]>;

  // Journal Entries
  recordJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntry>;
  getJournalEntries(taskId: string): Promise<JournalEntry[]>;

  // Initialization
  init(dataDir: string): Promise<void>;
}
