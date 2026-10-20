/**
 * TUI Plugin Unit Tests (OpenCode V2)
 *
 * V2 TUI plugins are `Plugin.define({ id, setup })`; there is no factory function and no
 * `api.slots.register`. `setup(ctx)` claims one slot through `ctx.ui.slot({ append, render })`.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Plugin } from '@opencode/plugin/tui';

/** The slice of a V2 slot claim this plugin uses. */
interface CapturedClaim {
  readonly append?: string;
  readonly prepend?: string;
  readonly render: (input: { sessionID: string }) => unknown;
}

interface TuiHarness {
  ctx: Plugin.Context;
  claims: CapturedClaim[];
}

function makeTuiCtx(directory: string): TuiHarness {
  const claims: CapturedClaim[] = [];

  const color = { r: 0, g: 0, b: 0, a: 255 };
  const textStyle = { base: color, muted: color, feedback: { warning: { base: color }, success: { base: color } } };

  const ctx = {
    location: { directory },
    theme: {
      hue: { interactive: { 200: color } },
      text: textStyle,
    },
    ui: {
      slot: (claim: CapturedClaim) => {
        claims.push(claim);
        return () => {
          const index = claims.indexOf(claim);
          if (index >= 0) claims.splice(index, 1);
        };
      },
    },
  } as unknown as Plugin.Context;

  return { ctx, claims };
}

describe('TUI plugin setup', () => {
  it('claims the sidebar.content slot exactly once with a render function', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-tui-'));
    try {
      const { setup } = await import('../../src/tui/tui-plugin.jsx');
      const { ctx, claims } = makeTuiCtx(tmpDir);

      const cleanup = await setup(ctx);

      expect(claims).toHaveLength(1);
      expect(claims[0]!.append).toBe('sidebar.content');
      expect(claims[0]!.prepend).toBeUndefined();
      expect(typeof claims[0]!.render).toBe('function');
      expect(typeof cleanup).toBe('function');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns an inert cleanup and claims nothing when the data directory cannot be opened', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-tui-bad-'));
    try {
      // A regular file where `<project>/.vibe-pm` must be a directory makes MemorySystem.init fail.
      fs.writeFileSync(path.join(tmpDir, '.vibe-pm'), '');

      const { setup } = await import('../../src/tui/tui-plugin.jsx');
      const { ctx, claims } = makeTuiCtx(tmpDir);

      const cleanup = await setup(ctx);

      expect(typeof cleanup).toBe('function');
      cleanup();
      expect(claims).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('TUI types', () => {
  it('SOURCE_COLORS has all 4 token sources', async () => {
    const { SOURCE_COLORS } = await import('../../src/tui/types.js');
    const keys = Object.keys(SOURCE_COLORS);
    expect(keys).toContain('FlowControl');
    expect(keys).toContain('Text');
    expect(keys).toContain('Tool');
    expect(keys).toContain('Reasoning');
    expect(keys).toContain('SubAgent');
    expect(keys.length).toBe(5);
  });
});
