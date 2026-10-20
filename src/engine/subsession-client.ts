/**
 * Sub-session Client Adapter
 *
 * Narrows the OpenCode V2 session domain to the three primitives the Review Agent
 * Manager and Journal Manager need (create / prompt / fetch messages), so managers
 * depend on a small interface instead of the whole client (Constitution II:
 * interfaces are defined at the consumer side).
 *
 * V2 has no `tools` field on `SessionPromptInput`, so the V1 tool whitelist cannot
 * be reproduced 1:1. Instead, child sessions are created with an explicit permission
 * deny-list (`SUB_SESSION_DENY_PERMISSIONS`). This is a documented, accepted gap:
 * the semantics change from whitelist to blacklist.
 */

import type { SessionMessageInfo } from '../core/types.js';

/** Permission action/resource pair handed to `session.create` */
export type SubSessionPermissionEffect = 'allow' | 'deny' | 'ask';

export interface SubSessionPermission {
  action: string;
  resource: string;
  effect: SubSessionPermissionEffect;
}

/**
 * Permissions denied on every vibe-pm child session.
 *
 * V2 renamed permission actions: `bash` → `shell`, `task` → `subagent`,
 * `write` / `patch` → `edit`. Child sessions stay read-only w.r.t. the workspace
 * and may not spawn further sub-agents or search the web.
 */
export const SUB_SESSION_DENY_PERMISSIONS: readonly SubSessionPermission[] = [
  { action: 'edit', resource: '*', effect: 'deny' },
  { action: 'subagent', resource: '*', effect: 'deny' },
  { action: 'websearch', resource: '*', effect: 'deny' },
];

/** Narrow slice of the V2 session domain consumed by `createSubsessionClient` */
export interface SubsessionGateway {
  create(input: {
    parentID?: string;
    title?: string;
    permissions?: readonly SubSessionPermission[];
  }): Promise<{ id: string }>;
  prompt(input: { sessionID: string; text: string }): Promise<unknown>;
  wait(input: { sessionID: string }): Promise<void>;
  context(input: { sessionID: string }): Promise<readonly SessionMessageInfo[]>;
  get(input: { sessionID: string }): Promise<{ id: string; parentID?: string }>;
}

export interface SubsessionClient {
  /** Create a child session of `parentId`, returning the new session ID */
  createSession(parentId: string, title: string): Promise<string>;
  /** Send a text prompt and synchronously wait for the assistant reply text */
  prompt(sessionId: string, text: string): Promise<string>;
  /** Fetch the most recent messages as a role-labeled text excerpt (truncated) */
  fetchRecentMessages(sessionId: string, limit: number): Promise<string>;
}

type AssistantMessageInfo = Extract<SessionMessageInfo, { type: 'assistant' }>;

function extractAssistantText(message: AssistantMessageInfo): string {
  const pieces: string[] = [];
  for (const part of message.content) {
    if (part.type === 'text') pieces.push(part.text);
  }
  return pieces.join('\n').trim();
}

/**
 * Extract the conversational text of a transcript entry.
 *
 * Only `user` and `assistant` entries carry conversation: V2 `user` messages expose
 * a flat `text`, `assistant` messages expose content parts. Other V2 message kinds
 * (synthetic/system/shell/…) are not part of the V1 excerpt semantics.
 */
function extractRoleText(message: SessionMessageInfo): { role: string; text: string } | null {
  if (message.type === 'user') {
    const text = message.text.trim();
    return text ? { role: 'user', text } : null;
  }
  if (message.type === 'assistant') {
    const text = extractAssistantText(message);
    return text ? { role: 'assistant', text } : null;
  }
  return null;
}

export function createSubsessionClient(
  session: SubsessionGateway,
  maxExcerptChars = 20000,
): SubsessionClient {
  return {
    async createSession(parentId: string, title: string): Promise<string> {
      const created = await session.create({
        parentID: parentId,
        title,
        permissions: SUB_SESSION_DENY_PERMISSIONS,
      });
      return created.id;
    },

    async prompt(sessionId: string, text: string): Promise<string> {
      await session.prompt({ sessionID: sessionId, text });
      await session.wait({ sessionID: sessionId });

      const messages = await session.context({ sessionID: sessionId });
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.type === 'assistant') {
          return extractAssistantText(message);
        }
      }
      return '';
    },

    async fetchRecentMessages(sessionId: string, limit: number): Promise<string> {
      const messages = await session.context({ sessionID: sessionId });
      const tail = limit > 0 ? messages.slice(-limit) : [];

      const lines: string[] = [];
      for (const message of tail) {
        const entry = extractRoleText(message);
        if (!entry) continue;
        lines.push(`--- ${entry.role} ---`, entry.text);
      }

      let excerpt = lines.join('\n');
      if (excerpt.length > maxExcerptChars) {
        excerpt = `${excerpt.slice(0, maxExcerptChars)}\n...(excerpt truncated)`;
      }
      return excerpt;
    },
  };
}
