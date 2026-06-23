# 编码风格

> ⚠️ **重要 — 务必读取**：以下各语言的编码风格文件是本项目的强制规范。
> 在编写或修改任何代码之前，**必须**先读取当前语言对应的具体文件。
>
> 当前项目检测到的语言：TypeScript

## 通用规则

- 统一使用 UTF-8 编码，换行符使用 LF
- 代码注释使用英文
- 在系统边界（用户输入、外部 API）进行输入校验
- 所有错误必须显式处理
- 优先使用提前返回，减少嵌套层级

## 语言特定规范

请务必阅读以下与当前项目语言对应的编码规范文件：

| 语言 | 编码规范 |
|------|---------|
| TypeScript | [typescript.md](./coding_style/typescript.md) |
| Python | [python.md](./coding_style/python.md) |
| Go | [go.md](./coding_style/go.md) |
| Rust | [rust.md](./coding_style/rust.md) |
| Java | [java.md](./coding_style/java.md) |
| 通用 | [general.md](./coding_style/general.md) |
