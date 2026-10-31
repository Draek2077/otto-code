import { useCallback, useState } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import type { WakePreferences } from "./preferences";
export function useWakePreferences() {
  const { settings, updateSettings } = useAppSettings();
  const [error, setError] = useState("");
  const save = useCallback(
    (patch: Partial<WakePreferences>) => {
      setError("");
      void updateSettings(patch).catch(() =>
        setError("The Hey Otto preference could not be saved. Try again."),
      );
    },
    [updateSettings],
  );
  return { settings, save, error };
}
