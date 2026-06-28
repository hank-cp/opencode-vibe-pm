# SQL Coding Style

> This project uses SQLite (bun:sqlite) as the embedded database. The following conventions are adapted for SQLite characteristics while remaining compatible with general SQL best practices.

## General Formatting

- Use UTF-8 encoding consistently; line endings use LF
- SQL keywords **MUST be UPPERCASE** (`SELECT`, `FROM`, `WHERE`, `INSERT`, etc.)
- Indentation uses 2 spaces
- Recommended line length: no more than 100 characters

```sql
SELECT t.id,
       t.name,
       t.created_at
  FROM tasks AS t
 WHERE t.status = 'active'
   AND t.created_at > ?
 ORDER BY t.created_at DESC;
```

## Naming Conventions

### Database Name / Schema Name

- Use `snake_case`, all lowercase
- Example: `vibe_pm`

### Table Names

- Use `snake_case`, plural form (represents collections)
- Example: `tasks`, `task_steps`, `flow_definitions`
- No pinyin; use consistent English nouns
- Avoid SQL keywords (e.g. `order`, `group`, `select`) to avoid quoting

### Column Names

- Use `snake_case`, all lowercase
- Example: `session_id`, `created_at`, `is_active`
- Boolean columns use interrogative prefixes: `is_active`, `has_plan`, `can_proceed`
- Primary keys uniformly use `id`
- Foreign key format: `{referenced_table}_id` (e.g. `task_id` references `tasks.id`)

### Constraint Naming

Constraint names should be clear to facilitate quick identification during debugging:

| Constraint Type | Naming Format | Example |
|---------|---------|------|
| Primary Key | `{table}_{column}_pkey` | `tasks_id_pkey` |
| Unique Constraint | `{table}_{column1}_{column2}_uk` | `tasks_session_id_flow_uk` |
| Foreign Key | `{table}_{referenced_table}_fk` | `task_steps_task_fk` |
| Index | `idx_{table}_{column1}_{column2}` | `idx_tasks_status_created_at` |

```sql
-- Primary key constraint
CREATE TABLE tasks (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  CONSTRAINT tasks_session_id_flow_uk UNIQUE (session_id, flow)
);

-- Foreign key constraint
CREATE TABLE task_steps (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL
    REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT task_steps_task_fk FOREIGN KEY (task_id) REFERENCES tasks (id)
);

-- Indexes
CREATE INDEX idx_tasks_session_id ON tasks (session_id);
CREATE INDEX idx_tasks_status_created_at ON tasks (status, created_at);
```

## DDL Conventions

### Primary Keys

- Use `INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT` (SQLite recommended approach)
- **No composite primary keys**; define `UNIQUE` constraints when a compound unique requirement exists
- In SQLite, `INTEGER PRIMARY KEY` automatically becomes a rowid alias, achieving optimal performance

```sql
-- ✅ Recommended
CREATE TABLE tasks (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ...
);

-- ❌ Avoid
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,  -- TEXT primary key has no rowid optimization
  ...
);
```

### Foreign Keys

- Foreign key column type must match the referenced column type
- Add `ON DELETE CASCADE` when child table records should be deleted along with the parent
- Foreign key constraints are disabled by default; execute `PRAGMA foreign_keys = ON` when connecting

```sql
-- When parent record is deleted, related child records are also deleted
task_id INTEGER NOT NULL
  REFERENCES tasks (id) ON DELETE CASCADE

-- Parent record protection — deletion forbidden when child records exist (default behavior)
flow_id INTEGER NOT NULL
  REFERENCES flows (id)
```

### NOT NULL and DEFAULT

- Generally set columns to `NOT NULL` unless `NULL` carries specific business meaning
- `DEFAULT` and `NOT NULL` have different semantics; do not conflate them

```sql
-- ✅ Column does not allow null, no default value (must be provided on insert)
session_id TEXT NOT NULL

-- ✅ Column does not allow null, has default value
status TEXT NOT NULL DEFAULT 'pending'

-- ✅ Column allows null, no default value (NULL has business meaning)
closed_at TEXT  -- NULL means not yet closed

-- ✅ Column allows null, has default value
priority TEXT DEFAULT 'medium'
```

### Type Selection

SQLite uses type affinity; explicitly using standard type names is recommended:

| Scenario | Recommended Type | Notes |
|------|---------|------|
| Primary key / auto-increment ID | `INTEGER` | Leverages rowid optimization |
| Boolean | `INTEGER NOT NULL DEFAULT 0` | 0 = false, 1 = true |
| Short text / enum | `TEXT` | All character data |
| Long text / JSON | `TEXT` | Use with `json_extract()` / `json_set()` |
| Timestamp | `TEXT` | ISO 8601 format, e.g. `2026-06-26T00:00:00Z` |
| Float | `REAL` | IEEE 754 double precision |
| Binary | `BLOB` | File content / serialized data |
| Array / list | `TEXT` (store as JSON) | SQLite has no native arrays; use JSON arrays |

```sql
-- JSON array column
tags TEXT NOT NULL DEFAULT '[]',  -- JSON array, default empty
-- Query: SELECT * FROM tasks WHERE json_extract(tags, '$[0]') = 'urgent';
```

### Audit Columns

Every business table should include the following audit columns:

```sql
created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
modified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
```

### Common Operational Columns

| Column | Type | Description |
|------|------|------|
| `deleted` | `INTEGER NOT NULL DEFAULT 0` | Soft delete flag, 0=normal 1=deleted |
| `seq` | `INTEGER NOT NULL DEFAULT 0` | Sort order, used with reorder interfaces |
| `tags` | `TEXT NOT NULL DEFAULT '[]'` | Tags in JSON array format, for easy filtering |

### Table Creation Conventions

- Use `CREATE TABLE IF NOT EXISTS` instead of `DROP + CREATE`
- Prefer `STRICT` mode for new projects (SQLite 3.37+)

```sql
-- SQLite 3.37+ STRICT mode (recommended)
CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  flow       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  modified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  deleted    INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT tasks_session_id_flow_uk UNIQUE (session_id, flow)
) STRICT;
```

## DML Conventions

### Keywords and Formatting

- Break clauses onto new lines to maintain alignment and improve readability
- Do not use single-letter abbreviations for aliases (except `SELECT COUNT(*) FROM (...) AS c`)

```sql
-- ✅ Recommended: clear aliases
SELECT t.id,
       t.session_id,
       t.flow,
       t.status
  FROM tasks AS t
  LEFT JOIN task_steps AS ts ON ts.task_id = t.id
 WHERE t.status = 'running';

-- ❌ Avoid: meaningless short aliases
SELECT a.id, a.nm, a.st
  FROM tasks AS a;
```

### Parameterized Queries

- **Strictly prohibit** string concatenation to construct SQL; always use parameterized queries
- Use `?` as parameter placeholders (bun:sqlite style)

```typescript
// ✅ Parameterized query
db.query('SELECT * FROM tasks WHERE session_id = ? AND status = ?', [
  sessionId,
  status,
]);

// ❌ String concatenation
db.query(`SELECT * FROM tasks WHERE session_id = '${sessionId}'`);
```

### Inline SQL

- When constructing SQL in code, preserve newlines and indentation for easier debugging

```typescript
const sql = [
  'SELECT t.id, t.session_id, t.flow',
  '  FROM tasks AS t',
  ' WHERE t.status = ?',
  '   AND t.created_at > ?',
  ' ORDER BY t.created_at DESC',
].join('\n');
```

### INSERT Statements

- Explicitly specify column names; do not rely on column order

```sql
-- ✅ Explicit column names
INSERT INTO tasks (session_id, flow, status)
VALUES (?, ?, 'running');

-- ❌ Omitting column names (fragile, order-dependent)
INSERT INTO tasks VALUES (?, ?, 'running');
```

### Batch Operations

- Wrap batch inserts in transactions for significantly improved performance

```typescript
const insert = db.prepare('INSERT INTO tasks (session_id, flow) VALUES (?, ?)');
const insertMany = db.transaction((items: Array<{ sessionId: string; flow: string }>) => {
  for (const item of items) {
    insert.run(item.sessionId, item.flow);
  }
});
insertMany(items);
```

## Migration Conventions

- Migration scripts follow the naming pattern `V{sequence}__{description}.sql`
- Use `CREATE TABLE IF NOT EXISTS` for table creation instead of DROP then CREATE
- Add columns using `ALTER TABLE ... ADD COLUMN` (SQLite limitation: no DROP COLUMN / ALTER COLUMN support)
- Migrations already applied in production **must not be modified**; create a new migration when changes are needed

## SQLite-Specific Best Practices

| Item | Recommendation | Notes |
|------|------|------|
| WAL Mode | Enable | `PRAGMA journal_mode=WAL;` improves concurrent read performance |
| Foreign Keys | Enable | `PRAGMA foreign_keys=ON;` must be executed per connection |
| Busy Timeout | Set | `PRAGMA busy_timeout=5000;` avoids SQLITE_BUSY |
| Strict Mode | Enable (3.37+) | `STRICT` tables disallow implicit type conversion |
| Connection Pool | Single connection | SQLite writes are serial; multiple connections provide no benefit; single connection + WAL is optimal |

## Anti-Patterns

| Anti-Pattern | Why It's Bad |
|--------|-----------|
| `SELECT *` | Column changes make code fragile; wastes IO |
| String concatenation for SQL | SQL injection risk |
| Querying large tables without indexes | Full table scan, poor performance |
| `DROP TABLE + CREATE TABLE` instead of ALTER | Risk of data loss |
| Composite primary keys | Complex foreign key references; poor ORM support |
| Column names using SQL keywords | Must be quoted; error-prone |
| Storing numbers/booleans as `TEXT` | Sorting/comparison behavior does not match expectations |

## Example: Complete Table Creation

```sql
CREATE TABLE IF NOT EXISTS tasks (
  -- Primary key
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  -- Business columns
  session_id  TEXT NOT NULL,
  flow        TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'running',
  -- Timestamps
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  modified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- Soft delete
  deleted     INTEGER NOT NULL DEFAULT 0,
  -- Constraints
  CONSTRAINT tasks_session_id_flow_uk UNIQUE (session_id, flow)
) STRICT;

-- Indexes
CREATE INDEX idx_tasks_session_id ON tasks (session_id);
CREATE INDEX idx_tasks_status ON tasks (status) WHERE deleted = 0;
```
