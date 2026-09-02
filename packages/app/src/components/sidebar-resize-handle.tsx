import type { ComponentProps } from "react";
import { View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import {
  resolveSidebarResizeHandleGeometry,
  type SidebarResizeEdge,
} from "@/components/sidebar-resize-handle-layout";
import { useResizeHandleHighlight } from "@/components/use-resize-handle-highlight";
import { isWeb } from "@/constants/platform";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";

interface SidebarResizeHandleProps {
  edge: SidebarResizeEdge;
  gesture: ComponentProps<typeof GestureDetector>["gesture"];
  pressed: boolean;
  testID: string;
}

const webResizeCursorStyle = isWeb
  ? ({
      cursor: "col-resize",
    } as object)
  : null;

function edgeOffsetStyle(edge: SidebarResizeEdge, edgeOffset: number) {
  return edge === "left" ? { left: edgeOffset } : { right: edgeOffset };
}

export function SidebarResizeHandle({ edge, gesture, pressed, testID }: SidebarResizeHandleProps) {
  const finePointer = useHasFinePointer();

  if (finePointer) {
    return <PointerResizeHandle edge={edge} gesture={gesture} pressed={pressed} testID={testID} />;
  }
  return <TouchResizeHandle edge={edge} gesture={gesture} pressed={pressed} testID={testID} />;
}

function PointerResizeHandle({ edge, gesture, testID }: SidebarResizeHandleProps) {
  const { highlighted, handleHoverIn, handleHoverOut } = useResizeHandleHighlight();
  const geometry = resolveSidebarResizeHandleGeometry(true);
  const hitAreaStyle = [
    styles.hitArea,
    { width: geometry.width },
    edgeOffsetStyle(edge, geometry.edgeOffset),
    webResizeCursorStyle,
  ];

  // A plain View, not a Pressable: react-native-web renders Pressable as a
  // tabIndex=0 div, and the global :focus-visible ring then outlines the whole
  // full-height hit band instead of the 1px seam. The drag lives on the
  // GestureDetector; this element only tracks hover, per docs/hover.md.
  return (
    <GestureDetector gesture={gesture}>
      <View
        testID={testID}
        role="separator"
        aria-orientation="vertical"
        style={hitAreaStyle}
        onPointerEnter={handleHoverIn}
        onPointerLeave={handleHoverOut}
      >
        {highlighted ? (
          <View
            pointerEvents="none"
            testID={`${testID}-highlight`}
            style={[styles.highlight, edge === "left" ? styles.leftEdgeHighlight : null]}
          />
        ) : null}
      </View>
    </GestureDetector>
  );
}

function TouchResizeHandle({ edge, gesture, pressed, testID }: SidebarResizeHandleProps) {
  const geometry = resolveSidebarResizeHandleGeometry(false);
  // `box-none` keeps the full-height column out of hit-testing so only the
  // grab target steals taps from the rows behind it.
  const layerStyle = [
    styles.touchLayer,
    { width: geometry.width },
    edgeOffsetStyle(edge, geometry.edgeOffset),
  ];
  const targetStyle = [
    styles.touchTarget,
    { width: geometry.width, height: geometry.height ?? undefined },
  ];
  const gripStyle = [
    styles.grip,
    edge === "left" ? styles.leftEdgeGrip : styles.rightEdgeGrip,
    pressed ? styles.visibleGrip : styles.hiddenGrip,
  ];

  return (
    <View pointerEvents="box-none" style={layerStyle}>
      <GestureDetector gesture={gesture}>
        <View
          testID={testID}
          role="separator"
          aria-orientation="vertical"
          collapsable={false}
          style={targetStyle}
        >
          <View pointerEvents="none" testID={`${testID}-grip`} style={gripStyle} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  hitArea: {
    position: "absolute",
    top: 0,
    bottom: 0,
    zIndex: 10,
  },
  highlight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 5,
    width: 1,
    backgroundColor: theme.colors.accent,
  },
  // A left-side border occupies the first pixel of its parent. The pointer hit
  // band starts from the padding box after that border, so its hover line must
  // move one pixel left to occupy the exact same seam rather than jumping
  // inward on hover.
  leftEdgeHighlight: {
    left: 4,
  },
  touchLayer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  touchTarget: {
    alignItems: "center",
    justifyContent: "center",
  },
  grip: {
    width: 4,
    height: 36,
    borderRadius: 2,
    backgroundColor: theme.colors.foreground,
  },
  hiddenGrip: {
    opacity: 0,
  },
  visibleGrip: {
    opacity: 0.3,
  },
  leftEdgeGrip: {
    alignSelf: "flex-start",
    marginLeft: theme.spacing[0.5],
  },
  rightEdgeGrip: {
    alignSelf: "flex-end",
    marginRight: theme.spacing[0.5],
  },
}));
