/**
 * TuiPlugin 入口
 *
 * - createSignal + setInterval + onCleanup 全在 slot 回调内
 * - session_id 从 props 获取
 * - TUI 始终创建独立的 MemorySystem 实例（不跨进程共享）
 */

import { createSignal, onCleanup } from "solid-js";
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { MemorySystem } from "../memory/memory-system.js";
import type { TaskStatusData, TokenData } from "./types.js";
import { loadTaskStatus } from "./data/task-status.js";
import { loadTokenData } from "./data/token-data.js";
import { SidebarContent } from "./slots/sidebar-content.jsx";

const POLL_INTERVAL_MS = 1000;

export function createTuiPlugin(): TuiPlugin {
  return async (api: TuiPluginApi): Promise<void> => {
    try {
      const projectDir = api.state.path.directory ?? ".";
      const dd = `${projectDir}/.vibe-pm`;
      const ms = new MemorySystem();
      await ms.init(dd);
      console.error(`[vibe-pm] TUI created MemorySystem, dataDir=${dd}`);

      console.error("[vibe-pm] TUI ready");

      api.slots.register({
        order: 150,
        slots: {
          sidebar_content(_ctx, props) {
            const sessionId = (props as { session_id?: string })?.session_id;
            if (!sessionId) {
              console.error("[vibe-pm] no session_id in props");
              return undefined;
            }

            const [taskStatus, setTaskStatus] = createSignal<TaskStatusData>(
              { type: "empty" },
              { equals: false },
            );
            const [tokenData, setTokenData] = createSignal<TokenData>(
              { totalTokens: 0, sourceBreakdown: [], stepBreakdown: [], cachedTokens: 0, uncachedTokens: 0 },
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
                console.error("[vibe-pm] refresh error:", err);
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
      console.error("[vibe-pm] init error:", err);
    }
  };
}
