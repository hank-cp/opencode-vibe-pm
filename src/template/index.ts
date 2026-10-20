export {
  scanTemplates,
  installTemplate,
  installAllTemplates,
  uninstallFlow,
  listInstalledFlows,
  getPluginTemplateDir,
  installCodingStyleFromTemplate,
  TemplateConflictError,
} from './template-manager.js';
export type {
  TemplateMeta,
} from './types.js';
export type {
  InstallResult,
  InstallTemplateOptions,
  InstallAllFailure,
  InstallAllResult,
} from './template-manager.js';
