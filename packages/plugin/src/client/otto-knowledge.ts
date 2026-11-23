import type { ComponentType } from "react";
import type {
  PluginScreenProps,
  PluginSurfaceProps,
  PluginWorkspacePanelProps,
} from "./contracts.js";
/** App-owned Markdown/form surfaces. Only the trusted built-in receives this bridge. */
export declare const ProjectKnowledgeWorkspace: ComponentType<PluginWorkspacePanelProps>;
export declare const ProjectKnowledgeScreen: ComponentType<PluginScreenProps>;
export declare const ProjectKnowledgeSettings: ComponentType<PluginSurfaceProps>;

/** Optional until the supported app floor includes the Context Management bridge. */
export declare const ContextManagementWorkspace:
  | ComponentType<PluginWorkspacePanelProps>
  | undefined;
export declare const ContextManagementScreen: ComponentType<PluginScreenProps> | undefined;
