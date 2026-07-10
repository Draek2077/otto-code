import {
  BottomSheetModal as GorhomBottomSheetModal,
  type BottomSheetModalProps,
} from "@gorhom/bottom-sheet";
import React from "react";
import { forwardRef, useCallback, useEffect, useMemo, useRef } from "react";
import type { ElementRef } from "react";
import { FLOATING_LAYER_NO_DRAG_STYLE } from "@/components/desktop/app-region";
import {
  type BottomSheetController,
  createBottomSheetVisibilityTracker,
} from "./visibility-tracker";

type GorhomBottomSheetModalMethods = ElementRef<typeof GorhomBottomSheetModal>;

type IsolatedBottomSheetModalProps = Omit<
  BottomSheetModalProps,
  "enableDismissOnClose" | "stackBehavior"
> & {
  presentation?: "push" | "replace";
};

export type IsolatedBottomSheetModalRef = GorhomBottomSheetModalMethods;

export const IsolatedBottomSheetModal = forwardRef<
  IsolatedBottomSheetModalRef,
  IsolatedBottomSheetModalProps
>(function IsolatedBottomSheetModal(props, ref) {
  const { children, presentation = "push", containerStyle, ...bottomSheetProps } = props;
  // Gorhom sheets render through @gorhom/portal INSIDE #root, outside both
  // no-drag backstop rules in index.html — without this carve-out a presented
  // sheet is click-dead wherever it overlaps an Electron drag rect (titlebar
  // strips, the New Workspace screen's full-screen drag overlay). The hosting
  // container is a full-screen view that exists only while the sheet is
  // presented, so this can't punch persistent holes in the drag strip.
  const resolvedContainerStyle = useMemo(
    () =>
      FLOATING_LAYER_NO_DRAG_STYLE
        ? [containerStyle, FLOATING_LAYER_NO_DRAG_STYLE]
        : containerStyle,
    [containerStyle],
  );
  const modal = (
    <GorhomBottomSheetModal
      {...bottomSheetProps}
      ref={ref}
      containerStyle={resolvedContainerStyle}
      enableDismissOnClose
      stackBehavior={presentation}
    >
      {children}
    </GorhomBottomSheetModal>
  );

  return modal;
});

export function useIsolatedBottomSheetVisibility({
  visible,
  isEnabled,
  onClose,
}: {
  visible: boolean;
  isEnabled?: boolean;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const tracker = useMemo(
    () => createBottomSheetVisibilityTracker({ onClose: () => onCloseRef.current() }),
    [],
  );

  const setSheetRef = useCallback(
    (instance: IsolatedBottomSheetModalRef | null) => {
      tracker.attachController(instance as BottomSheetController | null);
    },
    [tracker],
  );

  const handleSheetChange = useCallback(
    (index: number) => tracker.handleSheetIndexChange(index),
    [tracker],
  );

  const handleSheetDismiss = useCallback(() => tracker.handleSheetDismiss(), [tracker]);

  useEffect(() => {
    tracker.syncDesired({ visible, isEnabled });
  }, [isEnabled, tracker, visible]);

  return {
    sheetRef: setSheetRef,
    handleSheetChange,
    handleSheetDismiss,
  };
}
