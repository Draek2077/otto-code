import { useMemo, type ReactElement } from "react";
import { StyleSheet } from "react-native-unistyles";
import { WebView } from "react-native-webview";

export interface ArtifactHtmlViewProps {
  html: string;
}

// react-native-webview always allows "about:blank" (the origin of the initial
// source={{ html }} document) regardless of this list — it's only consulted
// for subsequent navigation attempts. An empty whitelist means the artifact
// can render itself but can't navigate the WebView to an external URL (e.g.
// via a clicked `<a>` or `location.href`).
const ORIGIN_WHITELIST: string[] = [];

/** Native renderer for artifact HTML. Runs in an isolated WebView. Artifacts are
 * LLM-generated and untrusted: JS execution is allowed for interactive
 * prototypes, but file-system/file-URL access and cross-origin navigation are
 * locked down, and the server-injected CSP (see html-validator.ts) blocks
 * network calls regardless of these props. */
export function ArtifactHtmlView({ html }: ArtifactHtmlViewProps): ReactElement {
  const source = useMemo(() => ({ html }), [html]);
  return (
    <WebView
      originWhitelist={ORIGIN_WHITELIST}
      source={source}
      style={styles.webview}
      // Artifacts may run their own JS; keep it enabled for interactive prototypes.
      javaScriptEnabled
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  webview: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
}));
