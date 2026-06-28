/**
 * Flow Engine 错误类
 */

import { getControlPromptTemplate } from '../i18n';

/** 尝试在已有活跃任务的 session 中启动新任务时抛出 */
export class DuplicateActiveTaskError extends Error {
  constructor(
    public readonly existingTask: {
      flow: string;
      currentStep: string;
      currentStepName: string;
      summary: string;
      startAt: string;
    },
    locale: string
  ) {
    const i18n = getControlPromptTemplate(locale);
    const msg = i18n.error.duplicateActiveTask(
      existingTask.flow,
      existingTask.currentStep,
      existingTask.currentStepName,
      existingTask.summary,
      existingTask.startAt
    );
    super(msg);
    this.name = 'DuplicateActiveTaskError';
  }
}

/** 请求的 Flow 文档不存在 */
export class FlowNotFoundError extends Error {
  constructor(flowName: string) {
    super(`Flow "${flowName}" not found in /docs/flow/.`);
    this.name = 'FlowNotFoundError';
  }
}

/** Flow 文档解析失败 */
export class FlowParseError extends Error {
  constructor(flowName: string, reason: string) {
    super(`Failed to parse Flow "${flowName}": ${reason}`);
    this.name = 'FlowParseError';
  }
}
