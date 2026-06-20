/**
 * TuiPlugin 入口
 *
 * 参考 opencode-goal-mode Pattern B：
 * - createSignal + setInterval + onCleanup 全在 slot 回调内
 * - session_id 从 props 获取
 * - 数据优先通过 tui-bridge 文件读取（绕过跨进程 DB 访问问题）
 * - Bun 兼容：不直接引入 better-sqlite3，通过注入的 IMemorySystem 接口工作
 */

import { createSignal, onCleanup } from "solid-js";
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { IMemorySystem } from "../memory/types.js";
import type { TaskStatusData, TokenData } from "./types.js";
import { readTuiData, initTuiBridge } from "../shared/tui-bridge.js";
import { SidebarContent } from "./slots/sidebar-content.jsx";

const POLL_INTERVAL_MS = 1000;

export function createTuiPlugin(memory?: IMemorySystem): TuiPlugin {
  return async (api: TuiPluginApi): Promise<void> => {
    try {
      const projectDir = api.state.path.directory ?? ".";

      // 使用注入的 MemorySystem（主进程通过 __vibePmMemory 注入），
      // 或全局作用域中已有的实例。不在此处创建独立实例——
      // Bun 环境不支持 better-sqlite3 native addon，创建会失败。
      const sharedMemory: IMemorySystem | undefined =
        memory ??
        (globalThis as Record<string, unknown>).__vibePmMemory as IMemorySystem | undefined;

      // 初始化桥接目录（用于跨进程文件读取，主路径）
      const dataDir = (sharedMemory as unknown as { dataDir?: string })?.dataDir
        ?? `${projectDir}/.vibe-pm`;
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
              // 优先读桥接文件（跨进程数据最新，Bun/Node 通用）
              const bridge = readTuiData();
              if (bridge) {
                setTaskStatus(bridge.taskStatus);
                setTokenData(bridge.tokenData);
                return;
              }
              // 回退：从 MemorySystem 直接读取（仅当注入实例可用时）
              const sid = sessionId;
              if (sid && sharedMemory) {
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
