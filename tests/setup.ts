import { mock } from 'bun:test';

mock.module('@opentui/core', () => {
  const mockRGBA = {
    fromInts: (r: number, g: number, b: number) => ({
      r,
      g,
      b,
      a: 255,
      buffer: new Uint16Array([r, g, b, 255]),
      toInts: () => [r, g, b, 255],
      equals: () => false,
    }),
    fromArray: (arr: Uint16Array) => ({ buffer: arr }),
    fromValues: (r: number, g: number, b: number, a = 255) => ({
      r,
      g,
      b,
      a,
    }),
  };

  return { RGBA: mockRGBA };
});

mock.module('@opentui/solid', () => ({
  useKeyboard: () => {},
  render: () => {},
  extend: () => {},
  // `@opentui/solid/jsx-runtime` imports these reconciler primitives from the
  // package root at link time — the mock must expose them or the import fails.
  createComponent: (component: unknown, props: unknown) => ({ component, props }),
  createElement: (type: unknown) => ({ type }),
  spread: () => {},
}));
