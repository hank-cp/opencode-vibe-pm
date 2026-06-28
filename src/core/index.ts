/**
 * Plugin Core Unified Exports
 */
export { VibePMPlugin } from './plugin.js';
export { loadConfig, DEFAULT_CONFIG, writeConfig, ensureDefaultConfig } from './config.js';
export { registerCommands, registerTools } from './commands.js';
export { logger } from './logger.js';
export type * from './types.js';
