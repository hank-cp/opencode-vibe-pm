/**
 * TUI 扩展模块导出
 *
 * 导出 TuiPluginModule 供 OpenCode TUI 加载。
 * createTuiPlugin() 被立即调用以生成 ready-to-use 的 TuiPlugin 函数。
 */

import { createTuiPlugin } from "./tui-plugin.js";

export const tui = createTuiPlugin();

export type * from "./types.js";
