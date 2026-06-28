/**
 * TUI extension module exports
 *
 * Exports TuiPluginModule for OpenCode TUI loading.
 * OpenCode only reads the default export, not named exports.
 * createTuiPlugin() is invoked immediately to produce a ready-to-use TuiPlugin function.
 */

import type { TuiPluginModule } from '@opencode-ai/plugin/tui';
import { createTuiPlugin } from './tui-plugin.jsx';

console.error('[vibe-pm TUI] module loaded');

const plugin: TuiPluginModule & { id: string } = {
  id: 'vibe-pm',
  tui: createTuiPlugin(),
};

export default plugin;

export type * from './types.js';
