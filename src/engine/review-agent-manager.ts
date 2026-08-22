/**
 * Review Agent Manager
 *
 * Orchestrates the review sub-session lifecycle for steps whose Output Review
 * includes `review-agent`: create child session (parentID = main session),
 * synchronously prompt it with the fixed review framework, parse the verdict,
 * and degrade gracefully on startup failure / timeout / parse failure.
 */

import { logger } from '../core';
import { clearTimeout, setTimeout } from 'node:timers';
import {
  buildReviewPrompt,
  conservativeReviewFallback,
  parseReviewOutput,
  type ReviewFailReason,
} from './review-framework.js';
import type { SubsessionClient } from './subsession-client.js';

export interface StartReviewInput {
  parentSessionId: string;
  taskId: string;
  taskSummary: string;
  flow: string;
  stepId: string;
  stepName: string;
  acceptanceStandard: string;
  /** Step-level review checklist items (may be empty) */
  reviewChecklist: string[];
  conversationExcerpt: string;
}

export type ReviewConclusion = 'pass' | 'fail' | 'degraded' | 'timeout';

export interface ReviewResult {
  conclusion: ReviewConclusion;
  /** Present only when conclusion is "fail" */
  failReason?: ReviewFailReason;
  feedback: string;
  nextInput: string;
  /** Raw review agent output text (diagnostics) */
  raw?: string;
}

export interface ReviewAgentManagerOptions {
  timeoutMs?: number;
  framework?: string;
}

export const DEFAULT_REVIEW_TIMEOUT_MS = 600000;

const REVIEW_TOOL_WHITELIST: Record<string, boolean> = {
  read: true,
  grep: true,
  glob: true,
  bash: true,
};

export class ReviewAgentManager {
  constructor(
    private client: SubsessionClient,
    private options: ReviewAgentManagerOptions = {},
  ) {}

  async startReview(input: StartReviewInput): Promise<ReviewResult> {
    const prompt = buildReviewPrompt(
      {
        taskSummary: input.taskSummary,
        flow: input.flow,
        stepId: input.stepId,
        stepName: input.stepName,
        acceptanceStandard: input.acceptanceStandard,
        reviewChecklist: input.reviewChecklist,
        conversationExcerpt: input.conversationExcerpt,
      },
      this.options.framework,
    );

    let subSessionId: string;
    try {
      subSessionId = await this.client.createSession(
        input.parentSessionId,
        `vibe-pm-review:${input.taskId}:${input.stepId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`ReviewAgentManager: createSession failed: ${message}`);
      return {
        conclusion: 'degraded',
        feedback: `Review agent session creation failed: ${message}`,
        nextInput: '',
      };
    }

    try {
      const output = await withTimeout(
        this.client.prompt(subSessionId, prompt, REVIEW_TOOL_WHITELIST),
        this.options.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS,
      );

      const { parsed, raw } = parseReviewOutput(output);
      if (parsed) {
        return {
          conclusion: parsed.conclusion,
          failReason: parsed.failReason,
          feedback: parsed.feedback,
          nextInput: parsed.nextInput,
          raw,
        };
      }
      return { ...conservativeReviewFallback(raw), raw };
    } catch (err) {
      if (err instanceof ReviewTimeoutError) {
        logger.warn(`ReviewAgentManager: review timed out for ${input.taskId}:${input.stepId}`);
        return {
          conclusion: 'timeout',
          feedback: 'Review timed out',
          nextInput: '',
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`ReviewAgentManager: prompt failed: ${message}`);
      return {
        conclusion: 'degraded',
        feedback: `Review agent prompt failed: ${message}`,
        nextInput: '',
      };
    }
  }
}

class ReviewTimeoutError extends Error {
  constructor() {
    super('review timeout');
    this.name = 'ReviewTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReviewTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
