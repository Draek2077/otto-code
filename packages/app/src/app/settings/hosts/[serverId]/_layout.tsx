import { Stack } from "expo-router";
import { ThemedStack } from "@/navigation/themed-stack";

const SETTINGS_HOST_STACK_SCREEN_OPTIONS = {
  headerShown: false,
  animation: "none" as const,
};

// Owns the host-settings leaves (`index`, `[hostSection]`) so the `[serverId]`
// dynamic segment is matched by this layout before any leaf mounts. Registering
// these as grandchildren directly in the root layout — the previous shape — let
// a leaf mount without its local dynamic params on native, which renders a blank
// screen with no crash. See docs/expo-router.md ("Ownership" + "Startup"): each
// layout owns only the routes directly inside its directory, and a dynamic
// segment must have a layout boundary so its params exist before a nested leaf
// selects. This mirrors h/[serverId]/_layout.tsx.
export default function SettingsHostLayout() {
  return (
    <ThemedStack screenOptions={SETTINGS_HOST_STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[hostSection]" />
    </ThemedStack>
  );
}
