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

## 信号传递速查

| 模式 | 结果 |
|------|------|
| 父组件内联 `{() => { const d = signal(); ... }}` | ✅ 可靠 |
| `createMemo(() => props.signal())` 在子组件中 | ⚠️ 偶尔可行（依赖其他 props 触发重渲染） |
| `() => props.signal()` 在子组件中 | ❌ |
| 父传静态值给子组件 | ❌ |

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

### tsconfig.json

TUI 插件使用 `@opentui/solid` 作为 JSX 运行时：

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

### JSX 编译与 jsx-shim

**问题**：`"jsx": "preserve"` 将 `.tsx` 编译为 `.jsx` 文件，但源码中
`import` 使用的扩展名是 `.js`。OpenCode 的 Bun 运行时通过内部插件
支持 `.jsx`，但 `.js` 路径仍需解析到实际的 `.jsx` 文件。

**解决**：构建步骤 `tsc` 之后运行 jsx-shim 脚本，为 `dist/` 下每个
`.jsx` 文件生成对应的 `.js` 重导出文件：

```
dist/tui/slots/sidebar-content.jsx    ← tsc 编译产物
dist/tui/slots/sidebar-content.js     ← shim: export * from "./sidebar-content.jsx"
```

**脚本实现**（`scripts/jsx-shim.mjs`）：

```js
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); }
    else if (entry.name.endsWith(".jsx")) {
      const shimPath = full.replace(/\.jsx$/, ".js");
      writeFileSync(shimPath, `export * from "./${entry.name}";\n`);
    }
  }
}
walk("dist");
```

### OpenTUI JSX 运行时补丁

`@opentui/solid` 的 JSX 运行时在 `jsx: "preserve"` 模式下存在
兼容性问题，需在 `postinstall` 时打补丁。

**`scripts/patch-opentui-jsx-runtime.mjs`**：
自动修改 `node_modules/@opentui/solid/jsx-runtime.js`，
修复 JSX 转换中的类型推导问题。

### package.json

```json
{
  "build": "tsc && node scripts/jsx-shim.mjs",
  "postinstall": "node scripts/patch-opentui-jsx-runtime.mjs",
  "exports": {
    "./tui": {
      "import": "./dist/tui/index.js"
    }
  }
}
```

### 替代方案

| 方案 | tsconfig | 优点 | 缺点 |
|------|----------|------|------|
| preserve + shim | `jsx: "preserve"` | 源码 import 用 `.js` 自然 | 额外脚本维护 |
| react-jsx 直接编译 | `jsx: "react-jsx"` | 无需 shim，输出 `.js` | 依赖 OpenCode 运行时 JSX 支持 |

### TUI 插件注册

创建 `.opencode/tui.jsonc`：

```jsonc
{
  "plugin": ["./dist/tui/index.js"]
}
```

或在 `opencode.jsonc` 中配置 `tui.plugin` 字段。

> 注意：`@opentui/core` 和 `@opentui/solid` 由 OpenCode 运行时提供，
> 放在 `peerDependencies` 中即可，不需要在 `dependencies` 中安装。

---

## 常见问题

| 现象 | 原因 | 修复 |
|------|------|------|
| sidebar 数据不更新 | 子组件跨边界传 signal | 内联渲染 |
| 点击无反应 | 用了 `on:click` 或 `useKeyboard` | 改用 `onMouseUp` |
| 右侧文本被裁断 | flexbox 在窄宽度失效 | 手动字符串填充 |
| 柱状图只显示一种颜色 | flexGrow 小比例段不可见 | 用 `"█".repeat(chars)` 字符条 |
| 构建后 import 找不到 .jsx | tsconfig `jsx: "preserve"` | 加 jsx-shim 或改用 `react-jsx` |
| `api.state.part()` 触发死锁 | SolidJS 循环依赖 | 用 `untrack(() => { ... })` 包裹 |

---

## 数据获取

TUI 插件通过 `api.state` 直接读取 OpenCode 运行时状态，
不需要依赖主插件的数据传递：

```tsx
createEffect(() => {
  const msgs = api.state.session.messages(sessionId);
  const session = api.state.session.get(sessionId);
  // 直接从 session 对象提取数据
  const tokens = session?.tokens?.input ?? 0;
  // ...
});
```

用户配置可持久化到 `api.kv`：

```tsx
// 写入
api.kv.set("my_plugin.fold_state", collapsed);
// 读取
const saved = api.kv.get("my_plugin.fold_state", false);
```
