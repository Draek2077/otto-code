import { useTranslation } from "react-i18next";
import { BookOpen } from "@/components/icons/material-icons";
import { ContextManagementPanel } from "@/context-management/panel";
import type { PanelDescriptor, PanelRegistration } from "./panel-registry";

function useContextManagementPanelDescriptor(): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: t("workspace.contextManagement.tabLabel"),
    subtitle: t("workspace.contextManagement.subtitle"),
    titleState: "ready",
    // Not Gauge — that reads as Metrics, which owns it in the stats nav and settings.
    icon: BookOpen,
    statusBucket: null,
  };
}

export const contextManagementPanelRegistration: PanelRegistration<"contextManagement"> = {
  kind: "contextManagement",
  component: ContextManagementPanel,
  useDescriptor: useContextManagementPanelDescriptor,
  // Nothing unsaved lives in this panel itself — the embedded file pane owns
  // its own buffer and dirty-state prompting.
  confirmClose() {
    return Promise.resolve(true);
  },
};
