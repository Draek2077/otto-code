import { createContext, useContext, useMemo } from "react";
import { Image, Text, View, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { useAssistantImage } from "@/assistant-image/use-assistant-image";
import { getAssistantImageMetadata } from "@/utils/assistant-image-metadata";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { ChatImageContextMenuTarget } from "@/chat/image-context-menu";
import { ChatImagePreview } from "@/components/chat-image-preview";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export const AssistantImageWidthContext = createContext<number | null>(null);

/** Otto thumbnail geometry and image actions compose the upstream acquisition lifecycle. */
export function AssistantMarkdownImage({
  source,
  occurrenceKey,
  alt,
  hasLeadingContent,
  client,
  workspaceRoot,
  serverId,
}: {
  source: string;
  occurrenceKey: string;
  alt?: string;
  hasLeadingContent: boolean;
  client?: DaemonClient | null;
  workspaceRoot?: string;
  serverId?: string;
}) {
  const image = useAssistantImage({ source, occurrenceKey, client, workspaceRoot, serverId });
  const measuredWidth = useContext(AssistantImageWidthContext);
  const { width: windowWidth } = useWindowDimensions();
  const binding = image.status === "failed" ? null : image.binding;
  const aspectRatio = image.status === "failed" ? null : image.aspectRatio;
  const metadata = getAssistantImageMetadata({ source, workspaceRoot, serverId });
  // Content-sized bubbles need an explicit image width. Fit the measured column,
  // cap portrait previews at 400px, and never upscale known natural dimensions.
  const availableWidth =
    measuredWidth && measuredWidth > 0
      ? measuredWidth
      : Math.min(MAX_CONTENT_WIDTH, windowWidth > 0 ? windowWidth - 24 : MAX_CONTENT_WIDTH);
  const width = Math.max(
    1,
    Math.min(
      availableWidth,
      metadata?.width ?? availableWidth,
      aspectRatio ? 400 * aspectRatio : availableWidth,
    ),
  );
  const height = aspectRatio ? width / aspectRatio : 160;
  const frameStyle = useMemo(
    () => [styles.frame, { width, marginTop: hasLeadingContent ? 16 : 0 }],
    [hasLeadingContent, width],
  );
  const imageStyle = useMemo(() => [styles.image, { width, height }], [height, width]);
  const imageSource = useMemo(() => ({ uri: binding?.uri ?? "" }), [binding?.uri]);

  if (image.status === "failed") {
    return (
      <View style={frameStyle}>
        <Text style={styles.error}>{image.message}</Text>
      </View>
    );
  }
  const preview = (
    <View style={frameStyle}>
      {binding ? (
        <ChatImagePreview uri={binding.uri} style={imageStyle}>
          <Image
            ref={binding.onRef}
            source={imageSource}
            style={imageStyle}
            resizeMode="contain"
            accessibilityLabel={alt}
            onLoad={binding.onLoad}
            onError={binding.onError}
          />
          {image.status === "loading" ? (
            <View pointerEvents="none" style={styles.loading}>
              <LoadingSpinner size="small" />
            </View>
          ) : null}
        </ChatImagePreview>
      ) : (
        <View style={imageStyle}>
          <LoadingSpinner size="small" />
        </View>
      )}
    </View>
  );
  return image.attachment ? (
    <ChatImageContextMenuTarget attachment={image.attachment} previewUrl={binding?.uri ?? null}>
      {preview}
    </ChatImageContextMenuTarget>
  ) : (
    preview
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    overflow: "hidden",
    borderRadius: theme.borderRadius.md,
  },
  image: { borderRadius: theme.borderRadius.md, overflow: "hidden" },
  loading: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  error: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
