export {
  MemoryCommandAdapter,
  type MemoryCommandAdapterOptions,
} from "./memory-command-adapter.js";
export {
  V2CommandValidationError,
  type V2CreateMemoryCommand,
  type V2UpdateMemoryCommand,
  type V2LifecycleCommand,
  type V2CommandValidationIssue,
} from "./types.js";
export {
  validateCreateMemory,
  validateUpdateMemory,
  validateLifecycle,
} from "./validate.js";
export {
  createCoreRuntime,
  probeCoreDatabase,
  resolveCoreDatabaseUrl,
  type CoreRuntime,
  type CreateCoreRuntimeOptions,
} from "./core-runtime.js";
export {
  DesktopHost,
  getDesktopHost,
  resetDesktopHostForTests,
  invokeDesktopCommand,
  type DesktopMemoryCommand,
  type DesktopHostStartOptions,
} from "./desktop-host.js";
export {
  startDesktopBridgeServer,
  DEFAULT_DESKTOP_HOST_PORT,
  type DesktopBridgeServer,
} from "./desktop-bridge-server.js";

