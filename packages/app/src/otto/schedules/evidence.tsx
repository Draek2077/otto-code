import { Text, View } from "react-native";
import { SettingsCard, SettingsCollapsibleRow } from "@/components/settings";
import { styles } from "./styles";

/** Full audit data remains explicit inspection, not the default operational page. */
export function ScheduleEvidence({ label, value }: { label: string; value: unknown }) {
  return (
    <SettingsCard>
      <SettingsCollapsibleRow label={label}>
        <View style={styles.content}>
          <Text selectable style={styles.code}>
            {JSON.stringify(value, null, 2)}
          </Text>
        </View>
      </SettingsCollapsibleRow>
    </SettingsCard>
  );
}
