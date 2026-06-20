---
name: opencode-tui-plugin-dev
description: |
  OpenCode TUI 侧边栏插件开发最佳实践。适用于构建 sidebar_content
  插槽的 SolidJS 组件，覆盖交互、布局、状态管理等核心模式。
---

# OpenCode TUI 侧边栏插件开发

---

## 核心规则

### 1. 避免跨组件传递 signal

OpenTUI 的 SolidJS 实现中，跨组件边界的 props/signal 追踪不可靠。
父组件的 signal 更新后，子组件可能不会重新渲染。

```tsx
// ❌ 子组件收到 signal getter 也不更新
<ChildComponent data={mySignal} />
// → ChildComponent 内部 createMemo(() => props.data()) 返回初始值

// ✅ 内联渲染——直接在父组件 JSX 中读取 signal
{(() => {
  const d = mySignal();
  return <box>...</box>;
})()}
```

**推荐架构**：把渲染逻辑放在同一个组件函数内。复杂逻辑用 IIFE
`{(() => { ... })()}` 做局部作用域，不跨越组件边界。

### 2. 只用 `onMouseUp` 做点击交互

侧边栏中只有 `onMouseUp` 可靠地响应鼠标点击。

```tsx
// ✅ 唯一有效的交互方式
<text onMouseUp={() => setCollapsed(prev => !prev)}>
  {collapsed() ? "▶" : "▼"} 点击展开/收起
</text>

// ❌ 各种无效方式
useKeyboard(...)           // 全局监听器，无焦点隔离
<box focused={true} ...>   // 侧边栏不接收键盘焦点
<box on:click={...}>       // box/text 不发出 EventEmitter 事件
```

### 3. 布局用字符串填充，不靠 flexbox

侧边栏宽度小，flexbox 布局容易导致右侧内容被裁断或比例失衡。

```tsx
// ✅ 手动 justify（CJK 字符需按 2 列宽度计算）
const justify = (left: string, right: string, width: number) =>
  left + " ".repeat(Math.max(1, width - visualWidth(left) - visualWidth(right))) + right;

<text>{justify("命中率", "85.3%", 28)}</text>

// ❌ flexbox 在窄宽度侧边栏不可靠
<box justifyContent="space-between">
  <text>命中率</text><text>85.3%</text>
</box>
```

字符条进度条替代 flexGrow：

```tsx
// ✅ 字符条——每段至少 1 个字符，比例精确
<text fg={color}>{"█".repeat(chars)}</text>

// ❌ flexGrow——小比例段被完全挤掉
<box flexGrow={tokenCount} ... />
```

---

## TUI 架构模式

### slot 组件 ≠ Web 组件

SolidJS 响应式在 OpenTUI 终端环境下严重受限。以下模式不可靠：

| 模式 | 可靠性 |
|------|--------|
| `createEffect` 在 slot 回调内 | ⚠️ 偶尔可行 |
| 跨组件 signal 传递 | ❌ |
| `setTimeout` 中 signal setter | ❌ |
| `Promise.then()` 中 signal setter | ❌ |

**goal-mode Pattern B**（经验证可靠）：
`createSignal` + `setInterval` + `onCleanup` 全部在 slot 回调内。

```tsx
export function sidebar_content(ctx: SlotContext, props: SlotProps) {
  const [data, setData] = createSignal<MyData | null>(null);

  const interval = setInterval(() => {
    const fresh = readData(); // 同步读取
    setData(fresh);
  }, 1000);

  onCleanup(() => clearInterval(interval));

  return <SidebarContent data={data} />;
}
```

### 纯渲染组件

组件只接受 getter props，不管理信号、不加载数据：

```tsx
// ✅ 纯渲染
function Card(props: { data: () => MyData | null }) {
  const d = props.data();
  return <text>{d?.label ?? "—"}</text>;
}
```

### currentSessionId 获取

`sidebar_content(ctx, props)` 中的 `props.session_id` 运行时可能为 undefined。
推荐从 `ctx` 参数或通过 API 获取，不依赖 props。

---

## 数据获取

### 直连 bun:sqlite（推荐）

TUI 插件可自行实例化 `MemorySystem`，通过 `bun:sqlite`（WAL 模式）直接查询 `.vibe-pm/vibe-pm.db`。WAL 模式支持并发读，与主进程不冲突。

```tsx
import { MemorySystem } from "../memory/memory-system.js";

export function createTuiPlugin(memory?: IMemorySystem): TuiPlugin {
  return async (api: TuiPluginApi) => {
    const projectDir = api.state.path.directory ?? ".";
    const dataDir = `${projectDir}/.vibe-pm`;

    // 优先使用注入实例，否则自行创建
    const sharedMemory = memory ?? await (async () => {
      const ms = new MemorySystem();
      await ms.init(dataDir);
      return ms;
    })();

    api.slots.register({
      sidebar_content(_ctx, props) {
        const sessionId = props.session_id;
        // ...
        async function refresh() {
          const status = await loadTaskStatus(sharedMemory, sessionId);
          const tokens = await loadTokenData(sharedMemory, sessionId);
          setTaskStatus(status);
          setTokenData(tokens);
        }
        refresh();
        const timer = setInterval(refresh, 1000);
        onCleanup(() => clearInterval(timer));
      }
    });
  };
}
```

### 关键约束

- **必须按 sessionId 过滤查询** — SPELite 是全局单文件，不按 session 过滤会显示其他 session 的数据
- **TUI 只读不写** — 所有写入由 Server 插件（主进程）负责
- **WAL 模式** — `PRAGMA journal_mode = WAL` 在 `MemorySystem.init()` 中已启用

### 用户配置持久化

```tsx
api.kv.set("my_plugin.fold_state", collapsed);
const saved = api.kv.get("my_plugin.fold_state", false);
```

---

## 交互式折叠面板

```tsx
import { createSignal, Show } from "solid-js";

function CollapsibleSection(props: {
  title: string;
  defaultOpen?: boolean;
  children: (() => JSX.Element) | JSX.Element;
  onToggle?: (open: boolean) => void;
}) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false);

  const toggle = () => {
    setOpen(o => !o);
    props.onToggle?.(!open());
  };

  return (
    <box flexDirection="column">
      <text onMouseUp={toggle}>
        {open() ? "▼" : "▶"} {props.title}
      </text>
      <Show when={open()}>
        <box marginLeft={2}>
          {typeof props.children === "function" ? props.children() : props.children}
        </box>
      </Show>
    </box>
  );
}
```

> ⚠️ 如果 `children` 需要读取父级 signal，改为在父组件中内联渲染，
> 不通过 `CollapsibleSection` 的 children prop。

---

## 构建配置

开发环境为 **Bun**（构建、测试、类型检查均使用 Bun 工具链）。

### tsconfig.json

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

### 构建命令

```json
{
  "scripts": {
    "clean:dist": "bun -e \"import { rmSync } from 'node:fs'; rmSync('dist', { recursive: true, force: true })\"",
    "build": "bun run clean:dist && tsc --emitDeclarationOnly && bun run scripts/build.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

**构建脚本**（`scripts/build.ts`）必须使用 `Bun.build()` API：

```ts
import solidPlugin from "@opentui/solid/bun-plugin";

// Server 插件（纯 TS，无需 JSX 插件）
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  external: ["@opentui/core", "@opentui/solid", "solid-js"],
  naming: { entry: "index.js" },
});

// TUI 插件（需要 solidPlugin 转换 JSX）
await Bun.build({
  entrypoints: ["./src/tui/index.ts"],
  outdir: "./dist/tui",
  target: "bun",
  format: "esm",
  external: ["@opentui/core", "@opentui/solid", "@opentui/keymap", "solid-js"],
  plugins: [solidPlugin],
  naming: { entry: "index.js" },
});
```

### 构建关键决策

| 决策 | 原因 |
|------|------|
| **必须 `Bun.build()` API** | CLI `bun build --target bun` 产物带 `// @bun` 指令，OpenTUI 的 `require()` 无法加载 |
| **必须 `solidPlugin`** | `--target bun` 的默认 JSX 转换是 React 格式，OpenTUI 需要 SolidJS 格式的 `createComponent`/`createElement` |
| **必须 external `@opentui/solid`** | 内联会导致独立的 `RendererContext` 实例，运行时抛 `No renderer found` |
| **必须 external `solid-js`** | 同上——需共享 OpenTUI 运行时提供的 reactive root |
| **`@opentui/core` 只能 external** | 含平台原生模块（`@opentui/core-darwin-x64` 等），bundle 会失败 |
| **`clean:dist` 先清理** | 避免残留旧构建产物（如已删除模块的 `.js`/`.map`） |

### 不再需要

- ~~`postinstall` 脚本修补 `@opentui/solid` jsx-runtime~~ — `@opentui/solid@0.3.4` 已内置 `jsx-runtime.js` export
- ~~`jsx-shim.mjs` 生成 `.js` 重导出~~ — `Bun.build()` 直接输出 JS

### TUI 插件注册

创建 `.opencode/tui.jsonc`：

```jsonc
{
  "plugin": ["./dist/tui/index.js"]
}
```

或在 `opencode.jsonc` 中配置 `tui.plugin` 字段。

---

## 调试方法

1. **TUI 日志**：`console.log` 和 `logger.info` 在 TUI 上下文中被抑制，调试打印必须用 `console.error`
2. **`requestRender()` 行为**：触发整个 slot 函数重新调用，但 JSX 组件的 SolidJS diff 会跳过不变 props——仅靠 `requestRender()` 不足以刷新数据
3. **开源参考**：`oh-my-opencode-slim`（28K+ 用户）和 `opencode-goal-mode` 提供了可靠的已验证模式
4. **最小变更原则**：多次迭代后需审查是否有过度重构

---

## 常见问题

| 现象 | 原因 | 修复 |
|------|------|------|
| sidebar 数据不更新 | 子组件跨边界传 signal | 内联渲染 |
| 点击无反应 | 用了 `on:click` 或 `useKeyboard` | 改用 `onMouseUp` |
| 右侧文本被裁断 | flexbox 在窄宽度失效 | 手动字符串填充 |
| 柱状图只显示一种颜色 | flexGrow 小比例段不可见 | 用 `"█".repeat(chars)` 字符条 |
| `api.state.part()` 触发死锁 | SolidJS 循环依赖 | 用 `untrack(() => { ... })` 包裹 |
| `requestRender()` 不更新数据 | JSX diff 跳过不变 props | 确保数据通过 signal getter 传入 |
| TUI 侧边栏不刷新 | `setInterval` 在组件内无效 | goal-mode Pattern B |
| `session_id` 为 undefined | SDK props 运行时不准确 | 从 ctx 或 API 获取 |
| `console.log` 无输出 | TUI 上下文抑制 | 改用 `console.error` |
| `No renderer found` | 构建时内联了 `@opentui/solid`，创建了独立的 `RendererContext` | external `@opentui/solid` 和 `solid-js`，共享 OpenTUI 运行时实例 |
| `require() async module "opentui:..."` | CLI `bun build --target bun` 产物用 `// @bun` 格式，OpenTUI 的 `require()` 不兼容 | 改用 `Bun.build()` API + solidPlugin |
| TUI 显示其他 session 的数据 | 查询 SQLite 时未按 sessionId 过滤 | 始终传 `sessionId` 到 `MemorySystem` 查询方法 |
| 构建后 TUI 加载旧代码 | TUI 入口未纳入构建，OpenCode 加载了缓存 | `build` 脚本需包含 TUI 入口的 `Bun.build()` |
| `@opentui/core-*` bundle 报错 | 平台原生模块无法 bundle | external `@opentui/core` |
