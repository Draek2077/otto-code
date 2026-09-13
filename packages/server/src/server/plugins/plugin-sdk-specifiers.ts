// Shared author identities; compiler and app/server runtime maps use one table.
export {
  PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS,
  PLUGIN_SDK_SPECIFIERS,
  resolvePluginSdkSpecifier,
  isPluginSdkSpecifier,
  isPluginHostSdkSpecifier,
  isPluginClientOnlySdkSpecifier,
  isPluginServerOnlySdkSpecifier,
  type PluginSdkNamespace,
} from "@otto-code/plugin";
