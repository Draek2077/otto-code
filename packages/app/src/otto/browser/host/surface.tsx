import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useHostBrowserBinding } from "./ownership";
import { HostBrowserPane } from "./pane";
import { styles } from "./styles";
export function BrowserSurface(props: {
  browserId: string;
  serverId: string;
  workspaceId: string;
  cwd: string | null;
  isInteractive: boolean;
  onFocusPane(): void;
  children: ReactNode;
}) {
  const binding = useHostBrowserBinding(props.browserId);
  if (binding.phase === "loading")
    return (
      <View style={styles.message}>
        <Text style={styles.text}>Loading browser…</Text>
      </View>
    );
  if (binding.phase === "error")
    return (
      <View style={styles.message}>
        <Text style={styles.text}>{binding.message}</Text>
      </View>
    );
  if (!binding.value) return props.children;
  if (binding.value.hostId !== props.serverId || binding.value.workspaceId !== props.workspaceId)
    return (
      <View style={styles.message}>
        <Text style={styles.text}>This browser belongs to another host or workspace.</Text>
      </View>
    );
  return <HostBrowserPane {...props} />;
}
