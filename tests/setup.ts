import { vi } from "vitest";

vi.mock("@opentui/core", () => {
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

vi.mock("@opentui/solid", () => ({
  useKeyboard: () => {},
  render: () => {},
  extend: () => {},
}));
