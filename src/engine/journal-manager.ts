/**
 * Journal Manager
 *
 * Fire-and-forget journaler orchestration: on each successful step
 * transition the main flow schedules a briefing task that (in the
 * background) fetches recent conversation messages, spawns a journaler
 * sub-session, and appends its briefing to `.vibe-pm/journal/{taskId}.md`.
 *
 * Tasks run through a FIFO promise chain, so rapid successive transitions
 * are serialized in trigger order. Failures degrade silently.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../core';
import type { MemorySystem } from '../memory';
import { buildJournalPrompt } from './review-framework.js';
import type { SubsessionClient } from './subsession-client.js';

export interface ScheduleJournalInput {
  taskId: string;
  taskSummary: string;
  taskStartAt: string;
  flow: string;
  /** Main session ID (also the parent of the journaler sub-session) */
  sessionId: string;
  fromStep: string;
  toStep: string;
  toStepName: string;
  /** Step transition timestamp (ISO 8601) */
  transitionAt: string;
}

export interface JournalManagerOptions {
  messageWindow?: number;
  /** Journal directory relative to the project root */
  journalDir?: string;
}

export const DEFAULT_JOURNAL_DIR = '.vibe-pm/journal';
export const DEFAULT_JOURNAL_MESSAGE_WINDOW = 20;

export class JournalManager {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private client: SubsessionClient,
    private projectDir: string,
    private memory: MemorySystem,
    private options: JournalManagerOptions = {},
  ) {}

  scheduleEntry(input: ScheduleJournalInput): void {
    this.queue = this.queue
      .then(() => this.runEntry(input))
      .catch((err: unknown) => {
        logger.warn(`JournalManager: queued entry failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  /** Await all queued entries (used by tests and shutdown sequences) */
  drain(): Promise<void> {
    return this.queue;
  }

  private async runEntry(input: ScheduleJournalInput): Promise<void> {
    try {
      const excerpt = await this.client.fetchRecentMessages(
        input.sessionId,
        this.options.messageWindow ?? DEFAULT_JOURNAL_MESSAGE_WINDOW,
      );

      const subSessionId = await this.client.createSession(
        input.sessionId,
        `vibe-pm-journal:${input.taskId}`,
      );

      const prompt = buildJournalPrompt({
        taskSummary: input.taskSummary,
        flow: input.flow,
        fromStep: input.fromStep,
        toStep: input.toStep,
        toStepName: input.toStepName,
        conversationExcerpt: excerpt,
      });

      const briefing = await this.client.prompt(subSessionId, prompt);

      const filePath = this.appendJournalFile(input, briefing);
      await this.memory.recordJournalEntry({
        taskId: input.taskId,
        fromStep: input.fromStep,
        toStep: input.toStep,
        at: input.transitionAt,
        filePath,
      });
      logger.info(
        `JournalManager: journal appended for ${input.taskId} (${input.fromStep || '(start)'} → ${input.toStep})`,
      );
    } catch (err) {
      logger.warn(
        `JournalManager: runEntry failed silently: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private appendJournalFile(input: ScheduleJournalInput, briefing: string): string {
    const dir = path.join(this.projectDir, this.options.journalDir ?? DEFAULT_JOURNAL_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${input.taskId}.md`);

    let content = '';
    if (!fs.existsSync(filePath)) {
      content += [
        '# Task Journal',
        '',
        `- **Task ID**: ${input.taskId}`,
        `- **Flow**: ${input.flow}`,
        `- **Summary**: ${input.taskSummary}`,
        `- **Started At**: ${input.taskStartAt}`,
        '',
      ].join('\n');
    }

    content += [
      '',
      '---',
      '',
      `## ${new Date().toISOString()} — ${input.fromStep || '(start)'} → ${input.toStep} (${input.toStepName})`,
      '',
      briefing.trim(),
      '',
    ].join('\n');

    fs.appendFileSync(filePath, content, 'utf-8');
    return filePath;
  }
}
