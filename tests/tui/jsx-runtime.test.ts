/**
 * Dependency contract — `@opentui/solid` JSX runtime entry
 *
 * `tsconfig.json` sets `jsxImportSource: "@opentui/solid"`, so Bun's automatic
 * JSX runtime resolves `@opentui/solid/jsx-runtime` (and its dev variant) at
 * runtime. The published package must ship those JavaScript files: when only
 * the `.d.ts` exists, resolution falls back to the type declaration and Bun
 * fails with `SyntaxError: Export named 'jsxDEV' not found`.
 */

import { describe, it, expect } from 'bun:test';

const RUNTIME_ENTRIES = ['@opentui/solid/jsx-runtime', '@opentui/solid/jsx-dev-runtime'];

describe('@opentui/solid JSX runtime', () => {
  for (const entry of RUNTIME_ENTRIES) {
    it(`${entry} resolves to a JavaScript module`, () => {
      const resolved = Bun.resolveSync(entry, process.cwd());
      expect(resolved.endsWith('.d.ts')).toBe(false);
      expect(/\.(js|mjs|cjs)$/.test(resolved)).toBe(true);
    });
  }

  it('exports the symbols the automatic JSX runtime imports', async () => {
    const runtime = await import('@opentui/solid/jsx-runtime');
    expect(typeof runtime.jsx).toBe('function');
    expect(typeof runtime.jsxs).toBe('function');
    expect(typeof runtime.jsxDEV).toBe('function');
    expect(typeof runtime.Fragment).toBe('function');
  });
});
