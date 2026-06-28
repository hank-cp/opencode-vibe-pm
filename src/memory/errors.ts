/**
 * Memory System 错误类
 */

/** 尝试为已有活跃任务的 session 创建第二个 Task 时抛出 */
export class DuplicateTaskError extends Error {
  constructor(sessionId: string) {
    super(`Cannot create Task: session "${sessionId}" already has an active task.`);
    this.name = 'DuplicateTaskError';
  }
}

/** 通用数据层错误 */
export class MemorySystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemorySystemError';
  }
}
