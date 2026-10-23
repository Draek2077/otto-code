import { useMemo, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useBrainPreferences } from "../context";
export function ChatWidthBounds({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const { contentMaxWidth, outlinePadding } = useBrainPreferences();
  const bounds = useMemo(
    () => [style, { maxWidth: contentMaxWidth ?? undefined }],
    [style, contentMaxWidth],
  );
  const inset = useMemo(() => ({ paddingHorizontal: outlinePadding }), [outlinePadding]);
  return (
    <View style={bounds}>
      <View style={inset}>{children}</View>
    </View>
  );
}
