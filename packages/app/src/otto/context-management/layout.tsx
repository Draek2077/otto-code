import React, { Children, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { styles } from "./styles";

/** The inspected source stays in view while the desktop graph scrolls independently. */
export function ContextLayout({ compact, children }: { compact: boolean; children: ReactNode }) {
  const [navigation, preview] = Children.toArray(children);
  if (compact)
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        {navigation}
        {preview}
      </ScrollView>
    );
  return (
    <View style={[styles.content, styles.desktop]}>
      <View style={styles.split}>
        <ScrollView style={styles.tree} contentContainerStyle={styles.paneContent}>
          {navigation}
        </ScrollView>
        <ScrollView style={styles.detail} contentContainerStyle={styles.paneContent}>
          {preview}
        </ScrollView>
      </View>
    </View>
  );
}
