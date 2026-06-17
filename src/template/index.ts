export {
  scanTemplates,
  installTemplate,
  uninstallFlow,
  listInstalledFlows,
  TemplateConflictError,
} from "./template-manager.js";
export { writeDcpConfig } from "../integration/index.js";
export type { TemplateMeta } from "./types.js";
