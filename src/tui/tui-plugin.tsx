/**
 * TuiPlugin 入口
 *
 * 参考 opencode-goal-mode Pattern B：
 * - createSignal + setInterval + onCleanup 全在 slot 回调内
 * - session_id 从 props 获取
 * - 数据通过 IMemorySystem 直连 bun:sqlite 获取（WAL 模式支持并发读）
 * - 若未外部注入 MemorySystem，则自行创建实例连接 .vibe-pm/vibe-pm.db
 */

import { createSignal, onCleanup } from "solid-js";
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { IMemorySystem } from "../memory/types.js";
import { MemorySystem } from "../memory/memory-system.js";
import type { TaskStatusData, TokenData } from "./types.js";
import { loadTaskStatus } from "./data/task-status.js";
import { loadTokenData } from "./data/token-data.js";
import { SidebarContent } from "./slots/sidebar-content.jsx";

const POLL_INTERVAL_MS = 1000;

export function createTuiPlugin(memory?: IMemorySystem): TuiPlugin {
  return async (api: TuiPluginApi): Promise<void> => {
    try {
      const projectDir = api.state.path.directory ?? ".";

      const sharedMemory: IMemorySystem =
        memory ??
        (globalThis as Record<string, unknown>).__vibePmMemory as IMemorySystem ??
        await (async () => {
          const ms = new MemorySystem();
          const dd = `${projectDir}/.vibe-pm`;
          await ms.init(dd);
          console.error(`[vibe-pm] TUI created MemorySystem, dataDir=${dd}`);
          return ms;
        })();

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
              { totalTokens: 0, sourceBreakdown: [], stepBreakdown: [] },
              { equals: false },
            );

            async function refresh() {
              try {
                const [status, tokens] = await Promise.all([
                  loadTaskStatus(sharedMemory, sessionId!),
                  loadTokenData(sharedMemory, sessionId!),
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
