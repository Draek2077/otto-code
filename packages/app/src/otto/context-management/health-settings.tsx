import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { SettingsSwitch } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { contextHealthPreferences } from "./health-preferences";
export function ContextHealthSettings({ active }: { active: boolean }) {
  const [model] = useState(contextHealthPreferences);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => {
    if (active) void model.load();
  }, [active, model]);
  const change = useCallback(
    (enabled: boolean) => {
      void model.setEnabled(enabled);
    },
    [model],
  );
  const reload = useCallback(() => {
    void model.reload();
  }, [model]);
  return (
    <>
      <SettingsSwitch
        label="Composer context warnings"
        hint="Warn when fixed instructions use at least 25% of a known model window, or required instructions are blocked. Dismissals last eight hours unless severity or size changes."
        value={state.enabled}
        onValueChange={change}
        disabled={!active || !state.loaded || !state.writable || state.pending}
      />
      {state.error ? (
        <Alert variant="error" description={state.error}>
          <Button size="xs" variant="outline" onPress={reload} disabled={!active || state.pending}>
            Reload warning preference
          </Button>
        </Alert>
      ) : null}
    </>
  );
}
