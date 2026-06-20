/**
 * TuiPlugin 入口
 *
 * 参考 opencode-goal-mode Pattern B：
 * - createSignal + setInterval + onCleanup 全在 slot 回调内
 * - session_id 从 props 获取
 * - 数据通过 tui-bridge 文件读取（绕过 AxioDB 跨进程缓存）
 */

import * as path from "node:path";
import { createSignal, onCleanup } from "solid-js";
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { MemorySystem } from "../memory/memory-system.js";
import type { IMemorySystem } from "../memory/types.js";
import type { TaskStatusData, TokenData } from "./types.js";
import { readTuiData, initTuiBridge } from "../shared/tui-bridge.js";
import { SidebarContent } from "./slots/sidebar-content.jsx";

const POLL_INTERVAL_MS = 1000;

export function createTuiPlugin(memory?: IMemorySystem): TuiPlugin {
  return async (api: TuiPluginApi): Promise<void> => {
    try {
      const projectDir = api.state.path.directory ?? ".";
      const dataDir = path.resolve(projectDir, ".vibe-pm");

      // 尝试使用注入的或全局的 MemorySystem，否则回退到独立实例
      const sharedMemory: IMemorySystem =
        memory ??
        (globalThis as Record<string, unknown>).__vibePmMemory as IMemorySystem | undefined ??
        await (async () => {
          const ms = new MemorySystem();
          await ms.init(dataDir);
          return ms;
        })();

      // 初始化桥接目录（用于文件读取）
      initTuiBridge(dataDir);

      console.error("[vibe-pm] TUI ready, dataDir=" + dataDir);

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

            function refresh() {
              // 优先读桥接文件（跨进程数据最新），回退到 AxioDB
              const bridge = readTuiData();
              if (bridge) {
                setTaskStatus(bridge.taskStatus);
                setTokenData(bridge.tokenData);
                return;
              }
              // 回退：从 MemorySystem 读取（可能缓存延迟）
              const sid = sessionId;
              if (sid) {
                void sharedMemory.getActiveTask(sid).then((active) => {
                  if (active) {
                    setTaskStatus({
                      type: "active", flow: active.flow,
                      currentStep: active.currentStep, currentStepName: active.currentStepName,
                      startAt: active.startAt, specRef: active.specRef, planRef: active.planRef,
                    });
                  }
                });
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
