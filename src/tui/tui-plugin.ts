/**
 * TuiPlugin 入口
 *
 * 创建符合 @opencode-ai/plugin SDK 的 TuiPlugin 函数，
 * 通过闭包注入 IMemorySystem，注册 sidebar_content slot。
 */

import * as path from "node:path";
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { MemorySystem } from "../memory/memory-system.js";
import type { IMemorySystem } from "../memory/types.js";

/**
 * 创建 TUI 插件入口函数。
 *
 * 在 tui 函数内部独立创建 MemorySystem 实例（共享 AxioDB 数据文件），
 * 通过 api.state.path.directory 定位项目目录。
 *
 * 非 TUI 环境下静默跳过（try/catch 包裹整个注册流程）。
 */
export function createTuiPlugin(memory?: IMemorySystem): TuiPlugin {
  return async (api: TuiPluginApi): Promise<void> => {
    try {
      let resolved: IMemorySystem;

      if (memory) {
        // 外部注入（用于测试或 Server Plugin 同进程场景）
        resolved = memory;
      } else {
        // 独立创建 MemorySystem 实例
        const projectDir = api.state.path.directory ?? ".";
        const dataDir = path.resolve(projectDir, ".vibe-pm");
        resolved = new MemorySystem();
        await resolved.init(dataDir);
      }

      // 动态导入 sidebar-content.tsx 以避免 tsc 在无 --jsx 配置下解析 .tsx 文件
      const { createSidebarSlot } = await import(
        "./slots/sidebar-content.js"
      );
      api.slots.register(createSidebarSlot(api, resolved));
    } catch (err) {
      // 非 TUI 环境或初始化失败 — 静默跳过
      // OpenCode 正常运行不受影响
      void err;
    }
  };
}
