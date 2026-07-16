import type { StyleProp, ViewStyle } from "react-native";

// QR pairing is native-only (pair-scan renders its "use the mobile app" card
// before ever reaching the camera), and importing expo-camera on web spawns a
// CSP-blocked CDN worker at module load — see the base file. These stubs keep
// expo-camera out of the web bundle entirely.

const requestPermission = () => Promise.resolve(null);
const PERMISSION_TUPLE = [null, requestPermission] as const;

export function usePairScanCameraPermissions(): readonly [
  { granted: boolean } | null,
  () => Promise<{ granted: boolean } | null>,
] {
  return PERMISSION_TUPLE;
}

export function PairScanCameraView(_props: {
  style?: StyleProp<ViewStyle>;
  onScannedData: (data: string) => void;
}) {
  return null;
}
