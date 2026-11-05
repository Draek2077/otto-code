import { useMemo } from "react";
import { View } from "react-native";
import type { WorkflowSeat } from "@getpaseo/plugin/otto/workflows";
import { SettingsSelect } from "@/components/settings";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { styles } from "./styles";

function choices(
  rows: readonly { id: string; label: string }[] | undefined,
  selected: string | undefined,
) {
  const result = [
    { value: "", label: "Provider default" },
    ...(rows ?? []).map((row) => ({ value: row.id, label: row.label })),
  ];
  if (selected && !result.some((row) => row.value === selected))
    result.push({ value: selected, label: `${selected} (saved choice; not in current catalog)` });
  return result;
}
/** Reuse Paseo's canonical provider snapshot; catalog refresh never rewrites saved seat intent. */
export function WorkflowSeatOptions({
  seat,
  hostId,
  active,
  disabled,
  onMode,
  onThinking,
}: {
  seat: WorkflowSeat;
  hostId: string;
  active: boolean;
  disabled: boolean;
  onMode(value: string): void;
  onThinking(value: string): void;
}) {
  const { entries } = useProvidersSnapshot(hostId, { enabled: active });
  const provider = entries?.find((row) => row.provider === seat.provider);
  const model = provider?.models?.find((row) => row.id === seat.model);
  const modes = useMemo(
    () => choices(provider?.modes, seat.modeId),
    [provider?.modes, seat.modeId],
  );
  const thinking = useMemo(
    () => choices(model?.thinkingOptions, seat.thinkingOptionId),
    [model?.thinkingOptions, seat.thinkingOptionId],
  );
  return (
    <View style={styles.contentGap}>
      {modes.length > 1 ? (
        <SettingsSelect
          label="Provider permissions"
          value={seat.modeId ?? ""}
          options={modes}
          onValueChange={onMode}
          disabled={disabled}
        />
      ) : null}
      {thinking.length > 1 ? (
        <SettingsSelect
          label="Thinking"
          value={seat.thinkingOptionId ?? ""}
          options={thinking}
          onValueChange={onThinking}
          disabled={disabled}
        />
      ) : null}
    </View>
  );
}
