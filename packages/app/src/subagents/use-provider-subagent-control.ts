import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { providerSubagentKey, useProviderSubagentStore } from "./provider-store";
import { controlProviderSubagent } from "./provider-subagent-control";

export function useProviderSubagentControl(serverId: string) {
  const { t } = useTranslation();
  const toast = useToast();
  return useCallback(
    (parentAgentId: string, subagentId: string, action: "stop" | "archive") => {
      void (async () => {
        try {
          const child = useProviderSubagentStore
            .getState()
            .descriptors.get(providerSubagentKey(serverId, parentAgentId, subagentId));
          const stopParent = child?.status === "running" && child.stopScope === "parent";
          if (stopParent || action === "archive") {
            const confirmed = await confirmDialog({
              title: stopParent
                ? t("subagents.stopParentTitle")
                : t("subagents.dialogs.archive.title"),
              message: stopParent
                ? t("subagents.stopParentMessage")
                : t("subagents.dialogs.archive.message", {
                    subject: child?.title ?? t("subagents.dialogs.subjectFallback"),
                  }),
              confirmLabel: stopParent
                ? t("subagents.stopParentConfirm")
                : t("subagents.dialogs.archive.confirm"),
              cancelLabel: t("common.actions.cancel"),
              destructive: true,
            });
            if (!confirmed) return;
          }
          await controlProviderSubagent(serverId, parentAgentId, subagentId, action, stopParent);
        } catch (error) {
          toast.error(toErrorMessage(error));
        }
      })();
    },
    [serverId, t, toast],
  );
}
