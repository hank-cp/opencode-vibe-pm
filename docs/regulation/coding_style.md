# TypeScript 编码风格

## 通用格式

- 统一使用 UTF-8 编码，换行符使用 LF
- 使用 Prettier 自动格式化代码（保存时自动执行）
- 缩进使用 2 空格，不使用 Tab
- 行长度建议不超过 100 字符
- 文件末尾保留一个空行

## 文件组织

### 命名

- TypeScript 源文件使用 `kebab-case` 或 `camelCase`，与所在模块保持一致
- 目录名使用 `kebab-case`
- 测试文件与被测文件同目录，命名为 `*.test.ts`

### Import 分组

```typescript
// 1. 运行时内置模块
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2. 第三方库
import axios from 'axios';
import { z } from 'zod';

// 3. 项目内部模块（使用相对路径或别名）
import { TaskState } from '../state/task-state';
import { FlowParser } from './flow-parser';
```

## 命名规范

### 变量

- 使用 `camelCase`
- 短作用域用短名字：`i`, `item`, `ctx`
- 长作用域用描述性名字：`taskConfig`, `messageCount`
- 布尔变量用疑问词前缀：`isActive`, `hasPlan`, `canProceed`
- 不使用匈牙利命名法

### 常量

- 使用 `UPPER_SNAKE_CASE`（模块级常量）
- 或 `camelCase`（函数内常量）

```typescript
const DEFAULT_LANGUAGE = 'zh-CN';
const MAX_RETRY_COUNT = 3;

function process() {
  const timeoutMs = 5000;
}
```

### 函数

- 使用 `camelCase`
- 动词开头：`getTask`, `findFlow`, `createPlan`, `parseSpec`
- 事件处理函数：`handleXxx` 或 `onXxx`

### 类型与接口

- 使用 `PascalCase`
- 接口名不加 `I` 前缀
- 类型别名不加 `T` 前缀

```typescript
interface TaskState {
  sessionId: string;
  flow: string;
  currentStep: string;
}

type StepTransition = {
  from: string;
  to: string;
  condition: string;
};
```

### 类

- 使用 `PascalCase`
- 单数形式
- 公共方法在前，私有方法在后

### 枚举

- 使用 `PascalCase`，成员使用 `PascalCase`

```typescript
enum TaskStatus {
  Running = 'running',
  Completed = 'completed',
  Closed = 'closed',
}
```

## 类型安全

### 禁止事项

```typescript
// ❌ 禁止 any
function process(data: any): any { }

// ❌ 禁止 @ts-ignore / @ts-expect-error
// @ts-ignore
const x = something;

// ❌ 禁止空 catch
try { } catch (e) { }

// ❌ 禁止非空断言滥用
const x = data!.value!; // 除非有充分理由
```

### 推荐方式

```typescript
// ✅ 使用 unknown 代替 any
function process(data: unknown): Result {
  if (!isValidData(data)) {
    throw new TypeError('Invalid data');
  }
  // data is now typed
}

// ✅ 守卫类型
function isValidData(data: unknown): data is ValidData {
  return typeof data === 'object' && data !== null && 'id' in data;
}

// ✅ 显式错误处理
try {
  await riskyOperation();
} catch (e) {
  logger.error('Operation failed', { error: String(e) });
  throw new OperationError('Failed to complete operation', { cause: e });
}
```

## 函数设计

### 参数

- 超过 3 个参数使用对象参数

```typescript
// ❌
function createTask(name: string, flow: string, step: string, startAt: Date): Task { }

// ✅
function createTask(params: {
  name: string;
  flow: string;
  step: string;
  startAt: Date;
}): Task { }
```

### 返回值

- 优先返回具体类型，而非 `undefined | null`
- 可能返回"空"的场景使用 `Result<T, E>` 模式或 `Option<T>`

## 异步处理

- 统一使用 `async/await`，避免原始 Promise
- 异步函数返回 `Promise<T>`，类型明确
- 顶层 async 使用 IIFE 或 `.catch()` 兜底

```typescript
async function loadTask(sessionId: string): Promise<Task | null> {
  const data = await db.query('SELECT * FROM tasks WHERE session_id = ?', [sessionId]);
  return data ? Task.fromRow(data) : null;
}
```

## 日志

- 使用项目统一的日志模块（不直接用 `console.log`）
- 日志消息使用英文
- 关键路径记录 info/debug 日志

```typescript
logger.info('Task created', { sessionId, flow });
logger.error('Failed to load task', { sessionId, error: String(e) });
```

## 占位代码

- 标记格式：

```typescript
// TODO(username): 需要对接 OpenAI API — 预计 v1.1
// FIXME(username): 并发场景下可能数据竞争 — 需要加锁
// HACK(username): 临时绕过 AxioDB 事务限制 — v1.0 后替换
```

## 导出规范

- 每个文件尽量只有一个主要导出
- 辅助类型/函数使用命名导出
- 模块暴露出清晰的公共 API

```typescript
// flow-parser.ts
export interface FlowDefinition { }
export function parseFlow(path: string): FlowDefinition { }

// 内部不导出
function validateStep(step: unknown): step is StepDefinition { }
```
