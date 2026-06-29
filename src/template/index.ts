export {
  scanTemplates,
  installTemplate,
  uninstallFlow,
  listInstalledFlows,
  getPluginTemplateDir,
  TemplateConflictError,
} from './template-manager.js';
export { writeDcpConfig } from '../integration/index.js';
export type { TemplateMeta } from './types.js';
