import { Platform, ToastAndroid } from "react-native";

/** Native half of the Android system toast; see `android-toast.ts`. */
export function showAndroidToast(message: string, durationMs: number | null): boolean {
  if (Platform.OS !== "android") return false;
  const duration =
    durationMs !== null && durationMs <= 2500 ? ToastAndroid.SHORT : ToastAndroid.LONG;
  ToastAndroid.showWithGravity(message, duration, ToastAndroid.TOP);
  return true;
}
