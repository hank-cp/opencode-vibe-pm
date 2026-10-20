/**
 * TUI plugin entry point (OpenCode V2 TUI plugin API)
 *
 * - setup() opens an independent MemorySystem per TUI process (never shared across processes)
 * - the sidebar slot renders a component that owns its signals and 1s polling timer,
 *   disposed by `onCleanup` when the slot is torn down
 */

import { createSignal, onCleanup } from 'solid-js';
import type { Plugin } from '@opencode/plugin/tui';
import { MemorySystem } from '../memory';
import type { TaskStatusData, TokenData } from './types.js';
import { loadTaskStatus } from './data/task-status.js';
import { loadTokenData } from './data/token-data.js';
import { SidebarContent, type SidebarTheme } from './slots/sidebar-content.jsx';

const POLL_INTERVAL_MS = 1000;

const EMPTY_TOKEN_DATA: TokenData = {
  totalTokens: 0,
  sourceBreakdown: [],
  stepBreakdown: [],
  cachedTokens: 0,
  uncachedTokens: 0,
};

/**
 * Map the V2 resolved theme onto the flat colors the sidebar paints with.
 *
 * Paths follow the SDK's own V1 → V2 theme migration (`@opencode/theme/tui` v1-migrate):
 * V1 `primary` → interactive hue step 200, `text` → `text.base`, `textMuted` → `text.muted`,
 * `warning` / `success` → `text.feedback.<kind>.base`.
 */
function resolveSidebarTheme(theme: Plugin.Context['theme']): SidebarTheme {
  return {
    primary: theme.hue.interactive[200],
    text: theme.text.base,
    textMuted: theme.text.muted,
    warning: theme.text.feedback.warning.base,
    success: theme.text.feedback.success.base,
  };
}

interface SidebarSlotProps {
  readonly sessionID: string;
  readonly memory: MemorySystem;
  readonly theme: SidebarTheme;
}

function SidebarSlot(props: SidebarSlotProps) {
  const [taskStatus, setTaskStatus] = createSignal<TaskStatusData>(
    { type: 'empty' },
    { equals: false },
  );
  const [tokenData, setTokenData] = createSignal<TokenData>(EMPTY_TOKEN_DATA, { equals: false });

  async function refresh(): Promise<void> {
    try {
      const [status, tokens] = await Promise.all([
        loadTaskStatus(props.memory, props.sessionID),
        loadTokenData(props.memory, props.sessionID),
      ]);
      setTaskStatus(status);
      setTokenData(tokens);
    } catch (err) {
      console.error('[vibe-pm] sidebar refresh failed:', err);
    }
  }

  void refresh();

  const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  onCleanup(() => clearInterval(timer));

  return <SidebarContent theme={props.theme} taskStatus={taskStatus} tokenData={tokenData} />;
}

export async function setup(ctx: Plugin.Context): Promise<() => void> {
  const projectDir = ctx.location?.directory ?? process.cwd();
  const dataDir = `${projectDir}/.vibe-pm`;

  const memory = new MemorySystem();
  try {
    await memory.init(dataDir);
  } catch (err) {
    console.error(`[vibe-pm] TUI: cannot open memory at ${dataDir}:`, err);
    return () => {};
  }

  console.error(`[vibe-pm] TUI ready, dataDir=${dataDir}`);

  const theme = resolveSidebarTheme(ctx.theme);

  // The claim disposer is the plugin's cleanup: releasing it unclaims the slot.
  return ctx.ui.slot({
    append: 'sidebar.content',
    render: (input) => <SidebarSlot sessionID={input.sessionID} memory={memory} theme={theme} />,
  });
}
