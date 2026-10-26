import React, { useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import type { ContextReport } from "@getpaseo/plugin/otto/context-management";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { styles } from "./styles";
import { Button } from "@/components/ui/button";
import type { ContextEdgeEditState } from "./edge-edit";
import type { ContextSourceSelection } from "./selection";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Bot } from "lucide-react-native";
export function ContextControls(props: {
  agentId: string;
  windowTokens: string;
  options: { value: string; label: string }[];
  windows: { value: string; label: string }[];
  busy: boolean;
  fetching: boolean;
  chooseAgent(value: string): void;
  chooseWindow(value: string): void;
  refresh(): Promise<void>;
  compaction: { disabled: boolean; open(): void };
}) {
  return (
    <SettingsSection
      title="Context Management"
      info="Fixed occupancy is different from conversation usage or spend. Exact text still uses an estimated token count; provider-hidden inputs are unknown, never zero."
    >
      <SettingsCard>
        <SettingsSelect
          label="Inspect"
          value={props.agentId}
          options={props.options}
          onValueChange={props.chooseAgent}
          disabled={props.busy}
        />
        <SettingsSelect
          label="Window for budget estimate"
          value={props.windowTokens}
          options={props.windows}
          onValueChange={props.chooseWindow}
          disabled={props.busy}
        />
      </SettingsCard>
      <View style={styles.actions}>
        <Button
          variant="outline"
          size="sm"
          onPress={props.refresh}
          disabled={props.fetching || props.busy}
        >
          {props.fetching ? "Refreshing..." : "Refresh context"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          leftIcon={Bot}
          onPress={props.compaction.open}
          disabled={props.compaction.disabled}
        >
          Compact with AI
        </Button>
      </View>
    </SettingsSection>
  );
}
export function ContextWriteFeedback({ state }: { state: ContextEdgeEditState }) {
  if (!state.busy && !state.error && !state.saved) return null;
  return (
    <View style={styles.writeStatus} testID="context-write-feedback">
      {state.busy ? <SettingsRow label="Reviewing or applying the context change..." /> : null}
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.saved ? (
        <Alert
          variant="info"
          description="Review the operation's file outcomes and current context. Existing chats may retain their earlier instructions. Refresh context before another change."
        />
      ) : null}
    </View>
  );
}
export function ContextDetail({
  compact,
  selection,
  onBack,
  preview,
  error,
  fetching,
  editor,
  editInitially,
}: {
  compact: boolean;
  selection: ContextSourceSelection | null;
  onBack(): void;
  preview: { label: string; text: string } | undefined;
  error: Error | null;
  fetching: boolean;
  editor: ReactNode;
  editInitially: boolean;
}) {
  const [view, setView] = useState<"preview" | "source">(editInitially ? "source" : "preview");
  const choices = useMemo(
    () => [
      { value: "preview" as const, label: "Prompt preview" },
      { value: "source" as const, label: "Current source" },
    ],
    [],
  );
  return (
    <>
      {compact && selection ? (
        <Button variant="outline" size="sm" onPress={onBack}>
          Back to context
        </Button>
      ) : null}
      {editor ? (
        <SegmentedControl
          options={choices}
          value={view}
          onValueChange={setView}
          size="sm"
          testID="context-detail-tabs"
        />
      ) : null}
      {editor && view === "source" ? (
        editor
      ) : (
        <ContextPreviewPane
          preview={preview}
          error={error}
          fetching={fetching}
          selected={Boolean(selection)}
        />
      )}
    </>
  );
}
export function ContextReadStatus({
  notice,
  agentError,
  error,
  loading,
}: {
  notice: string;
  agentError: Error | null;
  error: Error | null;
  loading: boolean;
}) {
  return (
    <>
      {notice ? <Alert variant="info" description={notice} /> : null}
      {agentError ? <Alert variant="error" description={agentError.message} /> : null}
      {error ? <Alert variant="error" description={error.message} /> : null}
      {loading ? <SettingsRow label="Reading context from the owning host..." /> : null}
    </>
  );
}
export function ContextSummary({ report }: { report: ContextReport }) {
  const convention = report.categories.some((row) => row.visibility === "convention");
  let requestLabel = report.agentId ? "Prepared request unavailable" : "Prospective instructions";
  let requestHint = report.agentId
    ? "The provider has not exposed a prepared request, or it exceeds the inspection bound. No model was launched to inspect it."
    : "No model was called. Select a chat to inspect its prepared input.";
  if (convention) {
    requestLabel = "Provider convention inventory";
    requestHint =
      "Estimated from documented provider discovery, not observed in a request. Installed versions, approvals and hidden input can change what is actually sent. No model was launched.";
  }
  return (
    <SettingsCard>
      {report.instructionState === "blocked" ? (
        <Alert
          variant="error"
          description="Required instructions could not be read. The runtime refuses requests until these instruction issues are resolved; the text below is a partial inspection."
        />
      ) : null}
      <SettingsRow
        label={convention ? "Estimated fixed weight" : "Measured fixed weight"}
        hint={`${report.fixedTokens.toLocaleString()} estimated tokens · ${report.sharePercent}% of selected window · ${report.severity}`}
      />
      <SettingsRow
        label={
          convention ? "Room after estimated fixed weight" : "Room after measured fixed weight"
        }
        hint={`${report.workingRoom.toLocaleString()} tokens. Hidden provider input and conversation history are not deducted.`}
      />
      <SettingsRow
        label={report.preparedRequest ? "Last prepared request" : requestLabel}
        hint={
          report.preparedRequest
            ? `${report.preparedRequest.phase} · ${report.capturedAt}`
            : requestHint
        }
      />
    </SettingsCard>
  );
}
export function ContextPreviewPane({
  preview,
  error,
  fetching,
  selected,
}: {
  preview: { label: string; text: string } | undefined;
  error: Error | null;
  fetching: boolean;
  selected: boolean;
}) {
  return (
    <View style={styles.preview}>
      <SettingsSection title={preview?.label ?? "Inspect a source"}>
        {error ? <Alert variant="error" description={error.message} /> : null}
        {fetching ? <SettingsRow label="Reading selected context..." /> : null}
        {preview && !error ? (
          <Text selectable style={styles.code} testID="context-source-preview">
            {preview.text || "No text is available in this category."}
          </Text>
        ) : null}
        {!selected ? (
          <SettingsRow label="Choose a source or a visible category to inspect its prompt text." />
        ) : null}
      </SettingsSection>
    </View>
  );
}
