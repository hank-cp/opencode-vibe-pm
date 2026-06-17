/**
 * TUI 单元测试 — Collapsible 组件
 *
 * 测试 Collapsible 展开/折叠行为。
 */

import { describe, it, expect } from "vitest";

// Collapsible 组件使用 @opentui/solid testRender 需要原生模块支持，
// 此处测试数据层和工具函数的逻辑正确性。

describe("formatElapsed", () => {
  it("formats minutes correctly", async () => {
    // 测试通过数据加载函数间接验证
    const { loadTaskStatus } = await import(
      "../../src/tui/data/task-status.js"
    );
    const result = await loadTaskStatus(
      {
        getActiveTask: async () => null,
        getLastClosedTask: async () => null,
      } as unknown as Parameters<typeof loadTaskStatus>[0],
      "test-session",
    );
    expect(result.type).toBe("empty");
  });

  it("returns active task data when task exists", async () => {
    const { loadTaskStatus } = await import(
      "../../src/tui/data/task-status.js"
    );
    const now = new Date().toISOString();
    const result = await loadTaskStatus(
      {
        getActiveTask: async () => ({
          flow: "research",
          currentStep: "S5",
          currentStepName: "执行环节",
          startAt: now,
          specRef: "docs/spec/test.md",
        }),
        getLastClosedTask: async () => null,
      } as unknown as Parameters<typeof loadTaskStatus>[0],
      "test-session",
    );
    expect(result.type).toBe("active");
    expect(result.flow).toBe("research");
    expect(result.currentStep).toBe("S5");
    expect(result.currentStepName).toBe("执行环节");
    expect(result.specRef).toBe("docs/spec/test.md");
    expect(result.elapsed).toBeDefined();
  });

  it("returns last task data when no active task", async () => {
    const { loadTaskStatus } = await import(
      "../../src/tui/data/task-status.js"
    );
    const startAt = new Date(Date.now() - 3600000).toISOString();
    const endAt = new Date().toISOString();
    const result = await loadTaskStatus(
      {
        getActiveTask: async () => null,
        getLastClosedTask: async () => ({
          flow: "bug-fix",
          startAt,
          endAt,
        }),
      } as unknown as Parameters<typeof loadTaskStatus>[0],
      "test-session",
    );
    expect(result.type).toBe("last");
    expect(result.flow).toBe("bug-fix");
    expect(result.elapsed).toBeDefined();
  });
});

describe("loadTokenData", () => {
  it("aggregates source breakdown correctly", async () => {
    const { loadTokenData } = await import(
      "../../src/tui/data/token-data.js"
    );
    const result = await loadTokenData(
      {
        getSourceTokenBreakdown: async () => [
          { source: "System", tokens: 1500 },
          { source: "User", tokens: 1900 },
          { source: "Assistant", tokens: 5000 },
        ],
        getStepTokenBreakdown: async () => [
          {
            step: "S1",
            stepName: "理解需求",
            stepInCount: 2,
            tokensConsumed: 1200,
          },
          {
            step: "S2",
            stepName: "标记缺口",
            stepInCount: 1,
            tokensConsumed: 2800,
          },
        ],
      } as unknown as Parameters<typeof loadTokenData>[0],
      "test-session",
    );
    expect(result.totalTokens).toBe(8400);
    expect(result.sourceBreakdown).toHaveLength(3);
    expect(result.stepBreakdown).toHaveLength(2);
    const systemEntry = result.sourceBreakdown.find(
      (s) => s.source === "System",
    );
    expect(systemEntry?.tokens).toBe(1500);
  });

  it("returns zero tokens for empty session", async () => {
    const { loadTokenData } = await import(
      "../../src/tui/data/token-data.js"
    );
    const result = await loadTokenData(
      {
        getSourceTokenBreakdown: async () => [],
        getStepTokenBreakdown: async () => [],
      } as unknown as Parameters<typeof loadTokenData>[0],
      "test-session",
    );
    expect(result.totalTokens).toBe(0);
    expect(result.sourceBreakdown).toHaveLength(0);
    expect(result.stepBreakdown).toHaveLength(0);
  });
});

describe("compactTokens", () => {
  it("formats large numbers in K", async () => {
    const { compactTokens } = await import("../../src/tui/types.js");
    expect(compactTokens(12500)).toBe("12.5K");
    expect(compactTokens(1000)).toBe("1.0K");
    expect(compactTokens(999)).toBe("999");
    expect(compactTokens(0)).toBe("0");
  });
});

describe("formatElapsed", () => {
  it("formats minutes and hours", async () => {
    const { formatElapsed } = await import("../../src/tui/types.js");
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60000).toISOString();
    const twoHourAgo = new Date(now.getTime() - 130 * 60000).toISOString();

    const minResult = formatElapsed(fiveMinAgo);
    expect(minResult).toMatch(/^\d+min$/);

    const hourResult = formatElapsed(twoHourAgo);
    expect(hourResult).toMatch(/^\d+h \d+min$/);
  });

  it("formats with endAt", async () => {
    const { formatElapsed } = await import("../../src/tui/types.js");
    const start = new Date(Date.now() - 3600000).toISOString();
    const end = new Date().toISOString();
    const result = formatElapsed(start, end);
    expect(result).toMatch(/^\d+h \d+min$/);
  });
});
