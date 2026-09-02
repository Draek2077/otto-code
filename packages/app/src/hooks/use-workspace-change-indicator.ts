import { useAppSettingValue, type AppSettings } from "@/hooks/use-settings";
import type { WorkspaceChangeIndicator } from "@/hooks/use-settings/otto-settings";

const selectWorkspaceChangeIndicator = (settings: AppSettings): WorkspaceChangeIndicator =>
  settings.workspaceChangeIndicator;

export function useWorkspaceChangeIndicator(): WorkspaceChangeIndicator {
  return useAppSettingValue(selectWorkspaceChangeIndicator);
}
