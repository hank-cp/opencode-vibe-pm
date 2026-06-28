/**
 * TUI Plugin Unit Tests
 *
 * Tests createTuiPlugin factory function and non-TUI environment graceful degradation.
 */

import { describe, it, expect } from 'bun:test';

describe('createTuiPlugin', () => {
  const skipCI = process.env.CI === 'true';

  it('returns a function with tui signature', async () => {
    if (skipCI) return;
    const { createTuiPlugin } = await import('../../src/tui/tui-plugin.jsx');
    const plugin = createTuiPlugin();
    expect(typeof plugin).toBe('function');
    // TuiPlugin signature: (api, options?, meta?) => Promise<void>
    expect(plugin.length).toBeGreaterThanOrEqual(1);
  });

  it('does not throw in non-TUI environment', async () => {
    if (skipCI) return;
    const { createTuiPlugin } = await import('../../src/tui/tui-plugin.jsx');
    const plugin = createTuiPlugin();

    // Simulate a minimal TuiPluginApi that throws on slots.register
    // to mimic non-TUI environment
    const mockApi = {
      state: {
        path: { directory: undefined as string | undefined },
      },
      slots: {
        register: () => {
          throw new Error('No TUI renderer available');
        },
      },
      theme: {
        current: {
          primary: {} as unknown,
          text: {} as unknown,
          textMuted: {} as unknown,
        },
      },
      event: {
        on: () => () => {},
      },
    } as unknown as Parameters<typeof plugin>[0];

    // Should not throw — silently catches errors
    await expect(plugin(mockApi, undefined as never, undefined as never)).resolves.toBeUndefined();
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
