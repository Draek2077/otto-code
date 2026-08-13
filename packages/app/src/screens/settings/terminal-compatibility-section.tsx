import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type {
  TerminalCompatibilityDiagnosticCheck,
  TerminalCompatibilityDiagnosticResponse,
} from "@otto-code/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

type DiagnosticPayload = TerminalCompatibilityDiagnosticResponse["payload"];

function statusLabel(status: TerminalCompatibilityDiagnosticCheck["status"]): string {
  switch (status) {
    case "pass":
      return "PASS";
    case "fail":
      return "FAIL";
    case "warn":
      return "WARN";
    case "unknown":
      return "UNKNOWN";
  }
}

function DiagnosticCheckRow({ check }: { check: TerminalCompatibilityDiagnosticCheck }) {
  return (
    <View
      style={[settingsStyles.row, settingsStyles.rowBorder]}
      testID={`terminal-check-${check.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {statusLabel(check.status)} · {check.label}
        </Text>
        <Text style={settingsStyles.rowHint}>{check.detail}</Text>
        {check.evidence ? (
          <Text style={settingsStyles.rowHint}>Evidence: {check.evidence}</Text>
        ) : null}
      </View>
    </View>
  );
}

function DiagnosticSheet({
  payload,
  onClose,
}: {
  payload: DiagnosticPayload;
  onClose: () => void;
}) {
  const header = useMemo<SheetHeader>(() => ({ title: "Terminal compatibility results" }), []);
  const footer = useMemo(
    () => (
      <Button variant="secondary" size="sm" onPress={onClose} testID="terminal-diagnostic-close">
        Close
      </Button>
    ),
    [onClose],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      testID="terminal-diagnostic-sheet"
    >
      <View style={settingsStyles.card}>
        <Text style={settingsStyles.rowHint}>
          Read-only checks from the daemon host. Unknown means Otto could not verify the behavior,
          not that the host failed it.
        </Text>
        {payload.platform ? (
          <Text style={settingsStyles.rowHint}>Platform: {payload.platform}</Text>
        ) : null}
        {payload.term ? <Text style={settingsStyles.rowHint}>TERM: {payload.term}</Text> : null}
        {payload.termProgram ? (
          <Text style={settingsStyles.rowHint}>TERM_PROGRAM: {payload.termProgram}</Text>
        ) : null}
        {payload.checks.map((check) => (
          <DiagnosticCheckRow key={check.id} check={check} />
        ))}
      </View>
    </AdaptiveModalSheet>
  );
}

export function TerminalCompatibilitySection({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "terminalCompatibilityDiagnostic");
  const client = useHostRuntimeClient(serverId);
  const [isRunning, setIsRunning] = useState(false);
  const [payload, setPayload] = useState<DiagnosticPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostic = useCallback(async () => {
    if (!client || isRunning) return;
    setIsRunning(true);
    setError(null);
    try {
      const result = await client.runTerminalCompatibilityDiagnostic();
      setPayload(result);
    } catch (diagnosticError) {
      setError(
        diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      );
    } finally {
      setIsRunning(false);
    }
  }, [client, isRunning]);

  const closeResults = useCallback(() => setPayload(null), []);
  const handleRunDiagnostic = useCallback(() => {
    void runDiagnostic();
  }, [runDiagnostic]);

  if (!isConnected || !supported) return null;

  return (
    <>
      <SettingsSection title="Terminal compatibility">
        <View style={settingsStyles.card} testID="terminal-compatibility-card">
          <View style={settingsStyles.rowResponsive}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Test compatibility</Text>
              <Text style={settingsStyles.rowHint}>
                Run read-only checks for Vim, Neovim, tmux, Difftastic, terminfo, color, fonts, and
                the existing terminal session behavior. This does not install software or change
                configuration.
              </Text>
              {error ? <Text style={settingsStyles.rowError}>{error}</Text> : null}
            </View>
            <Button
              variant="outline"
              size="sm"
              onPress={handleRunDiagnostic}
              loading={isRunning}
              accessibilityLabel="Test terminal compatibility"
              testID="terminal-compatibility-button"
            >
              Test compatibility
            </Button>
          </View>
        </View>
      </SettingsSection>
      {payload ? <DiagnosticSheet payload={payload} onClose={closeResults} /> : null}
    </>
  );
}
