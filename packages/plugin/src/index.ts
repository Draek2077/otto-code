// Shared SDK entry. Keep runtime-specific imports and re-exports on /client or /server.
export {
  PLUGIN_SDK_NAMESPACES,
  PLUGIN_SDK_SPECIFIERS,
  PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS,
  resolvePluginSdkSpecifier,
  isPluginSdkSpecifier,
  isPluginHostSdkSpecifier,
  isPluginClientOnlySdkSpecifier,
  isPluginServerOnlySdkSpecifier,
  type PluginSdkNamespace,
} from "./runtime-specifiers.js";
export type {
  PluginTheme,
  PluginWorkspaceSnapshot,
  PluginAgentSnapshot,
  PluginThemeColors,
  PluginThemeContribution,
  PluginAttachmentSourceContribution,
  PluginTimelineData,
  PluginTimelineItem,
  PluginTimelineTransformResult,
  PluginCleanup,
} from "./contracts.js";
export { defineSettings, settingsRpc, type SettingsDefinition } from "./settings.js";
export {
  defineAttachmentSource,
  PluginAttachmentItemSchema,
  PluginAttachmentSearchPayloadSchema,
  type PluginAttachmentItem,
  type PluginAttachmentSearchPayload,
} from "./attachments.js";
export { defineRpc, type PluginRpcContract, type RpcInput, type RpcOutput } from "./rpc.js";
