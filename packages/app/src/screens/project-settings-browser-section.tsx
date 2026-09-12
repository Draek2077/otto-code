import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHostFeature } from "@/runtime/host-features";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";

export function ProjectBrowserSection({
  serverId,
  projectId,
  client,
}: {
  serverId: string;
  projectId: string;
  client: DaemonClient;
}) {
  const supported = useHostFeature(serverId, "browserHistory");
  const toast = useToast();
  const busy = useRef(false);
  const [clearing, setClearing] = useState(false);
  const clear = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setClearing(true);
    try {
      if (
        !(await confirmDialog({
          title: "Clear browsing history?",
          message:
            "Remove visited URLs for this project on this host, across all its workspaces. Cookies, site data, and open tabs are kept.",
          confirmLabel: "Clear history",
          cancelLabel: "Cancel",
          destructive: true,
        }))
      )
        return;
      await client.clearBrowserHistory(projectId);
      toast.show("Browsing history cleared.", { variant: "success" });
    } catch {
      toast.error("Could not clear browsing history.");
    } finally {
      busy.current = false;
      setClearing(false);
    }
  }, [client, projectId, toast]);
  return (
    <SettingsSection title="Browser">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Browsing history</Text>
            <Text style={settingsStyles.rowHint}>
              {supported
                ? "Visited URLs are saved on this host for this project and suggested in the browser address bar."
                : "Update the host to use browsing history."}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            disabled={!supported || clearing}
            loading={clearing}
            onPress={clear}
          >
            Clear browsing history
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}
