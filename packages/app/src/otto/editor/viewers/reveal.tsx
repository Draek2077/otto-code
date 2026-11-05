import { useState, useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";
import { resolveEditorReadTarget } from "../read-target";
/** Uses the existing native file-manager bridge only for its actual local host. */
export function EditorRevealFile({
  serverId,
  file,
  root,
}: {
  serverId: string;
  file: string;
  root: string;
}) {
  const active = useRetainedPanelActive(),
    visible = useAppVisible(),
    local = useIsLocalDaemon(serverId);
  const { targets } = useDesktopOpenTargets({ isLocalExecution: local && active && visible });
  const target = targets.find((value) => value.kind === "file-manager");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const authority = useRef({ active: true });
  useEffect(() => {
    const current = { active: true };
    authority.current = current;
    return () => {
      current.active = false;
    };
  }, [file, serverId]);
  const reveal = useCallback(async () => {
    if (busy || !target || !local) return;
    const current = authority.current,
      paths = resolveEditorReadTarget({ path: file, workspaceRoot: root });
    if (!paths) return;
    setBusy(true);
    setError(null);
    try {
      await openDesktopTarget({
        editorId: target.id,
        workspacePath: paths.cwd,
        filePath: paths.path,
      });
    } catch (failure) {
      if (current.active)
        setError(failure instanceof Error ? failure.message : "The file could not be revealed.");
    } finally {
      if (current.active) setBusy(false);
    }
  }, [busy, target, local, file, root]);
  if (!target || !local) return null;
  return (
    <View>
      {error ? <Alert variant="error" description={error} /> : null}
      <Button variant="outline" size="sm" loading={busy} onPress={reveal}>
        Reveal in {target.label}
      </Button>
    </View>
  );
}
