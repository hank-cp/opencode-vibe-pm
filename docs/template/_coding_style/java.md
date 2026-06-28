# Java Coding Style

## General Format

- Use UTF-8 encoding uniformly, LF for line endings
- Use Spotless / google-java-format for automatic code formatting
- Use 4 spaces for indentation, no tabs
- Recommended line length: max 120 characters
- Keep one blank line at end of file

## File Organization

### Naming

- Source files use `PascalCase` (one public class per file)
- Directory names use `snake_case` or follow package naming conventions
- Test file naming: `*Test.java`, mirroring `src/main/` structure under `src/test/`
- Package names are all lowercase, using reverse domain notation (e.g. `com.example.project`)

### Import Grouping

```java
// 1. Static imports
import static org.junit.Assert.*;

// 2. Java standard library
import java.util.List;
import java.util.Optional;

// 3. Third-party libraries
import com.google.common.collect.ImmutableList;

// 4. Project internals
import com.example.project.core.TaskState;
```

### File Structure

- One top-level class per file, class name matches file name
- Each file should ideally have only one main export
- Helper types/functions use named exports

## Naming Conventions

### Variables

- Use `camelCase`
- Short scope: short names, e.g. `i`, `item`, `ctx`
- Long scope: descriptive names, e.g. `taskConfig`, `messageCount`
- Boolean variables: question-word prefix, e.g. `isActive`, `hasPlan`, `canProceed`

### Constants

- `UPPER_SNAKE_CASE` (`static final` fields)

### Functions

- Use `camelCase`
- Verb-prefixed: `getTask`, `findFlow`, `createPlan`, `parseSpec`

### Types and Interfaces

- Use `PascalCase`
- No `I` prefix for interface names

### Enums

Use `enum`, members in `UPPER_SNAKE_CASE`:

```java
public enum TaskStatus {
    RUNNING,
    COMPLETED,
    CLOSED
}
```

## Type Safety

### Rules

- ✅ Use generics to avoid raw types
- ✅ Use `Optional<T>` instead of returning null
- ✅ Use `final` for immutable fields
- ❌ Never catch `Exception` and swallow it

## Function Design

### Parameters

- Use Builder pattern for complex construction when exceeding 3 parameters

### Return Values

- `Optional<T>` or custom `Result<T, E>`

## Async Handling

- Use `CompletableFuture<T>` or reactive frameworks
- Async methods return `Future<T>`

```java
public CompletableFuture<Optional<Task>> loadTask(String sessionId) {
    return db.queryAsync("SELECT * FROM tasks WHERE session_id = ?", sessionId)
        .thenApply(data -> data != null ? Task.fromRow(data) : null);
}
```

## Error Handling

- Catch specific exception types
- Use custom exception classes
- Release resources in `finally` (or use try-with-resources)

```java
try {
    var result = riskyOperation();
} catch (IOException e) {
    logger.error("Operation failed", e);
    throw new OperationException("Failed to complete operation", e);
}
```

## Logging

- Use SLF4J + Logback
- Log messages in English

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

private static final Logger logger = LoggerFactory.getLogger(TaskService.class);
logger.info("Task created, sessionId={}", sessionId);
logger.error("Failed to load task", e);
```

## Comments and Documentation

- Code comments in English
- Use Javadoc for public APIs
- Add explanatory comments for complex logic

## Placeholder Code

```java
// TODO(username): Need to integrate API — estimated v1.1
// FIXME(username): Possible data race in concurrent scenario — need locking
// HACK(username): Temporary workaround — replace after v1.0
```

## Export Conventions

Use `public` / `protected` / package-private to control visibility
