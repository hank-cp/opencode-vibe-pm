# General Coding Style

> This file is the general coding standard for unsupported languages. When the project's language has no specific style guide, this file serves as the baseline.

## General Format

- Use UTF-8 encoding, LF line endings
- Use the project's designated formatter
- Indentation follows project convention (recommended 2 or 4 spaces)
- Line length should not exceed 100 characters
- Keep one blank line at end of file

## File Organization

### Naming

- Source files use project convention (recommended `kebab-case` or `snake_case`)
- Directory names use project convention (recommended `kebab-case`)
- Test file naming follows project convention

### Import / Dependency Resolution

1. Standard library / built-in modules
2. Third-party dependencies
3. Project internal modules

### File Structure

- Prefer one primary export per file
- Use named exports for helper types/functions
- Expose a clean public API from each module

## Naming Conventions

### Variables

- Use project convention (recommended `camelCase` or `snake_case`)
- Short scope → short names
- Long scope → descriptive names
- Boolean variables use question-word prefixes
- Do not use Hungarian notation

### Constants

- Use project convention (recommended `UPPER_SNAKE_CASE`)

### Functions

- Use project convention (recommended `camelCase` or `snake_case`)
- Start with a verb

### Types / Interfaces / Classes

- Use project convention (recommended `PascalCase`)
- Do not prefix interface/type names

### Enums / Union Types

- Follow project convention

## Type Safety

- Avoid dynamic types / any-type
- Prefer type annotations / type hints
- Explicit error handling; never swallow exceptions

## Function Design

### Parameters

- Use object/struct parameters when exceeding 3 parameters

### Return Values

- Prefer returning concrete types
- For nullable scenarios, use project convention (e.g., `Result<T, E>`, `Optional<T>`, `(T, error)`)

## Control Flow

- Prefer early returns to reduce nesting depth

## Async Handling

- Use the language/framework's recommended async pattern

## Error Handling

- All errors must be handled explicitly
- Validate inputs at system boundaries
- Do not add "impossible" error handling in internal logic

## Logging

- Use the project's unified logging module
- Log messages in English
- Record info/debug logs on critical paths

## Comments & Documentation

- Code comments in English
- Add doc comments to public APIs
- Add explanatory comments for complex logic

## Placeholder Code

```
// TODO(username): needs API integration — expected v1.1
// FIXME(username): potential data race under concurrency — needs locking
// HACK(username): temporary workaround — replace after v1.0
```

## Export Conventions

Use the language/framework's recommended visibility control
