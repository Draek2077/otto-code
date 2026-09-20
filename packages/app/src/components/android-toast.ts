/**
 * The Android system toast, behind a module boundary.
 *
 * `react-native-web` has no `ToastAndroid` export, so naming it in a shared
 * module breaks every web build - including any browser test whose import graph
 * reaches the toast host, which then has to mock the host away to load at all.
 * Metro and Vite both pick the `.native` file on native, so the web bundle never
 * sees the import.
 */
export function showAndroidToast(_message: string, _durationMs: number | null): boolean {
  return false;
}
