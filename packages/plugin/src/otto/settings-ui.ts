import type { ComponentType, ReactNode } from "react";

/** Otto's plugin bridge renders the app's existing Paseo controls. */
export declare const SettingsButton: ComponentType<{
  children: ReactNode;
  onPress(): void;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "sm" | "md";
}>;
export declare const SettingsExpander: ComponentType<{
  label: string;
  children: ReactNode;
  defaultExpanded?: boolean;
}>;
