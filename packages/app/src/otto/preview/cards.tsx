import React, { useCallback } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import type { PreviewServer, PreviewCommandSchema } from "@getpaseo/plugin/otto/preview";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert } from "@/components/ui/alert";
import { styles } from "./styles";
export type PreviewCommand = z.infer<typeof PreviewCommandSchema>;
export function CommandCard({
  command,
  busy,
  start,
}: {
  command: PreviewCommand;
  busy: boolean;
  start(command: PreviewCommand): void;
}) {
  const begin = useCallback(() => start(command), [command, start]);
  return (
    <SettingsCard>
      <SettingsRow label={command.name} hint={command.url}>
        <Button variant="outline" size="sm" onPress={begin} disabled={busy}>
          Start or reuse
        </Button>
      </SettingsRow>
      <SettingsRow label="Command" hint={command.command} />
    </SettingsCard>
  );
}
export function ServerCard({
  server,
  selected,
  busy,
  select,
}: {
  server: PreviewServer;
  selected: boolean;
  busy: boolean;
  select(id: string): void;
}) {
  const choose = useCallback(() => select(server.id), [select, server.id]);
  return (
    <SettingsCard>
      <SettingsRow
        label={server.name}
        hint={`${server.managed ? "Otto-owned" : "External"} · ${server.port}`}
      >
        <Button
          variant={selected ? "secondary" : "outline"}
          size="sm"
          disabled={busy}
          onPress={choose}
        >
          Logs and actions
        </Button>
      </SettingsRow>
      <SettingsRow label={server.url}>
        <StatusBadge
          label={server.status}
          variant={server.status === "error" ? "error" : "muted"}
        />
      </SettingsRow>
    </SettingsCard>
  );
}
export function ServerDetail({
  server,
  busy,
  stop,
  open,
  children,
}: {
  server: PreviewServer;
  busy: boolean;
  stop(server: PreviewServer): void;
  open(server: PreviewServer): void;
  children: React.ReactNode;
}) {
  const stopServer = useCallback(() => stop(server), [stop, server]);
  const openServer = useCallback(() => open(server), [open, server]);
  return (
    <SettingsSection
      title={server.name}
      info="The server and its designated browser remain independent. Closing its tab does not stop the process."
    >
      <SettingsCard>
        <SettingsRow label="Browser" hint={server.url}>
          <Button variant="outline" size="sm" onPress={openServer} disabled={busy}>
            Open browser
          </Button>
        </SettingsRow>
        <SettingsRow
          label={server.managed ? "Owned process tree" : "External process"}
          hint={
            server.managed
              ? "Only an explicit Stop or daemon shutdown stops this process."
              : "Otto did not start this process and cannot stop it."
          }
        >
          <Button
            variant="destructive"
            size="sm"
            onPress={stopServer}
            disabled={busy || !server.managed || server.status === "stopped"}
          >
            Stop
          </Button>
        </SettingsRow>
      </SettingsCard>
      {server.error ? <Alert variant="error" description={server.error} /> : null}
      {children}
    </SettingsSection>
  );
}
export function PreviewLogText({
  lines,
}: {
  lines: { sequence: number; source: string; text: string }[];
}) {
  return (
    <View>
      <Text selectable style={styles.code}>
        {lines.length
          ? lines.map((line) => `[${line.source}] ${line.text}`).join("\n")
          : "No matching output yet."}
      </Text>
    </View>
  );
}
