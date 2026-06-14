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

export interface InjectedContext {
  /** Session 级别的一次性注入内容：Constitution + Flow 全文 + 提示 */
  systemPrefix: string;
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

// ─── 任务启动 ───

export interface StartTaskParams {
  sessionId: string;
  flow: string;
  summary: string;
  specRef?: string;
  planRef?: string;
}
