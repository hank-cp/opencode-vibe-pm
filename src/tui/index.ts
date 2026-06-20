/**
 * TUI 扩展模块导出
 *
 * 导出 TuiPluginModule 供 OpenCode TUI 加载。
 * OpenCode 只读取 default export，不使用命名导出。
 * createTuiPlugin() 被立即调用以生成 ready-to-use 的 TuiPlugin 函数。
 */

import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createTuiPlugin } from "./tui-plugin.jsx";

console.error("[vibe-pm TUI] 模块已加载");

const plugin: TuiPluginModule & { id: string } = {
  id: "vibe-pm",
  tui: createTuiPlugin(),
};

export default plugin;

export type * from "./types.js";
