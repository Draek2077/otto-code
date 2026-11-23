import type { ComponentType } from "react";
import type { PluginScreenProps, PluginSurfaceProps, PluginSidebarItemProps } from "./contracts.js";

/** OTTO(brain-ui): only the built-in Brain installation receives this app-owned renderer. */
export declare const BrainScreen: ComponentType<PluginScreenProps>;
export declare const BrainSettings: ComponentType<PluginSurfaceProps>;
export declare const BrainSidebar: ComponentType<PluginSidebarItemProps>;
