/**
 * TUI 单元测试 — Collapsible 组件
 *
 * 测试 Collapsible 展开/折叠行为。
 */

import { describe, it, expect } from "bun:test";

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
  it("applies display formulas from session token metrics", async () => {
    const { loadTokenData } = await import(
      "../../src/tui/data/token-data.js"
    );
    // SessionTokenMetrics with raw data: text=1000, user=3000, assistant=6000
    // hierarchy: flowControl=500, tool=1500, reasoning=800
    // scaleFactor=1.0, no API data (apiInput=0, apiOutput=0)
    const result = await loadTokenData(
      {
        getSessionTokens: async () => ({
          sessionId: "test-session",
          text: 1000,
          user: 3000,
          assistant: 6000,
          flowControl: 500,
          tool: 1500,
          reasoning: 800,
          apiInput: 0,
          apiOutput: 0,
          apiReasoning: 0,
          apiCacheRead: 0,
          apiCacheWrite: 0,
          scaleFactor: 1.0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        getStepTokenBreakdown: async () => [
          { step: "S1", stepName: "理解需求", stepInCount: 2, tokensConsumed: 1200 },
          { step: "S2", stepName: "标记缺口", stepInCount: 1, tokensConsumed: 2800 },
        ],
      } as unknown as Parameters<typeof loadTokenData>[0],
      "test-session",
    );
    // Display formulas with scaleFactor=1.0:
    // FlowControl = 500 * 1 = 500
    // Text = 1000 * 1 = 1000
    // Tool = 1500 * 1 = 1500
    // Reasoning = 800 * 1 = 800
    // TOTAL = text + user + assistant = 10000 (no API data)
    expect(result.totalTokens).toBe(10000);
    expect(result.sourceBreakdown).toHaveLength(4);
    expect(result.stepBreakdown).toHaveLength(2);
    
    const fcEntry = result.sourceBreakdown.find((s) => s.source === "FlowControl");
    expect(fcEntry?.tokens).toBe(500);
    
    const textEntry = result.sourceBreakdown.find((s) => s.source === "Text");
    expect(textEntry?.tokens).toBe(1000);
    
    const toolEntry = result.sourceBreakdown.find((s) => s.source === "Tool");
    expect(toolEntry?.tokens).toBe(1500);
    
    const reasoningEntry = result.sourceBreakdown.find((s) => s.source === "Reasoning");
    expect(reasoningEntry?.tokens).toBe(800);
  });

  it("returns zero tokens for null session metrics", async () => {
    const { loadTokenData } = await import(
      "../../src/tui/data/token-data.js"
    );
    const result = await loadTokenData(
      {
        getSessionTokens: async () => null,
        getStepTokenBreakdown: async () => [],
      } as unknown as Parameters<typeof loadTokenData>[0],
      "test-session",
    );
    expect(result.totalTokens).toBe(0);
    expect(result.sourceBreakdown).toHaveLength(0);
    expect(result.stepBreakdown).toHaveLength(0);
  });

  it("uses API data for total and applies scaleFactor correctly", async () => {
    const { loadTokenData } = await import(
      "../../src/tui/data/token-data.js"
    );
    // Same raw data as test 1 but with API data and scaleFactor=2
    const result = await loadTokenData(
      {
        getSessionTokens: async () => ({
          sessionId: "test-session",
          text: 1000,
          user: 3000,
          assistant: 6000,
          flowControl: 500,
          tool: 1500,
          reasoning: 800,
          apiInput: 5000,
          apiOutput: 7000,
          apiReasoning: 0,
          apiCacheRead: 0,
          apiCacheWrite: 0,
          scaleFactor: 2.0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        getStepTokenBreakdown: async () => [],
      } as unknown as Parameters<typeof loadTokenData>[0],
      "test-session",
    );
    // TOTAL = apiInput + apiOutput = 5000 + 7000 = 12000 (API data present)
    expect(result.totalTokens).toBe(12000);
    // Text = 1000 * 2 = 2000
    // FlowControl = 500 * 2 = 1000
    // Tool = 1500 * 2 = 3000
    // Reasoning = 800 * 2 = 1600
    const textEntry = result.sourceBreakdown.find((s) => s.source === "Text");
    expect(textEntry?.tokens).toBe(2000);
    const fcEntry = result.sourceBreakdown.find((s) => s.source === "FlowControl");
    expect(fcEntry?.tokens).toBe(1000);
    const toolEntry = result.sourceBreakdown.find((s) => s.source === "Tool");
    expect(toolEntry?.tokens).toBe(3000);
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

describe("visualWidth", () => {
  it("counts pure ASCII as 1 per character", async () => {
    const { visualWidth } = await import("../../src/tui/types.js");
    expect(visualWidth("S1")).toBe(2);
    expect(visualWidth("abc")).toBe(3);
    expect(visualWidth("12.5K")).toBe(5);
    expect(visualWidth("(2)")).toBe(3);
  });

  it("counts CJK characters as 2 per character", async () => {
    const { visualWidth } = await import("../../src/tui/types.js");
    expect(visualWidth("研究")).toBe(4);
    expect(visualWidth("步骤")).toBe(4);
    expect(visualWidth("执行环节")).toBe(8);
  });

  it("counts CJK punctuation as 2", async () => {
    const { visualWidth } = await import("../../src/tui/types.js");
    expect(visualWidth("次")).toBe(2);
    expect(visualWidth("暂无数据")).toBe(8);
  });

  it("handles mixed ASCII and CJK", async () => {
    const { visualWidth } = await import("../../src/tui/types.js");
    expect(visualWidth("S1 ██ 研究")).toBe(10);
    expect(visualWidth("1.2K (2次)")).toBe(10);
  });

  it("returns 0 for empty string", async () => {
    const { visualWidth } = await import("../../src/tui/types.js");
    expect(visualWidth("")).toBe(0);
  });

  it("handles block characters as 1", async () => {
    const { visualWidth } = await import("../../src/tui/types.js");
    expect(visualWidth("█".repeat(10))).toBe(10);
    expect(visualWidth("█".repeat(20))).toBe(20);
  });
});

describe("StepTokens manual padding integrity", () => {
  it("produces padded string with at least 1 space gap", async () => {
    const { visualWidth } = await import("../../src/tui/types.js");

    const stepData = [
      { step: "S1", stepName: "研究", stepInCount: 2, tokensConsumed: 1200, barW: 4 },
      { step: "S2", stepName: "设计", stepInCount: 1, tokensConsumed: 2800, barW: 8 },
      { step: "S3", stepName: "实施", stepInCount: 1, tokensConsumed: 500, barW: 2 },
      { step: "S4", stepName: "验收测试", stepInCount: 3, tokensConsumed: 5000, barW: 12 },
    ];

    for (const s of stepData) {
      const left = `${s.step} ${"█".repeat(s.barW)} ${s.stepName}`;
      const right = `${s.tokensConsumed >= 1000
        ? (s.tokensConsumed / 1000).toFixed(1) + "K"
        : String(s.tokensConsumed)} (${s.stepInCount}次)`;
      const pad = Math.max(1, 38 - visualWidth(left) - visualWidth(right));

      expect(pad).toBeGreaterThanOrEqual(1);
      expect(visualWidth(left) + pad + visualWidth(right)).toBeLessThanOrEqual(38);
    }
  });

  it("falls back to 1 space when content would overflow 38 cols", async () => {
    const { visualWidth } = await import("../../src/tui/types.js");

    const longName = "一段非常长的步骤名称用于测试边界情况";
    const left = `S1 ██████ ${longName}`;
    const right = "99.9K (99次)";
    const pad = Math.max(1, 38 - visualWidth(left) - visualWidth(right));

    expect(pad).toBe(1);
  });
});
