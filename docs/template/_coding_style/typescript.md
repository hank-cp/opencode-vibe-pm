# TypeScript Coding Style

## General Formatting

- Use UTF-8 encoding, LF line endings
- Use Prettier for automatic code formatting (run on save)
- Use 2-space indentation, no tabs
- Recommended max line length of 100 characters
- Keep one blank line at end of file

## File Organization

### Naming

- TypeScript source files use `kebab-case` or `camelCase`, consistent with the module they belong to
- Directory names use `kebab-case`
- Test file naming: `*.test.ts` or `*.spec.ts`, co-located with the file under test

### Import Grouping

```typescript
// 1. Node built-in modules
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2. Third-party libraries
import axios from 'axios';
import { z } from 'zod';

// 3. Project-internal modules (relative paths or aliases)
import { TaskState } from '../state/task-state';
import { FlowParser } from './flow-parser';
```

### File Structure

- Each file should ideally have one primary export
- Auxiliary types/functions use named exports
- Modules expose a clear public API

## Naming Conventions

### Variables

- Use `camelCase`
- Short names for short scopes: `i`, `item`, `ctx`
- Descriptive names for long scopes: `taskConfig`, `messageCount`
- Boolean variables prefixed with a question word: `isActive`, `hasPlan`, `canProceed`
- No Hungarian notation

### Constants

- `UPPER_SNAKE_CASE` (module-level) / `camelCase` (within functions)

```typescript
const DEFAULT_LANGUAGE = 'zh-CN';
const MAX_RETRY_COUNT = 3;

function process() {
  const timeoutMs = 5000;
}
```

### Functions

- Use `camelCase`
- Start with a verb: `getTask`, `findFlow`, `createPlan`, `parseSpec`
- Event handler functions: `handleXxx` or `onXxx`

### Types & Interfaces

- Use `PascalCase`
- Do not prefix interface names with `I`
- Do not prefix type aliases with `T`

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

### Classes

- Use `PascalCase`, singular form
- Public methods first, private methods last

### Enums

Use `PascalCase`, members use `PascalCase`

```typescript
enum TaskStatus {
  Running = 'running',
  Completed = 'completed',
  Closed = 'closed',
}
```

## Type Safety

### Prohibited

```typescript
// ❌ Do not use any
function process(data: any): any { }

// ❌ Do not use @ts-ignore / @ts-expect-error
// @ts-ignore
const x = something;

// ❌ Do not use empty catch blocks
try { } catch (e) { }

// ❌ Do not abuse non-null assertions
const x = data!.value!;
```

### Recommended

```typescript
// ✅ Use unknown instead of any
function process(data: unknown): Result {
  if (!isValidData(data)) throw new TypeError('Invalid data');
}

// ✅ Type guards
function isValidData(data: unknown): data is ValidData {
  return typeof data === 'object' && data !== null && 'id' in data;
}

// ✅ Explicit error handling
try {
  await riskyOperation();
} catch (e) {
  logger.error('Operation failed', { error: String(e) });
  throw new OperationError('Failed', { cause: e });
}
```

## Function Design

### Parameters

- Use an object parameter when there are more than 3 parameters

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

### Return Values

- Prefer concrete return types over `undefined | null`
- For "empty" scenarios, use the `Result<T, E>` pattern or `Option<T>`

## Async Handling

- Consistently use `async/await`, avoid raw Promises
- Async functions return `Promise<T>` with explicit types
- Top-level async uses IIFE or `.catch()` as a safety net

```typescript
async function loadTask(sessionId: string): Promise<Task | null> {
  const data = await db.query('SELECT * FROM tasks WHERE session_id = ?', [sessionId]);
  return data ? Task.fromRow(data) : null;
}
```

## Error Handling

- All errors must be handled explicitly (propagate / wrap / handle / abort)
- Validate at system boundaries (user input, external APIs)
- Do not add "impossible" error handling in internal logic

```typescript
try {
  await riskyOperation();
} catch (e) {
  logger.error('Operation failed', { error: String(e) });
  throw new OperationError('Failed to complete operation', { cause: e });
}
```

## Logging

- Use the project's unified logging module (not raw `console.log`)
- Log messages in English
- Log info/debug on critical paths

```typescript
logger.info('Task created', { sessionId, flow });
logger.error('Failed to load task', { sessionId, error: String(e) });
```

## Comments & Documentation

- Code comments in English
- Public APIs use JSDoc comments
- Add explanatory comments for complex logic

## Placeholder Code

```typescript
// TODO(username): Need to integrate API — expected v1.1
// FIXME(username): Possible data race under concurrency — needs locking
// HACK(username): Temporary workaround — replace after v1.0
```

## Export Conventions

```typescript
// Primary export
export class FlowParser { }

// Auxiliary types/functions use named exports
export interface FlowDefinition { }
export function parseFlow(path: string): FlowDefinition { }

// Internal implementation — not exported
function validateStep(step: unknown): step is StepDefinition { }
```
