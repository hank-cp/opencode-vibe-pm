/**
 * Sub-session Client Adapter
 *
 * Narrows the OpenCode SDK to the three primitives the Review Agent Manager
 * and Journal Manager need (create / prompt / fetch messages), so managers
 * depend on a small interface instead of the whole SDK client (Constitution II:
 * interfaces are defined at the consumer side).
 */

import type { OpencodeClient, Part } from '@opencode-ai/sdk';

export interface SubsessionClient {
  /** Create a child session of `parentId`, returning the new session ID */
  createSession(parentId: string, title: string): Promise<string>;
  /** Send a text prompt and synchronously wait for the assistant reply text */
  prompt(sessionId: string, text: string, tools: Record<string, boolean>): Promise<string>;
  /** Fetch the most recent messages as a role-labeled text excerpt (truncated) */
  fetchRecentMessages(sessionId: string, limit: number): Promise<string>;
}

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

function requireData<T>(result: { data?: T }): T {
  if (result.data === undefined) {
    throw new Error('OpenCode SDK returned no data');
  }
  return result.data;
}

export function createSubsessionClient(
  client: OpencodeClient,
  maxExcerptChars = 20000,
): SubsessionClient {
  return {
    async createSession(parentId: string, title: string): Promise<string> {
      const response = await client.session.create({ body: { parentID: parentId, title } });
      return requireData(response).id;
    },

    async prompt(
      sessionId: string,
      text: string,
      tools: Record<string, boolean>,
    ): Promise<string> {
      const response = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text }],
          tools,
        },
      });
      return extractText(requireData(response).parts);
    },

    async fetchRecentMessages(sessionId: string, limit: number): Promise<string> {
      const response = await client.session.messages({
        path: { id: sessionId },
        query: { limit },
      });

      const lines: string[] = [];
      for (const message of requireData(response)) {
        const role = message.info.role;
        const text = extractText(message.parts);
        if (!text) continue;
        lines.push(`--- ${role} ---`, text);
      }

      let excerpt = lines.join('\n');
      if (excerpt.length > maxExcerptChars) {
        excerpt = `${excerpt.slice(0, maxExcerptChars)}\n...(excerpt truncated)`;
      }
      return excerpt;
    },
  };
}
