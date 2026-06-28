# Go Coding Style

## General Format

- Use UTF-8 encoding uniformly, with LF line endings
- Use gofmt / goimports to auto-format code (run automatically on save)
- Use Tab for indentation
- Recommended line length: no more than 120 characters
- Keep one blank line at the end of the file

## File Organization

### Naming

- Source files use `snake_case` (lowercase + underscores)
- Directory names use `snake_case` (lowercase, concise)
- Test files are named: `*_test.go`, in the same directory as the file under test
- Package names use short lowercase words, avoid underscores

### Import Grouping

```go
import (
    // 1. Standard library
    "fmt"
    "os"

    // 2. Third-party libraries
    "github.com/gin-gonic/gin"

    // 3. Internal project packages
    "example.com/project/internal/models"
)
```

### File Structure

- One package per directory, package name matches directory name
- Each file should ideally have only one primary export
- Helper types/functions use named exports

## Naming Conventions

### Variables

- Use `camelCase` (exported: `PascalCase`)
- Short scope → short names: `i`, `item`, `ctx`
- Long scope → descriptive names: `taskConfig`, `messageCount`
- Boolean variables use question-word prefixes: `isActive`, `hasPlan`, `canProceed`

### Constants

- `PascalCase` or `camelCase` (exported: `PascalCase`)
- Go does not use UPPER_SNAKE_CASE

### Functions

- Use `camelCase` (exported: `PascalCase`)
- Start with a verb: `getTask`, `findFlow`, `createPlan`, `parseSpec`

### Types and Structs

- Use `PascalCase`
- Interface names typically end with `-er` (e.g., `Reader`, `Writer`)
- Go has no classes; use `PascalCase` for struct names

### Enums

Go has no native enums; use `const` + `iota`:

```go
type TaskStatus int

const (
    TaskStatusRunning TaskStatus = iota
    TaskStatusCompleted
    TaskStatusClosed
)
```

## Type Safety

### Rules

- ✅ Use strong typing; avoid `interface{}` (prefer generics or concrete types)
- ✅ Explicit error handling: check `if err != nil` for every call that may fail
- ✅ Use `go vet` and `staticcheck` for static analysis
- ❌ Never ignore returned error values

## Function Design

### Parameters

- Use a struct parameter when there are more than 3 parameters

### Return Values

- `(T, error)` tuple

## Control Flow

- Prefer early returns to reduce nesting
- `switch` does not need `break`; use `fallthrough` for explicit fall-through

## Async Handling

- Use goroutine + channel for concurrency
- Use `context.Context` to propagate cancellation signals and timeouts
- Use `sync.WaitGroup` / `errgroup` to manage concurrency

```go
func LoadTask(ctx context.Context, sessionID string) (*Task, error) {
    // ...
}
```

## Error Handling

- Explicitly handle errors for every call that may fail
- Error messages start with a lowercase letter and do not end with punctuation
- Use `fmt.Errorf` to wrap errors

```go
data, err := db.Query("SELECT * FROM tasks WHERE session_id = ?", sessionID)
if err != nil {
    return nil, fmt.Errorf("failed to load task: %w", err)
}
```

## Logging

- Use structured logging libraries (e.g., `slog`, `zap`)
- Log messages use English

```go
slog.Info("task created", "sessionID", sessionID)
slog.Error("failed to load task", "error", err)
```

## Comments and Documentation

- Code comments use English
- Exported types/functions must have doc comments (starting with the name)
- Add explanatory comments for complex logic

## Placeholder Code

```go
// TODO(username): Needs API integration — planned for v1.1
// FIXME(username): Possible data race under concurrency — needs locking
// HACK(username): Temporary workaround — replace after v1.0
```

## Export Conventions

- Capitalized first letter = exported (public)
- Lowercase first letter = package-private (private)
- Avoid exporting unnecessary symbols
