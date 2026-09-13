import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getConnectorIconSvg } from "@/components/connector-icons";
import { settingsStyles } from "@/styles/settings";

const ThemedConnectorSvg = withUnistyles(SvgXml, (theme) => ({
  width: theme.iconSize.lg,
  height: theme.iconSize.lg,
  color: theme.colors.foreground,
}));

/** Shared name and artwork for catalog rows and installed connector cards. */
export function ConnectorIdentity({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <View style={[settingsStyles.rowContent, styles.identity]}>
      <View
        style={styles.icon}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <ThemedConnectorSvg xml={getConnectorIconSvg(id)} />
      </View>
      <View style={styles.text}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  identity: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    minWidth: 0,
  },
  icon: {
    width: theme.iconSize.lg,
    height: theme.iconSize.lg,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
}));
