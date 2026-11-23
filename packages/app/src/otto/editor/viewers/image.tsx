import { useMemo, useState, useCallback, useId } from "react";
import { Image, View, Text } from "react-native";
import Svg, { Defs, Pattern, Rect, SvgXml } from "react-native-svg";
import { Buffer } from "buffer";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { ExplorerFile } from "@/stores/session-store";
import { ZoomableViewport } from "@/components/zoomable-viewport";
import { ZoomableImage } from "@/components/zoomable-viewport/image";
import { readImageDimensions } from "./image-dimensions";
import { isNative } from "@/constants/platform";

const CheckerRect = withUnistyles(Rect);
const background = (theme: Theme) => ({ fill: theme.colors.surface0 });
const square = (theme: Theme) => ({ fill: theme.colors.surface2 });
/** Preserve Paseo's native pinch, web wheel/pan and toolbar. Otto contributes
 * header-derived dimensions, natural-size fitting and an image-only checker. */
export function EditorImagePreview({ uri, file }: { uri: string; file: ExplorerFile }) {
  const id = useId().replaceAll(":", "");
  const source = useMemo(() => ({ uri }), [uri]);
  const svg = useMemo(
    () =>
      isNative && file.mimeType === "image/svg+xml" && file.encoding === "base64" && file.content
        ? Buffer.from(file.content, "base64").toString("utf8")
        : null,
    [file.mimeType, file.encoding, file.content],
  );
  const size = useMemo(
    () =>
      file.content && file.encoding === "base64"
        ? readImageDimensions(Buffer.from(file.content, "base64"), file.mimeType)
        : null,
    [file.content, file.encoding, file.mimeType],
  );
  const fit = useMemo(
    () => (size ? { maxWidth: size.width, maxHeight: size.height } : undefined),
    [size],
  );
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  if (failed)
    return (
      <View style={styles.error}>
        <Text style={styles.message}>This image could not be displayed.</Text>
      </View>
    );
  if (!size)
    return svg ? (
      <View style={styles.root}>
        <SvgXml xml={svg} width="100%" height="100%" onError={fail} />
      </View>
    ) : (
      <ZoomableImage uri={uri} onError={fail} testID="image-file-preview" />
    );
  return (
    <ZoomableViewport
      contentSize={size}
      fit={fit}
      wheelActivation="modifier"
      testID="image-file-preview"
    >
      <Svg width="100%" height="100%" style={styles.checker} pointerEvents="none">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={16} height={16}>
            <CheckerRect width={16} height={16} uniProps={background} />
            <CheckerRect width={8} height={8} uniProps={square} />
            <CheckerRect x={8} y={8} width={8} height={8} uniProps={square} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {svg ? (
        <SvgXml xml={svg} width="100%" height="100%" onError={fail} />
      ) : (
        <Image
          source={source}
          resizeMode="contain"
          onError={fail}
          style={styles.image}
          testID="image-file-preview-image"
        />
      )}
    </ZoomableViewport>
  );
}
const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0 },
  checker: { position: "absolute", left: 0, top: 0 },
  image: { width: "100%", height: "100%" },
  error: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing[4] },
  message: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
