import { useCallback, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  activityMethods,
  activityPluginId,
  ActivitySummarySchema,
  UsageLogPageSchema,
  type ActivityCounter,
  type ActivityCounts,
  type ActivityPeriod,
  type UsageEvent,
} from "@getpaseo/protocol/otto/activity";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectField } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";

type Tab = "providers" | "summary" | "log";
const tabs = [
  { value: "providers" as const, label: "Providers" },
  { value: "summary" as const, label: "Activity" },
  { value: "log" as const, label: "Log" },
];
const periods = [
  { value: "today" as const, label: "Today" },
  { value: "yesterday" as const, label: "Yesterday" },
  { value: "last7Days" as const, label: "7 days" },
  { value: "last30Days" as const, label: "30 days" },
  { value: "allTime" as const, label: "All time" },
];
const periodOptions = periods.map(({ value, label }) => ({ value, label, id: value }));
const usageRows: [string, ActivityCounter, ActivityCounter, ActivityCounter?][] = [
  ["Chat", "mainChatTokensIn", "mainChatTokensOut", "mainChatCostMicroUsd"],
  ["Generations", "generationsTokensIn", "generationsTokensOut", "generationsCostMicroUsd"],
  ["Subagents", "subagentTokensIn", "subagentTokensOut", "subagentCostMicroUsd"],
  ["Compaction", "compactionTokensIn", "compactionTokensOut"],
];
const activityRows: [ActivityCounter, string][] = [
  ["messagesSent", "Messages sent"],
  ["messagesReceived", "Replies"],
  ["agentsCreated", "Chats created"],
  ["subagentsInvoked", "Subagents invoked"],
  ["runsOrchestrated", "Runs started"],
  ["backgroundTasksInvoked", "Background tasks started"],
  ["toolsCalled", "Tools called"],
  ["thoughts", "Reasoning turns"],
  ["artifactsCreated", "Artifacts created"],
  ["schedulesExecuted", "Schedules executed"],
];
const number = new Intl.NumberFormat();
const price = new Intl.NumberFormat(undefined, {
  currency: "USD",
  style: "currency",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

function cost(value: number): string {
  return value > 0 ? price.format(value / 1e6) : "—";
}

function activityKey(serverId: string) {
  return [activityPluginId, serverId] as const;
}

function useActivityAction(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  return useCallback(
    (method: string, request: unknown) => {
      if (!client) throw new Error("Reconnect to the host and try again.");
      return client.invokePluginRpc(activityPluginId, method, request);
    },
    [client],
  );
}

function QueryMessage({ failure, refresh }: { failure: unknown; refresh: () => void }) {
  if (!failure) return <Text accessibilityLiveRegion="polite">Loading activity…</Text>;
  return (
    <View style={styles.section}>
      <Alert
        variant="error"
        description={failure instanceof Error ? failure.message : "Couldn't read activity."}
      />
      <Button size="sm" variant="outline" onPress={refresh}>
        Retry
      </Button>
    </View>
  );
}

function ResetActivity({ serverId, onReset }: { serverId: string; onReset: () => void }) {
  const request = useActivityAction(serverId);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => request(activityMethods.reset, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: activityKey(serverId) });
      onReset();
    },
  });
  const reset = useCallback(async () => {
    if (mutation.isPending) return;
    if (
      await confirmDialog({
        title: "Reset activity for this host?",
        message: "This clears both the activity totals and the saved usage log.",
        confirmLabel: "Reset",
        destructive: true,
      })
    )
      mutation.mutate();
  }, [mutation]);
  return (
    <View style={styles.section}>
      {mutation.error ? <Alert variant="error" description={mutation.error.message} /> : null}
      {mutation.isSuccess ? <Text accessibilityLiveRegion="polite">Activity reset.</Text> : null}
      <Button variant="outline" size="sm" disabled={mutation.isPending} onPress={reset}>
        {mutation.isPending ? "Resetting…" : "Reset activity"}
      </Button>
    </View>
  );
}

function tokenCounts(input: number, output: number): string {
  return `${number.format(input)} in · ${number.format(output)} out`;
}

function UsageBreakdown({ counts }: { counts: ActivityCounts }) {
  return (
    <SettingsCard>
      <SettingsRow label="Total">
        <Text style={styles.value}>
          {tokenCounts(counts.tokensSent ?? 0, counts.tokensReceived ?? 0)}
        </Text>
        <Text style={styles.value}>{cost(counts.costMicroUsd ?? 0)}</Text>
      </SettingsRow>
      {usageRows.map(([label, input, output, priceKey]) => {
        const tokensIn = counts[input] ?? 0;
        const tokensOut = counts[output] ?? 0;
        const reportedCost = priceKey ? (counts[priceKey] ?? 0) : 0;
        if (tokensIn === 0 && tokensOut === 0 && reportedCost === 0) return null;
        return (
          <SettingsRow key={label} label={label}>
            <Text style={styles.value}>{tokenCounts(tokensIn, tokensOut)}</Text>
            {reportedCost > 0 ? <Text style={styles.value}>{cost(reportedCost)}</Text> : null}
          </SettingsRow>
        );
      })}
    </SettingsCard>
  );
}

function Summary({ serverId }: { serverId: string }) {
  const [period, setPeriod] = useState<ActivityPeriod>("today");
  const request = useActivityAction(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const query = useFetchQuery({
    queryKey: [...activityKey(serverId), "summary"],
    enabled: connected,
    dataShape: "value",
    staleTimeMs: 15_000,
    queryFn: async () => ActivitySummarySchema.parse(await request(activityMethods.summary, {})),
    refetchInterval: 15_000,
  });
  const { refetch } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const data = query.data?.[period];
  if (!data) return <QueryMessage failure={query.error} refresh={refresh} />;
  return (
    <View style={styles.section}>
      <SelectField
        label="Period"
        value={period}
        selectedDisplay={periodOptions.find((option) => option.value === period) ?? null}
        options={periodOptions}
        onChange={setPeriod}
        placeholder="Period"
        emptyText="No periods"
        searchable={false}
        field={false}
        size="sm"
      />
      <SettingsSection title="Usage">
        <UsageBreakdown counts={data} />
      </SettingsSection>
      <SettingsSection title="Activity">
        <SettingsCard>
          {activityRows.map(([key, label]) => (
            <SettingsRow key={key} label={label}>
              <Text style={styles.value}>{number.format(data[key] ?? 0)}</Text>
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>
      <ResetActivity serverId={serverId} onReset={refresh} />
    </View>
  );
}

interface Cursor {
  at: number;
  id: string;
}
function LogRow({ event }: { event: UsageEvent }) {
  const label = [event.provider, event.model].filter(Boolean).join(" · ");
  const classification = event.subtype ?? event.kind;
  const totals = tokenCounts(event.tokensIn, event.tokensOut);
  const cached =
    event.cachedTokensIn && event.cachedTokensIn > 0
      ? ` · ${number.format(event.cachedTokensIn)} cached`
      : "";
  return (
    <SettingsRow label={label} hint={`${classification} · ${new Date(event.at).toLocaleString()}`}>
      <View style={styles.rowData}>
        <Text style={styles.value}>
          {totals}
          {cached}
        </Text>
        <Text style={styles.value}>{cost(event.costMicroUsd)}</Text>
        {event.rounds && event.rounds > 1 ? (
          <Text style={styles.value}>{number.format(event.rounds)} model requests</Text>
        ) : null}
      </View>
    </SettingsRow>
  );
}

function Log({ serverId }: { serverId: string }) {
  const [pages, setPages] = useState<Cursor[]>([]);
  const before = pages.at(-1);
  const request = useActivityAction(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const query = useFetchQuery({
    queryKey: [...activityKey(serverId), "log", before ?? null],
    enabled: connected,
    dataShape: "value",
    staleTimeMs: 15_000,
    queryFn: async () => UsageLogPageSchema.parse(await request(activityMethods.log, { before })),
    refetchInterval: !before ? 15_000 : false,
  });
  const { refetch } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const earlier = useCallback(() => {
    const next = query.data?.next;
    if (next) setPages((current) => [...current, next]);
  }, [query.data?.next]);
  const later = useCallback(() => setPages((current) => current.slice(0, -1)), []);
  const resetPage = useCallback(() => setPages([]), []);
  if (!query.data) return <QueryMessage failure={query.error} refresh={refresh} />;

  return (
    <View style={styles.section}>
      {query.data.events.length > 0 ? (
        <SettingsCard>
          {query.data.events.map((event) => (
            <LogRow key={event.id} event={event} />
          ))}
        </SettingsCard>
      ) : (
        <Text style={styles.value}>No recorded usage for this page.</Text>
      )}
      <View style={styles.controls}>
        <Button size="sm" variant="outline" disabled={pages.length === 0} onPress={later}>
          Newer
        </Button>
        <Button size="sm" variant="outline" disabled={!query.data.next} onPress={earlier}>
          Older
        </Button>
      </View>
      <ResetActivity serverId={serverId} onReset={resetPage} />
    </View>
  );
}

export function ActivityUsageTabs({
  serverId,
  visible,
  children,
}: {
  serverId: string;
  visible: boolean;
  children: ReactNode;
}) {
  const supported = useHostFeature(serverId, "ottoActivity");
  const [tab, setTab] = useState<Tab>("providers");
  if (!supported) return children;
  return (
    <View style={styles.section}>
      <SegmentedControl options={tabs} value={tab} onValueChange={setTab} size="sm" />
      {tab === "providers" ? children : null}
      {visible && tab === "summary" ? <Summary serverId={serverId} /> : null}
      {visible && tab === "log" ? <Log serverId={serverId} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: { gap: theme.spacing[3] },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  rowData: { gap: theme.spacing[1], alignItems: "flex-end", flexShrink: 1 },
  value: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
