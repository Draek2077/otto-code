import type { ComponentType } from "react";
import type { PluginWorkspacePanelProps, PluginSurfaceProps } from "./contracts.js";
/** Trusted built-in presentation; no renderer internals are added to the SDK. */
export declare const VisualizerWorkspace: ComponentType<PluginWorkspacePanelProps>;
export declare const VisualizerSettings: ComponentType<PluginSurfaceProps>;
export declare function activateVisualizerTab(): Promise<void>;
