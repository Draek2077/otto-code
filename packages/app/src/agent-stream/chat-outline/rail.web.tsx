import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { Pressable, Text, View, type PointerEvent as RNPointerEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useReducedMotion } from "react-native-reanimated";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { createChatOutlineHoverIntent } from "./hover-intent";
import { useChatOutlineLayout } from "./layout";
import {
  chatOutlineSegmentContains,
  chatOutlineSegmentLabel,
  MIN_OUTLINE_PROMPTS,
  promptTickMagnification,
  resolveChatOutlineGutter,
  segmentChatOutlinePrompts,
  type ChatOutlineSegment,
} from "./model";
import type { ChatOutlineRailProps } from "./rail";

// Hover tracking lives on the rail and the slots, never on the Pressable inside them:
// magnifying a slot must not move the box the pointer is resting on. See docs/hover.md.
const RAIL_WIDTH = 36;
const SLOT_HEIGHT = 8;
const MIN_PANEL_WIDTH = 918;
const RESTING_PILL_HEIGHT = 2;
const MAGNIFIED_PILL_HEIGHT = 4;
const RESTING_PILL_WIDTH = 10;
const ACTIVE_PILL_WIDTH = 18;
const MAGNIFIED_PILL_WIDTH = 26;
const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = 48;
const PREVIEW_GAP = 4;

/**
 * Whether the pane is wide enough for the rail, or `null` until it has a real
 * width. RN-web reports onLayout after paint, which painted one frame with the
 * wrong gutter; this reads the width before the first paint and commits resize
 * crossings synchronously from the observer, which also runs before paint. A
 * retained tab under `display: none` measures 0 and keeps its last answer.
 */
function usePaneIsWide(measureRef: RefObject<View | null>): boolean | null {
  const [isWide, setIsWide] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const node = measureRef.current as unknown as HTMLElement | null;
    if (!node) return;
    const apply = (width: number) => {
      if (width <= 0) return;
      const next = width >= MIN_PANEL_WIDTH;
      setIsWide((current) => (current === next ? current : next));
    };
    apply(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width;
      if (width !== undefined) flushSync(() => apply(width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [measureRef]);
  return isWide;
}

export const ChatOutlineRail = memo(function ChatOutlineRail({
  enabled,
  hasPromptIndex,
  prompts,
  activePrompt,
  onJumpToPrompt,
}: ChatOutlineRailProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const activeSeq = useSyncExternalStore(activePrompt.subscribe, activePrompt.getActiveSeq);
  const prefersReducedMotion = useReducedMotion();
  const measureRef = useRef<View>(null);
  const isPaneWide = usePaneIsWide(measureRef);
  const { isRailVisible: isGutterVisible, setRailVisible } = useChatOutlineLayout();

  const hoverIntent = useMemo(
    () =>
      createChatOutlineHoverIntent({
        activate: setHoveredIndex,
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: (timerId) => window.clearTimeout(timerId),
      }),
    [],
  );
  const handlePointerEnterTick = useCallback(
    (index: number) => hoverIntent.pointAt(index),
    [hoverIntent],
  );
  const handlePointerEnterRail = useCallback(
    (event: RNPointerEvent) => {
      hoverIntent.enter({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
    },
    [hoverIntent],
  );
  const handlePointerMoveRail = useCallback(
    (event: RNPointerEvent) => {
      hoverIntent.move({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
    },
    [hoverIntent],
  );
  const handlePointerLeaveRail = useCallback(() => hoverIntent.leave(), [hoverIntent]);
  useEffect(() => () => hoverIntent.dispose(), [hoverIntent]);
  const gutter = resolveChatOutlineGutter({
    enabled,
    hasPromptIndex,
    promptCount: prompts.length,
    isPaneWide,
  });
  // The rail is the gutter's only writer, and it writes before paint. An
  // unknown input leaves the gutter as it is rather than guessing.
  useLayoutEffect(() => {
    if (gutter !== null) setRailVisible(gutter);
  }, [gutter, setRailVisible]);
  useLayoutEffect(() => () => setRailVisible(false), [setRailVisible]);
  // Ticks follow the gutter itself, so the rail never draws outside its space.
  const isRailVisible = isGutterVisible && prompts.length >= MIN_OUTLINE_PROMPTS;
  useEffect(() => {
    if (!isRailVisible) hoverIntent.leave();
  }, [hoverIntent, isRailVisible]);
  const handleFocusChange = useCallback((index: number, focused: boolean) => {
    setFocusedIndex((current) => {
      if (focused) return index;
      return current === index ? null : current;
    });
  }, []);

  // The pointer owns the magnified band while it is on the rail; keyboard focus drives the
  // same band and the same preview once the pointer leaves.
  const attentionIndex = hoveredIndex ?? focusedIndex;
  const segments = useMemo(() => segmentChatOutlinePrompts(prompts), [prompts]);

  return (
    <View ref={measureRef} style={styles.panelMeasure} pointerEvents="box-none">
      {isRailVisible ? (
        <View
          style={styles.rail}
          role="tablist"
          testID="chat-outline-rail"
          onPointerEnter={handlePointerEnterRail}
          onPointerMove={handlePointerMoveRail}
          onPointerLeave={handlePointerLeaveRail}
        >
          {segments.map((segment, index) => (
            <ChatOutlineTick
              key={segment.startSeq}
              index={index}
              segment={segment}
              label={chatOutlineSegmentLabel(segment, prompts.length)}
              isActive={chatOutlineSegmentContains(segment, activeSeq)}
              hasAttention={index === attentionIndex}
              magnification={
                prefersReducedMotion || attentionIndex === null
                  ? 0
                  : promptTickMagnification(index - attentionIndex)
              }
              onHover={handlePointerEnterTick}
              onFocusChange={handleFocusChange}
              onJumpToPrompt={onJumpToPrompt}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
});

interface ChatOutlineTickProps {
  index: number;
  segment: ChatOutlineSegment;
  label: string;
  isActive: boolean;
  hasAttention: boolean;
  magnification: number;
  onHover: (index: number) => void;
  onFocusChange: (index: number, focused: boolean) => void;
  onJumpToPrompt: (seq: number) => void;
}

const ChatOutlineTick = memo(function ChatOutlineTick({
  index,
  segment,
  label,
  isActive,
  hasAttention,
  magnification,
  onHover,
  onFocusChange,
  onJumpToPrompt,
}: ChatOutlineTickProps) {
  const handlePress = useCallback(() => {
    onJumpToPrompt(segment.target.seq);
    onFocusChange(index, false);
  }, [index, onFocusChange, onJumpToPrompt, segment.target.seq]);
  const handlePointerEnter = useCallback(() => onHover(index), [index, onHover]);
  const handleFocus = useCallback(() => onFocusChange(index, true), [index, onFocusChange]);
  const handleBlur = useCallback(() => onFocusChange(index, false), [index, onFocusChange]);

  // The pill grows inside a slot that never moves, so magnification can never pull the hit
  // target out from under the pointer.
  const restingWidth = isActive ? ACTIVE_PILL_WIDTH : RESTING_PILL_WIDTH;
  const pillWidth = restingWidth + magnification * (MAGNIFIED_PILL_WIDTH - restingWidth);
  const pillHeight =
    RESTING_PILL_HEIGHT + magnification * (MAGNIFIED_PILL_HEIGHT - RESTING_PILL_HEIGHT);

  return (
    <View style={styles.slot} onPointerEnter={handlePointerEnter}>
      <Pressable
        style={styles.target}
        onPress={handlePress}
        onFocus={handleFocus}
        onBlur={handleBlur}
        accessibilityRole="tab"
        aria-selected={isActive}
        accessibilityLabel={label}
        testID={`chat-outline-tick-${segment.target.seq}`}
      >
        <View
          style={[
            styles.pill,
            isActive && styles.pillActive,
            hasAttention && styles.pillAttention,
            inlineUnistylesStyle({ width: pillWidth, height: pillHeight }),
          ]}
        />
      </Pressable>
      {hasAttention ? (
        <View style={styles.preview} pointerEvents="none" aria-hidden testID="chat-outline-preview">
          <Text style={styles.previewText} numberOfLines={2}>
            {segment.startIndex === segment.endIndex - 1
              ? segment.target.preview
              : `Prompts ${segment.startIndex + 1}–${segment.endIndex}: ${segment.target.preview}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  panelMeasure: {
    position: "absolute",
    inset: 0,
  },
  rail: {
    position: "absolute",
    left: theme.spacing[2],
    top: "10%",
    bottom: "10%",
    width: RAIL_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  // Slots tile the rail with no gaps, so every pixel of the column belongs to a prompt even
  // when a long conversation squeezes them well below their resting height.
  slot: {
    width: RAIL_WIDTH,
    flexBasis: SLOT_HEIGHT,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // Pills share one left rail and grow rightward, so magnification reads as a bulge moving
  // with the pointer instead of every tick breathing about its own centre.
  target: {
    width: "100%",
    height: "100%",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingLeft: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  // At rest the pills use low-emphasis chrome so the column stays readable peripherally
  // without competing with the transcript. Attention is the only foreground state.
  pill: {
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.borderAccent,
    transitionProperty: "width, height, background-color",
    transitionDuration: "140ms",
    transitionTimingFunction: "ease-out",
  },
  pillActive: {
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  pillAttention: {
    backgroundColor: theme.colors.foreground,
  },
  preview: {
    position: "absolute",
    left: RAIL_WIDTH + PREVIEW_GAP,
    top: "50%",
    marginTop: -PREVIEW_HEIGHT / 2,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    ...theme.shadow.md,
  },
  previewText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
