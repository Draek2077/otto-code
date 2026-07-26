// A 0-100% volume slider settings row: label + hint on the left, slider and
// percent readout on the right.
//
// One component rather than a copy per channel because the volume rows sit
// directly beneath each other in the same card, and two sliders of visibly
// different widths in one card reads as a bug. It was: with the label block and
// the slider field both on `flexBasis: "auto"`, the label's *intrinsic* width
// competed with the slider's, so a row with a longer hint got a narrower slider
// and squeezed its percent readout off the end. The field is therefore a fixed
// basis and unshrinkable, and the label block — which can wrap — absorbs the
// difference. Hint length is now free to vary.
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Slider } from "@/components/ui/slider";
import { settingsStyles } from "@/styles/settings";

const VOLUME_ROW = [settingsStyles.rowResponsive, settingsStyles.rowBorder];

interface SettingsVolumeRowProps {
  title: string;
  hint: string;
  /** Current committed value, 0-100. */
  value: number;
  /** Called once per gesture, on release — not on every tick of the drag. */
  onCommit: (next: number) => void;
  accessibilityLabel: string;
  testID: string;
  rowTestID?: string;
}

export function SettingsVolumeRow({
  title,
  hint,
  value,
  onCommit,
  accessibilityLabel,
  testID,
  rowTestID,
}: SettingsVolumeRowProps) {
  // Drag updates a local draft (live feedback + percent readout) and only
  // commits on release, so a gesture is one write rather than one per tick.
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleSlidingComplete = useCallback(
    (next: number) => {
      onCommit(next);
    },
    [onCommit],
  );

  return (
    <View style={VOLUME_ROW} testID={rowTestID}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <View style={styles.volumeField}>
        <Slider
          min={0}
          max={100}
          step={5}
          value={draft}
          onValueChange={setDraft}
          onSlidingComplete={handleSlidingComplete}
          accessibilityLabel={accessibilityLabel}
          testID={testID}
        />
        <Text style={styles.volumeValue}>{draft}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  volumeField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    // Fixed at `sm`+ so every volume row's slider is the same length whatever
    // its hint says; full width when `rowResponsive` stacks at `xs`. Neither
    // grows nor shrinks — the label block absorbs the leftover width, and it is
    // the one that can wrap.
    flexGrow: 0,
    flexShrink: 0,
    width: { xs: "100%", sm: "auto" },
    // min == max at `sm`+ pins the field to exactly 220 regardless of what the
    // slider and readout would ask for on their own.
    minWidth: { xs: 0, sm: 220 },
    maxWidth: 220,
    marginLeft: { xs: 0, sm: theme.spacing[4] },
  },
  volumeValue: {
    // Never squeezed out: the number is the only place the exact level is
    // legible, and the slider is meaningless without it.
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 40,
    textAlign: "right",
  },
}));
