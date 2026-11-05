import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { FileMarkdownPreview } from "@/file-pane/markdown-preview";
import { MermaidFence } from "@/components/markdown/fence/mermaid";
import { asciiDocToMarkdown } from "./asciidoc/asciidoc-to-markdown";

function AsciiDocPreview({
  source,
  ...context
}: {
  source: string;
  filePath: string;
  workspaceRoot: string;
  serverId: string;
  client: DaemonClient | null;
}) {
  const document = useMemo(() => asciiDocToMarkdown(source), [source]);
  return (
    <>
      {document.frontmatter ? (
        <View style={styles.metadata}>
          <Text selectable style={styles.key}>
            {document.frontmatter}
          </Text>
        </View>
      ) : null}
      <FileMarkdownPreview source={document.body} {...context} />
    </>
  );
}
/** Reuse Paseo's Markdown/Mermaid engine, isolation and zoom controls. AsciiDoc
 * includes stay visible directives; the preview never reads arbitrary files. */
export function EditorDocumentPreview({
  kind,
  source,
  ...context
}: {
  kind: "mermaid" | "asciidoc";
  source: string;
  filePath: string;
  workspaceRoot: string;
  serverId: string;
  client: DaemonClient | null;
}) {
  return (
    <ScrollView style={styles.frame} testID={`file-${kind}-preview`}>
      {kind === "mermaid" ? (
        <MermaidFence code={source} />
      ) : (
        <AsciiDocPreview source={source} {...context} />
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create((theme) => ({
  frame: { flex: 1, backgroundColor: theme.colors.surface0 },
  metadata: {
    margin: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
  },
  key: {
    padding: theme.spacing[3],
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
  },
}));
