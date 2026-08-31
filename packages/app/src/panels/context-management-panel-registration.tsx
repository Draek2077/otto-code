import { useTranslation } from "react-i18next";
import { ContextualToken } from "@/components/icons/material-icons";
import { ContextManagementPanel } from "@/context-management/panel";
import type { PanelDescriptor } from "./panel-registry";
import { definePanel } from "@/panels/panel-registry";

function useContextManagementPanelDescriptor(): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: t("workspace.contextManagement.tabLabel"),
    tooltip: t("workspace.contextManagement.tabLabel"),
    subtitle: t("workspace.contextManagement.subtitle"),
    titleState: "ready",
    icon: ContextualToken,
    statusBucket: null,
  };
}

export const contextManagementPanelRegistration = definePanel("contextManagement", {
  component: ContextManagementPanel,
  useDescriptor: useContextManagementPanelDescriptor,
  // Nothing unsaved lives in this panel itself - the embedded file pane owns
  // its own buffer and dirty-state prompting.
  confirmClose() {
    return Promise.resolve(true);
  },
});
