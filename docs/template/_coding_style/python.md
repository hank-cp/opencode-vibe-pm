# Python Coding Style

## General Formatting

- Use UTF-8 encoding with LF line endings
- Use Black + isort for automatic code formatting (run on save)
- Indent with 4 spaces, do not use tabs
- Recommended line length: no more than 88 characters
- Keep one blank line at the end of the file

## File Organization

### Naming

- Source files use `snake_case`
- Directory names use `snake_case`
- Test file naming: `test_*.py` or `*_test.py`

### Import Grouping

```python
# 1. Standard library
import os
from pathlib import Path

# 2. Third-party libraries
import requests
from pydantic import BaseModel

# 3. Project internal modules
from app.core.config import settings
from app.models.user import User
```

### File Structure

- Each file should ideally have one main export
- Use named exports for helper types/functions
- Modules should expose a clean public API

## Naming Conventions

### Variables

- Use `snake_case`
- Short scope uses short names: `i`, `item`, `ctx`
- Long scope uses descriptive names: `task_config`, `message_count`
- Boolean variables use interrogative prefixes: `is_active`, `has_plan`, `can_proceed`
- Do not use Hungarian notation

### Constants

- `UPPER_SNAKE_CASE`

```python
DEFAULT_LANGUAGE = "zh-CN"
MAX_RETRY_COUNT = 3
```

### Functions

- Use `snake_case`
- Start with a verb: `get_task`, `find_flow`, `create_plan`, `parse_spec`
- Event handler functions: `handle_xxx` or `on_xxx`

### Types and Classes

- Use `PascalCase`
- Follow PEP 8, class names use CapWords

```python
class TaskState:
    session_id: str
    flow: str
    current_step: str
```

### Enums

Use `Enum`, members use `UPPER_SNAKE_CASE`

```python
from enum import Enum

class TaskStatus(Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    CLOSED = "closed"
```

## Type Safety

### Recommended Practices

```python
# ✅ Use type annotations
def process(data: dict[str, object]) -> Result:
    if not isinstance(data, dict) or "id" not in data:
        raise TypeError("Invalid data")
    ...

# ✅ Use mypy / pyright for static checking
# ✅ Use dataclass / Pydantic to define data structures
from dataclasses import dataclass

@dataclass
class TaskState:
    session_id: str
    flow: str
    current_step: str
```

### Prohibitions

- ❌ No bare except (at minimum catch Exception)
- ❌ Do not use print() instead of logging in production code
- ❌ No mutable default arguments

## Function Design

### Parameters

- Use object/struct parameters when exceeding 3 arguments

### Return Values

- Prefer concrete types, avoid None
- For "empty" return scenarios, use the `Result` pattern (e.g., returns library) or `Optional[T]`

## Async Handling

- Use `async/await` (asyncio)
- Use `async def` for async functions
- Avoid mixing synchronous and asynchronous code

```python
async def load_task(session_id: str) -> Task | None:
    data = await db.fetch_one("SELECT * FROM tasks WHERE session_id = ?", session_id)
    return Task.from_row(data) if data else None
```

## Error Handling

- Catch specific exception types, do not use bare `except:`
- Validate inputs at system boundaries
- Use custom exception classes

```python
try:
    result = await risky_operation()
except ConnectionError as e:
    logger.error("Operation failed", extra={"error": str(e)})
    raise OperationError("Failed to complete operation") from e
```

## Logging

- Use the `logging` module, do not use `print()` directly
- Log messages in English
- Record info/debug logs on critical paths

```python
import logging

logger = logging.getLogger(__name__)
logger.info("Task created", extra={"session_id": session_id})
logger.error("Failed to load task", extra={"error": str(e)})
```

## Comments and Documentation

- Code comments in English
- Public APIs use docstrings (Google or NumPy style)
- Add explanatory comments for complex logic

## Placeholder Code

```python
# TODO(username): Need to integrate API — expected v1.1
# FIXME(username): Possible data race under concurrency — needs locking
# HACK(username): Temporary workaround — replace after v1.0
```

## Export Conventions

```python
# Control exports in __init__.py
__all__ = ["FlowParser", "parse_flow", "FlowDefinition"]

# Main export
class FlowParser: ...

# Helper functions use named exports
def parse_flow(path: str) -> FlowDefinition: ...
```
