import { memo, useMemo } from "react";
import { View } from "react-native";
import type { PanelIconProps } from "@/panels/panel-registry";
import type { ComponentType } from "react";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { ChatSpinner } from "./spinner";
import { ChatStatusIcon } from "./status-icon";
import { isAttentionBucket } from "./status";
import type { SpinnerColors } from "./palette";

/** A chat's status replaces its provider glyph; idle/done restore that glyph without a badge. */
export const ChatTabIcon = memo(function ChatTabIcon({
  bucket,
  Icon,
  size,
  color,
  strokeWidth,
  spinnerColors,
}: {
  bucket: SidebarStateBucket | null;
  Icon: ComponentType<PanelIconProps>;
  size: number;
  color: string;
  strokeWidth?: number;
  spinnerColors?: SpinnerColors;
}) {
  const frame = useMemo(
    () => ({ width: size, height: size, alignItems: "center", justifyContent: "center" }) as const,
    [size],
  );
  let content = <Icon size={size} color={color} strokeWidth={strokeWidth} />;
  if (bucket === "running")
    content = (
      <View accessibilityRole="progressbar" accessibilityLabel="Agent running">
        <ChatSpinner
          size={size - 1}
          glowA={spinnerColors?.glowA}
          glowB={spinnerColors?.glowB}
          testID="otto-chat-tab-spinner"
        />
      </View>
    );
  else if (isAttentionBucket(bucket)) content = <ChatStatusIcon bucket={bucket} size={size} />;
  return <View style={frame}>{content}</View>;
});
