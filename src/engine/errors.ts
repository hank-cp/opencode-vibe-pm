/**
 * Flow Engine error classes
 */

import { getControlPromptTemplate } from '../i18n';

/** Thrown when attempting to start a new task in a session with an existing active task */
export class DuplicateActiveTaskError extends Error {
  constructor(
    public readonly existingTask: {
      flow: string;
      currentStep: string;
      currentStepName: string;
      summary: string;
      startAt: string;
    },
    locale: string,
  ) {
    const i18n = getControlPromptTemplate(locale);
    const msg = i18n.error.duplicateActiveTask(
      existingTask.flow,
      existingTask.currentStep,
      existingTask.currentStepName,
      existingTask.summary,
      existingTask.startAt,
    );
    super(msg);
    this.name = 'DuplicateActiveTaskError';
  }
}

/** Requested Flow document does not exist */
export class FlowNotFoundError extends Error {
  constructor(flowName: string) {
    super(`Flow "${flowName}" not found in /docs/flow/.`);
    this.name = 'FlowNotFoundError';
  }
}

/** Flow document parsing failed */
export class FlowParseError extends Error {
  constructor(flowName: string, reason: string) {
    super(`Failed to parse Flow "${flowName}": ${reason}`);
    this.name = 'FlowParseError';
  }
}
