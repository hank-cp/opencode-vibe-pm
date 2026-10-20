/**
 * TUI extension module entry
 *
 * OpenCode V2 TUI plugin shape: `Plugin.define({ id, setup })`.
 * OpenCode only reads the default export, not named exports.
 */

import { Plugin } from '@opencode/plugin/tui';
import { setup } from './tui-plugin.jsx';

export default Plugin.define({ id: 'vibe-pm', setup });

export type * from './types.js';
