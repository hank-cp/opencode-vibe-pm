/**
 * Task status data loading
 *
 * Loads status info for the current or previous task from IMemorySystem.
 */

import type { IMemorySystem } from '../../memory';
import type { TaskStatusData } from '../types.js';
import { formatElapsed } from '../types.js';

/**
 * Load task status data for the specified session.
 *
 * Query logic:
 * 1. Check active task first → active state
 * 2. No active task → check last closed task → last state
 * 3. Neither found → empty state
 */
export async function loadTaskStatus(
  memory: IMemorySystem,
  sessionId: string
): Promise<TaskStatusData> {
  const active = await memory.getActiveTask(sessionId);

  if (active) {
    return {
      type: 'active',
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
      type: 'last',
      flow: last.flow,
      currentStep: last.currentStep,
      currentStepName: last.currentStepName,
      startAt: last.startAt,
      endAt: last.endAt,
      elapsed: formatElapsed(last.startAt, last.endAt),
    };
  }

  return { type: 'empty' };
}
