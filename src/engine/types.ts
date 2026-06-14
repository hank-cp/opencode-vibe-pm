/**
 * Flow Engine 类型定义
 */

// ─── Flow 文档实体 ───

export interface FlowDefinition {
  name: string;
  command: string;
  scenario: string;
  inputRequirements: InputRequirement[];
  defaultDeliverables: string[];
  fsmDiagram: string;
  steps: StepDefinition[];
}

export interface InputRequirement {
  name: string;
  required: boolean;
  description: string;
}

export interface StepDefinition {
  id: string;
  name: string;
  goal: string;
  agent: string;
  regulations: string[];
  instructions: string[];
  humanInLoop: boolean;
  onComplete: string;
}

// ─── 上下文注入 ───

/** 前缀固定 + 尾部变量注入模型 */
export interface InjectedContext {
  /** 固定前缀（缓存稳定）：Constitution + Flow 全文 + 控制 Prompt（静态） */
  staticPrefix: string;
  /** 步骤动态（尾部变量）：当前步骤状态 + Task 状态 + Regulation（条件） */
  stepDynamic: string;
  /** 条件注入的 Regulation 内容 */
  regulations: string[];
}

/** @deprecated 使用 InjectedContext 替代 */
export interface InjectionPlan {
  layer1: string;
  layer2: string;
  layer3: string | null;
}

// ─── 消息裁剪 ───

export interface StepTaggedMessage {
  message: { role: string; content: string | null; [key: string]: unknown };
  stepId: string;
  stepDistance: number;
}

export interface DepthAssignedMessage extends StepTaggedMessage {
  depth: number;
}

export interface StepTransition {
  stepId: string;
  stepName: string;
  timestamp: number;
}

// ─── 任务启动 ───

export interface StartTaskParams {
  sessionId: string;
  flow: string;
  summary: string;
  specRef?: string;
  planRef?: string;
}
