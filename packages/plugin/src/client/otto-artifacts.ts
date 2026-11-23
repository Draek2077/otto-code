import type { ComponentType } from "react";
import type {
  PluginScreenProps,
  PluginSurfaceProps,
  PluginWorkspacePanelProps,
} from "./contracts.js";
/** Only the trusted built-in receives this app-owned, cross-platform preview boundary. */
export declare const ArtifactsScreen: ComponentType<PluginScreenProps>;
export declare const ArtifactsWorkspace: ComponentType<PluginWorkspacePanelProps>;
export declare const ArtifactsSettings: ComponentType<PluginSurfaceProps>;
