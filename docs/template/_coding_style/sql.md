# SQL 编码风格

> 本项目使用 SQLite (bun:sqlite) 作为嵌入式数据库。以下规范适配 SQLite 特性，同时兼容通用 SQL 最佳实践。

## 通用格式

- 统一使用 UTF-8 编码，换行符使用 LF
- SQL 关键字**全部大写**（`SELECT`、`FROM`、`WHERE`、`INSERT` 等）
- 缩进使用 2 空格
- 行长度建议不超过 100 字符

```sql
SELECT t.id,
       t.name,
       t.created_at
  FROM tasks AS t
 WHERE t.status = 'active'
   AND t.created_at > ?
 ORDER BY t.created_at DESC;
```

## 命名规范

### 数据库名 / Schema 名

- 使用 `snake_case`，全小写
- 例：`vibe_pm`

### 表名

- 使用 `snake_case`，复数形式（表示集合）
- 例：`tasks`、`task_steps`、`flow_definitions`
- 不使用拼音，使用统一的英文名词
- 避开 SQL 关键字（如 `order`、`group`、`select`），避免加 quote

### 字段名

- 使用 `snake_case`，全小写
- 例：`session_id`、`created_at`、`is_active`
- 布尔字段用疑问词前缀：`is_active`、`has_plan`、`can_proceed`
- 主键统一使用 `id`
- 外键格式：`{referenced_table}_id`（如 `task_id` 引用 `tasks.id`）

### 约束命名

约束名格式清晰，便于调试时快速定位：

| 约束类型 | 命名格式 | 示例 |
|---------|---------|------|
| 主键 | `{table}_{column}_pkey` | `tasks_id_pkey` |
| 唯一约束 | `{table}_{column1}_{column2}_uk` | `tasks_session_id_flow_uk` |
| 外键 | `{table}_{referenced_table}_fk` | `task_steps_task_fk` |
| 索引 | `idx_{table}_{column1}_{column2}` | `idx_tasks_status_created_at` |

```sql
-- 主键约束
CREATE TABLE tasks (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  CONSTRAINT tasks_session_id_flow_uk UNIQUE (session_id, flow)
);

-- 外键约束
CREATE TABLE task_steps (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL
    REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT task_steps_task_fk FOREIGN KEY (task_id) REFERENCES tasks (id)
);

-- 索引
CREATE INDEX idx_tasks_session_id ON tasks (session_id);
CREATE INDEX idx_tasks_status_created_at ON tasks (status, created_at);
```

## DDL 规范

### 主键

- 使用 `INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT`（SQLite 首推荐方式）
- **不使用联合主键**，有复合唯一需求时定义 `UNIQUE` 约束
- SQLite 中 `INTEGER PRIMARY KEY` 自动成为 rowid 别名，性能最优

```sql
-- ✅ 推荐
CREATE TABLE tasks (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ...
);

-- ❌ 避免
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,  -- TEXT 主键无 rowid 优化
  ...
);
```

### 外键

- 外键列类型必须与被引用列类型一致
- 子表记录随主表删除时，加 `ON DELETE CASCADE`
- 外键约束默认不开启，需在连接时执行 `PRAGMA foreign_keys = ON`

```sql
-- 主表记录删除时，关联子表记录也删除
task_id INTEGER NOT NULL
  REFERENCES tasks (id) ON DELETE CASCADE

-- 主表记录保护，有子表记录时禁止删除（默认行为）
flow_id INTEGER NOT NULL
  REFERENCES flows (id)
```

### NOT NULL 与 DEFAULT

- 除非 `NULL` 具有特定业务含义，否则字段一般设为 `NOT NULL`
- `DEFAULT` 与 `NOT NULL` 语义不同，不能混用

```sql
-- ✅ 字段不允许为空，无默认值（插入时必须提供）
session_id TEXT NOT NULL

-- ✅ 字段不允许为空，有默认值
status TEXT NOT NULL DEFAULT 'pending'

-- ✅ 字段允许为空，无默认值（NULL 有业务含义）
closed_at TEXT  -- NULL 表示未关闭

-- ✅ 字段允许为空，有默认值
priority TEXT DEFAULT 'medium'
```

### 类型选择

SQLite 使用类型亲和性（Type Affinity），推荐显式使用标准类型名：

| 场景 | 推荐类型 | 说明 |
|------|---------|------|
| 主键/自增 ID | `INTEGER` | 利用 rowid 优化 |
| 布尔值 | `INTEGER NOT NULL DEFAULT 0` | 0 = false, 1 = true |
| 短文本/枚举 | `TEXT` | 所有字符数据 |
| 长文本/JSON | `TEXT` | 配合 `json_extract()` / `json_set()` |
| 时间戳 | `TEXT` | ISO 8601 格式，如 `2026-06-26T00:00:00Z` |
| 浮点数 | `REAL` | IEEE 754 双精度 |
| 二进制 | `BLOB` | 文件内容/序列化数据 |
| 数组/列表 | `TEXT`（存 JSON） | SQLite 无原生数组，用 JSON 数组替代 |

```sql
-- JSON 数组字段
tags TEXT NOT NULL DEFAULT '[]',  -- JSON 数组默认空
-- 查询: SELECT * FROM tasks WHERE json_extract(tags, '$[0]') = 'urgent';
```

### 审计字段

每张业务表应包含以下审计字段：

```sql
created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
modified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
```

### 通用操作字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `deleted` | `INTEGER NOT NULL DEFAULT 0` | 软删除标记，0=正常 1=已删除 |
| `seq` | `INTEGER NOT NULL DEFAULT 0` | 排序序号，配合调整顺序接口使用 |
| `tags` | `TEXT NOT NULL DEFAULT '[]'` | 标签，JSON 数组格式，方便筛选过滤 |

### 建表规范

- 使用 `CREATE TABLE IF NOT EXISTS`，不用 `DROP + CREATE`
- 新项目（SQLite 3.37+）优先使用 `STRICT` 模式

```sql
-- SQLite 3.37+ STRICT 模式（推荐）
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

## DML 规范

### 关键字与格式

- 子句换行，保持对齐，提高可读性
- 别名（alias）不使用单字母缩写（除 `SELECT COUNT(*) FROM (...) AS c` 外）

```sql
-- ✅ 推荐：清晰的别名
SELECT t.id,
       t.session_id,
       t.flow,
       t.status
  FROM tasks AS t
  LEFT JOIN task_steps AS ts ON ts.task_id = t.id
 WHERE t.status = 'running';

-- ❌ 避免：无意义的短别名
SELECT a.id, a.nm, a.st
  FROM tasks AS a;
```

### 参数化查询

- **严禁**字符串拼接构造 SQL，全部使用参数化查询
- 参数占位符使用 `?`（bun:sqlite 风格）

```typescript
// ✅ 参数化查询
db.query('SELECT * FROM tasks WHERE session_id = ? AND status = ?', [
  sessionId,
  status,
]);

// ❌ 字符串拼接
db.query(`SELECT * FROM tasks WHERE session_id = '${sessionId}'`);
```

### 内联 SQL

- 代码中拼接 SQL 时保留换行符和缩进，方便调试

```typescript
const sql = [
  'SELECT t.id, t.session_id, t.flow',
  '  FROM tasks AS t',
  ' WHERE t.status = ?',
  '   AND t.created_at > ?',
  ' ORDER BY t.created_at DESC',
].join('\n');
```

### INSERT 语句

- 显式指定列名，不依赖列顺序

```sql
-- ✅ 显式列名
INSERT INTO tasks (session_id, flow, status)
VALUES (?, ?, 'running');

-- ❌ 省略列名（脆弱，依赖列顺序）
INSERT INTO tasks VALUES (?, ?, 'running');
```

### 批量操作

- 批量插入使用事务包裹，大幅提高性能

```typescript
const insert = db.prepare('INSERT INTO tasks (session_id, flow) VALUES (?, ?)');
const insertMany = db.transaction((items: Array<{ sessionId: string; flow: string }>) => {
  for (const item of items) {
    insert.run(item.sessionId, item.flow);
  }
});
insertMany(items);
```

## 迁移规范

- 迁移脚本按 `V{序号}__{描述}.sql` 命名
- 建表使用 `CREATE TABLE IF NOT EXISTS`，不先 DROP 再 CREATE
- 添加列使用 `ALTER TABLE ... ADD COLUMN`（SQLite 限制：不支持 DROP COLUMN / ALTER COLUMN）
- 已在生产环境运行的迁移**不可修改**，有变更需求创建新迁移

## SQLite 特有最佳实践

| 项目 | 推荐 | 说明 |
|------|------|------|
| WAL 模式 | 开启 | `PRAGMA journal_mode=WAL;` 提升并发读性能 |
| 外键约束 | 开启 | `PRAGMA foreign_keys=ON;` 每次连接需执行 |
| 忙等待 | 设置 | `PRAGMA busy_timeout=5000;` 避免 SQLITE_BUSY |
| 严格模式 | 3.37+ 启用 | `STRICT` 表禁止隐式类型转换 |
| 连接池 | 单连接 | SQLite 写串行，多连接无益，单连接 + WAL 最佳 |

## 反模式

| 反模式 | 为什么不好 |
|--------|-----------|
| `SELECT *` | 列变更导致代码脆弱，浪费 IO |
| 字符串拼接 SQL | SQL 注入风险 |
| 不加索引的大表查询 | 全表扫描，性能差 |
| `DROP TABLE + CREATE TABLE` 代替 ALTER | 数据丢失风险 |
| 联合主键 | 外键引用复杂，ORM 支持差 |
| 字段名用 SQL 关键字 | 必须加 quote，容易出错 |
| `TEXT` 存数字/布尔 | 排序/比较行为不符合预期 |

## 示例：完整建表

```sql
CREATE TABLE IF NOT EXISTS tasks (
  -- 主键
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  -- 业务字段
  session_id  TEXT NOT NULL,
  flow        TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'running',
  -- 时间戳
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  modified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- 软删除
  deleted     INTEGER NOT NULL DEFAULT 0,
  -- 约束
  CONSTRAINT tasks_session_id_flow_uk UNIQUE (session_id, flow)
) STRICT;

-- 索引
CREATE INDEX idx_tasks_session_id ON tasks (session_id);
CREATE INDEX idx_tasks_status ON tasks (status) WHERE deleted = 0;
```
