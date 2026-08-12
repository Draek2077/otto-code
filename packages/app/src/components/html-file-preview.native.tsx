import { useMemo } from "react";
import { StyleSheet } from "react-native-unistyles";
import { WebView } from "react-native-webview";

/** Native equivalent of the web iframe: the document runs in its own browser surface. */
export function HtmlFilePreview({ content }: { content: string; title: string }) {
  const source = useMemo(() => ({ html: content }), [content]);
  return <WebView originWhitelist={["*"]} source={source} style={styles.frame} javaScriptEnabled />;
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    minHeight: 0,
  },
});
