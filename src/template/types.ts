/**
 * Template Manager 类型定义
 */

export interface TemplateMeta {
  id: string;
  name: string;
  category: string;
  description: string;
  version: string;
  /** 模板文件路径（flow.md） */
  flowPath: string;
  /** 模板 bundle 根目录 */
  bundleDir: string;
}
