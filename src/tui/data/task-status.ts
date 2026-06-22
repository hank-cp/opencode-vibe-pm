/**
 * 任务状态数据加载
 *
 * 从 IMemorySystem 加载当前或上一任务的状态信息。
 */

import type { IMemorySystem } from "../../memory/types.js";
import type { TaskStatusData } from "../types.js";
import { formatElapsed } from "../types.js";

/**
 * 加载指定 session 的任务状态数据。
 *
 * 查询逻辑：
 * 1. 先查活跃任务 → active 态
 * 2. 无活跃任务 → 查上一关闭任务 → last 态
 * 3. 均无 → empty 态
 */
export async function loadTaskStatus(
  memory: IMemorySystem,
  sessionId: string,
): Promise<TaskStatusData> {
  const active = await memory.getActiveTask(sessionId);

  if (active) {
    return {
      type: "active",
      flow: active.flow,
      currentStep: active.currentStep,
      currentStepName: active.currentStepName,
      startAt: active.startAt,
      elapsed: formatElapsed(active.startAt),
    };
  }

  const last = await memory.getLastClosedTask(sessionId);

  if (last) {
    return {
      type: "last",
      flow: last.flow,
      currentStep: last.currentStep,
      currentStepName: last.currentStepName,
      startAt: last.startAt,
      endAt: last.endAt,
      elapsed: formatElapsed(last.startAt, last.endAt),
    };
  }

  return { type: "empty" };
}
