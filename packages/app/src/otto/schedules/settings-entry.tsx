import { useMemo } from "react";
import { ScrollView, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { ScheduleActivity } from "./activity";
import { bindScheduleHost } from "./host-api";
import { useScheduleAvailability } from "./availability";
import { ScheduleStorage } from "./storage";
import { styles } from "./styles";

export function ScheduleProjectSettings({
  serverId,
  projectId,
}: {
  serverId: string;
  projectId: string;
}) {
  const hostIds = useMemo(() => [serverId], [serverId]);
  const available = useScheduleAvailability(hostIds).get(serverId) === true;
  const visible = useAppVisible(),
    retained = useRetainedPanelActive();
  const { api } = useMemo(() => bindScheduleHost(serverId), [serverId]);
  if (!available) return null;
  return (
    <ScheduleActivity.Provider value={visible && retained}>
      <View style={styles.settings}>
        <ScheduleStorage
          key={`${serverId}/${projectId}`}
          api={api}
          hostId={serverId}
          projectId={projectId}
          showDefault={false}
        />
      </View>
    </ScheduleActivity.Provider>
  );
}
export function SchedulesSettings(props: PluginSurfaceProps) {
  const hostIds = useMemo(() => [props.host.id], [props.host.id]);
  const available = useScheduleAvailability(hostIds).get(props.host.id) === true;
  const visible = useAppVisible(),
    retained = useRetainedPanelActive();
  const { api } = useMemo(() => bindScheduleHost(props.host.id), [props.host.id]);
  if (!available) return <SettingsRow label="Update the host to configure Schedules storage." />;
  return (
    <ScheduleActivity.Provider value={visible && retained && props.active === true}>
      <ScrollView style={styles.pane} contentContainerStyle={styles.settings}>
        <ScheduleStorage key={props.host.id} api={api} hostId={props.host.id} projectId={null} />
      </ScrollView>
    </ScheduleActivity.Provider>
  );
}
