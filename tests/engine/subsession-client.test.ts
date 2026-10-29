/**
 * Sub-session Client Tests
 *
 * Contract coverage for the V2 session gateway adapter — the layer the review and
 * journal agents actually run through. Regression guard: a child session created
 * without the parent's agent/model drains with an empty agent, never answers, and
 * every review then fails to parse.
 */

import { describe, it, expect } from 'bun:test';
import { createSubsessionClient, SUB_SESSION_DENY_PERMISSIONS } from '../../src/engine/subsession-client.js';
import type { SubsessionGateway, SubSessionAgentSelection } from '../../src/engine/subsession-client.js';
import type { SessionMessageInfo } from '../../src/core/types.js';

type CreateInput = Parameters<SubsessionGateway['create']>[0];

const PARENT: SubSessionAgentSelection = {
  agent: 'orchestrator',
  model: { id: 'deepseek-v4-pro', providerID: 'deepseek', variant: 'max' },
};

/** Minimal assistant entry: only `type` and `content` are read by the adapter. */
function assistant(...texts: string[]): SessionMessageInfo {
  return {
    type: 'assistant',
    content: texts.map((text) => ({ type: 'text', text })),
  } as unknown as SessionMessageInfo;
}

/** Assistant step that only made tool calls — carries no text part. */
function toolOnlyStep(): SessionMessageInfo {
  return { type: 'assistant', content: [{ type: 'tool' }] } as unknown as SessionMessageInfo;
}

function fakeGateway(options: {
  parent?: SubSessionAgentSelection;
  getThrows?: Error;
  messages?: readonly SessionMessageInfo[];
}) {
  const creates: CreateInput[] = [];
  const gateway: SubsessionGateway = {
    async create(input) {
      creates.push(input);
      return { id: 'ses_child' };
    },
    async prompt() {
      return {};
    },
    async wait() {},
    async context() {
      return options.messages ?? [];
    },
    async get() {
      if (options.getThrows) throw options.getThrows;
      return { id: 'ses_parent', ...(options.parent ?? {}) };
    },
  };
  return { gateway, creates };
}

describe('createSubsessionClient.createSession', () => {
  it("inherits the parent session's agent and model", async () => {
    const { gateway, creates } = fakeGateway({ parent: PARENT });
    const client = createSubsessionClient(gateway);

    await client.createSession('ses_parent', 'review');

    expect(creates).toHaveLength(1);
    expect(creates[0].parentID).toBe('ses_parent');
    expect(creates[0].agent).toBe('orchestrator');
    expect(creates[0].model).toEqual(PARENT.model);
  });

  it('still denies the child session its write / subagent / websearch permissions', async () => {
    const { gateway, creates } = fakeGateway({ parent: PARENT });

    await createSubsessionClient(gateway).createSession('ses_parent', 'review');

    expect(creates[0].permissions).toEqual(SUB_SESSION_DENY_PERMISSIONS);
  });

  it('omits agent and model when the parent session runs without them', async () => {
    const { gateway, creates } = fakeGateway({ parent: {} });

    await createSubsessionClient(gateway).createSession('ses_parent', 'review');

    expect('agent' in creates[0]).toBe(false);
    expect('model' in creates[0]).toBe(false);
  });

  it('still creates the child when the parent lookup fails', async () => {
    const { gateway, creates } = fakeGateway({ getThrows: new Error('host down') });

    const id = await createSubsessionClient(gateway).createSession('ses_parent', 'review');

    expect(id).toBe('ses_child');
    expect('agent' in creates[0]).toBe(false);
  });
});

describe('createSubsessionClient.prompt', () => {
  it('returns the reply of the last assistant step', async () => {
    const { gateway } = fakeGateway({ messages: [assistant('first'), assistant('second')] });

    const output = await createSubsessionClient(gateway).prompt('ses_child', 'review me');

    expect(output).toBe('second');
  });

  it('skips a trailing step that carries no text', async () => {
    const { gateway } = fakeGateway({ messages: [assistant('the verdict'), toolOnlyStep()] });

    const output = await createSubsessionClient(gateway).prompt('ses_child', 'review me');

    expect(output).toBe('the verdict');
  });

  it('returns an empty string when the sub-session never answered', async () => {
    const { gateway } = fakeGateway({ messages: [toolOnlyStep()] });

    const output = await createSubsessionClient(gateway).prompt('ses_child', 'review me');

    expect(output).toBe('');
  });
});