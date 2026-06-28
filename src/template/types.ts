/**
 * Template Manager type definitions
 */

export interface TemplateMeta {
  id: string;
  name: string;
  category: string;
  description: string;
  version: string;
  /** Associated slash command name (e.g., /pm-research) */
  command: string;
  /** Template file path (flow.md) */
  flowPath: string;
  /** Template bundle root directory */
  bundleDir: string;
}
