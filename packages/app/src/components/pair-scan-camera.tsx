import { useCallback } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { BarcodeScanningResult, BarcodeSettings } from "expo-camera";

// Platform seam for the pair-scan QR camera. expo-camera must only be
// imported on native: its web build spawns a Web Worker at module-import time
// that importScripts() jsQR from a CDN, which the desktop CSP (script-src
// 'self') blocks — an uncaught NetworkError on every boot. The .web variant
// stubs this module out so expo-camera never enters the web bundle.

const BARCODE_SCANNER_SETTINGS: BarcodeSettings = { barcodeTypes: ["qr"] };

export const usePairScanCameraPermissions = useCameraPermissions;

export function PairScanCameraView({
  style,
  onScannedData,
}: {
  style?: StyleProp<ViewStyle>;
  onScannedData: (data: string) => void;
}) {
  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (typeof result.data === "string") {
        onScannedData(result.data);
      }
    },
    [onScannedData],
  );

  return (
    <CameraView
      style={style}
      facing="back"
      barcodeScannerSettings={BARCODE_SCANNER_SETTINGS}
      onBarcodeScanned={handleBarcodeScanned}
    />
  );
}
