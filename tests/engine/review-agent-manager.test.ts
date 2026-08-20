/**
 * Review Agent Manager Tests
 *
 * Lifecycle coverage with a mock SubsessionClient: successful pass/fail
 * reviews, degraded startup, timeout, and unparseable output.
 */

import { describe, it, expect } from 'bun:test';
import { ReviewAgentManager } from '../../src/engine/review-agent-manager.js';
import type { SubsessionClient } from '../../src/engine/subsession-client.js';

const INPUT = {
  parentSessionId: 'ses_main',
  taskId: 'task_1',
  taskSummary: 'Implement JWT auth',
  flow: 'spec-driven-dev',
  stepId: 'S5',
  stepName: 'Write Code & Tests',
  acceptanceStandard: 'Tests pass',
  conversationExcerpt: '--- assistant ---\ndone',
};

const PASS_OUTPUT =
  '```json\n{"conclusion":"pass","feedback":"looks good","nextInput":"proceed"}\n```';
const FAIL_OUTPUT =
  '```json\n{"conclusion":"fail","failReason":"Design problem","feedback":"redo design","nextInput":"rollback"}\n```';

function mockClient(behavior: {
  createThrows?: Error;
  promptThrows?: Error;
  promptDelayMs?: number;
  output?: string;
}): { client: SubsessionClient; calls: { created: string[]; prompts: string[] } } {
  const calls = { created: [] as string[], prompts: [] as string[] };
  const client: SubsessionClient = {
    async createSession(parentId: string, title: string) {
      calls.created.push(`${parentId}:${title}`);
      if (behavior.createThrows) throw behavior.createThrows;
      return 'ses_review_sub';
    },
    async prompt(sessionId: string, _text: string, _tools: Record<string, boolean>) {
      calls.prompts.push(sessionId);
      if (behavior.promptThrows) throw behavior.promptThrows;
      if (behavior.promptDelayMs) {
        await new Promise((r) => setTimeout(r, behavior.promptDelayMs));
      }
      return behavior.output ?? PASS_OUTPUT;
    },
    async fetchRecentMessages() {
      return '';
    },
  };
  return { client, calls };
}

describe('ReviewAgentManager', () => {
  it('returns pass with structured verdict on valid output', async () => {
    const { client, calls } = mockClient({ output: PASS_OUTPUT });
    const manager = new ReviewAgentManager(client);
    const result = await manager.startReview(INPUT);

    expect(result.conclusion).toBe('pass');
    expect(result.feedback).toBe('looks good');
    expect(result.nextInput).toBe('proceed');
    expect(calls.created).toEqual(['ses_main:vibe-pm-review:task_1:S5']);
    expect(calls.prompts).toEqual(['ses_review_sub']);
  });

  it('returns fail with reason on valid fail output', async () => {
    const { client } = mockClient({ output: FAIL_OUTPUT });
    const manager = new ReviewAgentManager(client);
    const result = await manager.startReview(INPUT);

    expect(result.conclusion).toBe('fail');
    expect(result.failReason).toBe('Design problem');
    expect(result.feedback).toBe('redo design');
  });

  it('degrades gracefully when session creation fails', async () => {
    const { client } = mockClient({ createThrows: new Error('host down') });
    const manager = new ReviewAgentManager(client);
    const result = await manager.startReview(INPUT);

    expect(result.conclusion).toBe('degraded');
    expect(result.feedback).toContain('host down');
  });

  it('degrades gracefully when prompting fails', async () => {
    const { client } = mockClient({ promptThrows: new Error('prompt rejected') });
    const manager = new ReviewAgentManager(client);
    const result = await manager.startReview(INPUT);

    expect(result.conclusion).toBe('degraded');
    expect(result.feedback).toContain('prompt rejected');
  });

  it('times out when the review exceeds the timeout', async () => {
    const { client } = mockClient({ promptDelayMs: 100, output: PASS_OUTPUT });
    const manager = new ReviewAgentManager(client, { timeoutMs: 20 });
    const result = await manager.startReview(INPUT);

    expect(result.conclusion).toBe('timeout');
  });

  it('applies the conservative fallback on unparseable output', async () => {
    const { client } = mockClient({ output: 'no json here' });
    const manager = new ReviewAgentManager(client);
    const result = await manager.startReview(INPUT);

    expect(result.conclusion).toBe('fail');
    expect(result.failReason).toBe('Execution problem');
    expect(result.feedback).toContain('no json here');
  });

  it('passes the custom framework through to the prompt', async () => {
    let promptText = '';
    const capturingClient: SubsessionClient = {
      async createSession() {
        return 'ses_review_sub';
      },
      async prompt(_sessionId: string, text: string, _tools: Record<string, boolean>) {
        promptText = text;
        return PASS_OUTPUT;
      },
      async fetchRecentMessages() {
        return '';
      },
    };
    await new ReviewAgentManager(capturingClient, { framework: 'Custom: {stepId}' }).startReview(
      INPUT,
    );
    expect(promptText).toBe('Custom: S5');
  });
});
