/**
 * Flow Engine 错误类
 */

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
  ) {
    const lines = [
      "当前 Session 已有活跃任务:",
      `- 流程: ${existingTask.flow}`,
      `- 当前步骤: ${existingTask.currentStep} - ${existingTask.currentStepName}`,
      `- 摘要: ${existingTask.summary}`,
      `- 开始时间: ${existingTask.startAt}`,
      "",
      "请先执行 /pm-task-close 关闭当前任务后再启动新任务。",
    ];
    super(lines.join("\n"));
    this.name = "DuplicateActiveTaskError";
  }
}

/** 请求的 Flow 文档不存在 */
export class FlowNotFoundError extends Error {
  constructor(flowName: string) {
    super(`Flow "${flowName}" not found in /docs/flow/.`);
    this.name = "FlowNotFoundError";
  }
}

/** Flow 文档解析失败 */
export class FlowParseError extends Error {
  constructor(flowName: string, reason: string) {
    super(`Failed to parse Flow "${flowName}": ${reason}`);
    this.name = "FlowParseError";
  }
}
