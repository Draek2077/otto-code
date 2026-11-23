import type { ComponentType } from "react";
import type {
  PluginScreenProps,
  PluginSurfaceProps,
  PluginWorkspacePanelProps,
} from "./contracts.js";
/** Trusted built-in bridge; the SDK never imports the app or its canvas renderer. */
export declare const WorkflowsScreen: ComponentType<PluginScreenProps>;
export declare const WorkflowsWorkspace: ComponentType<PluginWorkspacePanelProps>;
export declare const WorkflowsSettings: ComponentType<PluginSurfaceProps>;
