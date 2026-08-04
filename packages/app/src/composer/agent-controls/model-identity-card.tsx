import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ModelIdentity } from "@/composer/agent-controls/model-identity";

interface IdentityRowProps {
  label: string;
  value: string;
}

function IdentityRow({ label, value }: IdentityRowProps): ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1} ellipsizeMode="tail">
        {value}
      </Text>
    </View>
  );
}

interface ModelIdentityCardProps {
  identity: ModelIdentity;
  /** The picker's action hint, kept as the footer line so the affordance survives. */
  hint: string;
}

/**
 * The model picker's hover card: who is answering, on what, and how. Reads like
 * a personality identity card but stays a tooltip - no icons, no color, no
 * interaction, just the headline and the four facts that decide a turn.
 * Rows that don't apply (no personality, no effort levels, no modes) are
 * dropped rather than shown empty.
 * TODO(i18n): inline English row labels, translated in a later pass.
 */
export function ModelIdentityCard({ identity, hint }: ModelIdentityCardProps): ReactElement {
  return (
    <View style={styles.card}>
      <Text style={styles.name} numberOfLines={2} ellipsizeMode="tail">
        {identity.name}
      </Text>
      <View style={styles.rows}>
        {identity.modelLabel ? <IdentityRow label="Model" value={identity.modelLabel} /> : null}
        {identity.providerLabel ? (
          <IdentityRow label="Provider" value={identity.providerLabel} />
        ) : null}
        <IdentityRow label="Class" value={identity.classLabel} />
        {identity.effortLabel ? <IdentityRow label="Effort" value={identity.effortLabel} /> : null}
        {identity.modeLabel ? <IdentityRow label="Mode" value={identity.modeLabel} /> : null}
        {/*
          A statement, not a field: full-width prose with no label column, so it
          cannot be skimmed as another attribute of the selection above, let
          alone as a second picker. Only present when the provider actually ran
          a different model than the one selected (see resolveRuntimeModelFact).
        */}
        {identity.runtimeModelLabel ? (
          <Text style={styles.note} numberOfLines={2}>
            {`Last turn ran on ${identity.runtimeModelLabel}`}
          </Text>
        ) : null}
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  rows: {
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  rowLabel: {
    width: 56,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  rowValue: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  note: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingTop: theme.spacing[1],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingTop: theme.spacing[1],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
}));
