/**
 * TuiPlugin entry point
 *
 * - createSignal + setInterval + onCleanup all inside the slot callback
 * - session_id obtained from props
 * - TUI always creates an independent MemorySystem instance (not shared across processes)
 */

import { createSignal, onCleanup } from 'solid-js';
import type { TuiPlugin, TuiPluginApi } from '@opencode-ai/plugin/tui';
import { MemorySystem } from '../memory';
import type { TaskStatusData, TokenData } from './types.js';
import { loadTaskStatus } from './data/task-status.js';
import { loadTokenData } from './data/token-data.js';
import { SidebarContent } from './slots/sidebar-content.jsx';

const POLL_INTERVAL_MS = 1000;

export function createTuiPlugin(): TuiPlugin {
  return async (api: TuiPluginApi): Promise<void> => {
    try {
      const projectDir = api.state.path.directory ?? '.';
      const dd = `${projectDir}/.vibe-pm`;
      const ms = new MemorySystem();
      await ms.init(dd);
      console.error(`[vibe-pm] TUI created MemorySystem, dataDir=${dd}`);

      console.error('[vibe-pm] TUI ready');

      api.slots.register({
        order: 150,
        slots: {
          sidebar_content(_ctx, props) {
            const sessionId = (props as { session_id?: string })?.session_id;
            if (!sessionId) {
              console.error('[vibe-pm] no session_id in props');
              return undefined;
            }

            const [taskStatus, setTaskStatus] = createSignal<TaskStatusData>(
              { type: 'empty' },
              { equals: false },
            );
            const [tokenData, setTokenData] = createSignal<TokenData>(
              {
                totalTokens: 0,
                sourceBreakdown: [],
                stepBreakdown: [],
                cachedTokens: 0,
                uncachedTokens: 0,
              },
              { equals: false },
            );

            async function refresh() {
              try {
                const [status, tokens] = await Promise.all([
                  loadTaskStatus(ms, sessionId!),
                  loadTokenData(ms, sessionId!),
                ]);
                setTaskStatus(status);
                setTokenData(tokens);
              } catch (err) {
                console.error('[vibe-pm] refresh error:', err);
              }
            }

            refresh();

            const timer = setInterval(refresh, POLL_INTERVAL_MS);
            onCleanup(() => clearInterval(timer));

            return SidebarContent({
              api,
              taskStatus: () => taskStatus(),
              tokenData: () => tokenData(),
            });
          },
        },
      });
    } catch (err) {
      console.error('[vibe-pm] init error:', err);
    }
  };
}
