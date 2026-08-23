import React, { createContext, useContext, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { BottomSheetScrollView, BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import { SheetSurfaceModal } from "@/components/ui/sheet-chrome";
import { SheetHeaderView } from "@/components/adaptive-modal-sheet";
import type { ToolCallDetail } from "@otto-code/protocol/agent-types";
import { useIsolatedBottomSheetVisibility } from "@/components/ui/isolated-bottom-sheet-modal";
import type { ToolCallIconComponent } from "@/utils/tool-call-icon";
import { ToolCallDetailsContent } from "./tool-call-details";

// ----- Types -----

export interface ToolCallSheetData {
  displayName: string;
  summary?: string;
  detail?: ToolCallDetail;
  errorText?: string;
  icon: ToolCallIconComponent;
  showLoadingSkeleton?: boolean;
}

interface ToolCallSheetContextValue {
  openToolCall: (data: ToolCallSheetData) => void;
  closeToolCall: () => void;
}

// ----- Context -----

const ToolCallSheetContext = createContext<ToolCallSheetContextValue | null>(null);

export function useToolCallSheet(): ToolCallSheetContextValue {
  const context = useContext(ToolCallSheetContext);
  if (!context) {
    throw new Error("useToolCallSheet must be used within a ToolCallSheetProvider");
  }
  return context;
}

// ----- Provider Component -----

interface ToolCallSheetProviderProps {
  children: ReactNode;
}

export function ToolCallSheetProvider({ children }: ToolCallSheetProviderProps) {
  const [sheetData, setSheetData] = React.useState<ToolCallSheetData | null>(null);
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);

  const snapPoints = useMemo(() => ["60%", "95%"], []);

  const openToolCall = useCallback((data: ToolCallSheetData) => {
    setSheetData(data);
    setIsSheetOpen(true);
  }, []);

  const closeToolCall = useCallback(() => {
    setIsSheetOpen(false);
  }, []);

  const {
    sheetRef: bottomSheetRef,
    handleSheetChange,
    handleSheetDismiss,
  } = useIsolatedBottomSheetVisibility({
    visible: isSheetOpen,
    onClose: closeToolCall,
  });

  const handleToolCallSheetDismiss = useCallback(() => {
    handleSheetDismiss();
    setSheetData(null);
  }, [handleSheetDismiss]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    [],
  );

  const contextValue = useMemo(
    () => ({ openToolCall, closeToolCall }),
    [openToolCall, closeToolCall],
  );

  return (
    <ToolCallSheetContext.Provider value={contextValue}>
      {children}
      <SheetSurfaceModal
        ref={bottomSheetRef}
        contextBridge={null}
        snapPoints={snapPoints}
        index={0}
        enableDynamicSizing={false}
        onChange={handleSheetChange}
        onDismiss={handleToolCallSheetDismiss}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
      >
        {sheetData && <ToolCallSheetContent data={sheetData} onClose={closeToolCall} />}
      </SheetSurfaceModal>
    </ToolCallSheetContext.Provider>
  );
}

// ----- Sheet Content Component -----

interface ToolCallSheetContentProps {
  data: ToolCallSheetData;
  onClose: () => void;
}

function ToolCallSheetContent({ data, onClose }: ToolCallSheetContentProps) {
  const { theme } = useUnistyles();
  const { displayName, detail, errorText, icon: IconComponent, showLoadingSkeleton } = data;
  // The shared sheet header, not a hand-built one. This sheet used to carry its own title size,
  // weight, indent and close button, which is most of what made it read as a different app.
  const header = useMemo(
    () => ({
      title: displayName,
      leading: <IconComponent size={theme.iconSize.md} color={theme.colors.foreground} />,
    }),
    [IconComponent, displayName, theme.colors.foreground, theme.iconSize.md],
  );

  return (
    <View style={styles.container}>
      <SheetHeaderView header={header} onClose={onClose} />

      {/* Content */}
      <BottomSheetScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <ToolCallDetailsContent
          detail={detail}
          errorText={errorText}
          fillAvailableHeight
          showLoadingSkeleton={showLoadingSkeleton}
        />
      </BottomSheetScrollView>
    </View>
  );
}

// ----- Styles -----

const styles = StyleSheet.create(() => ({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  contentContainer: {
    padding: 0,
    flexGrow: 1,
  },
}));
