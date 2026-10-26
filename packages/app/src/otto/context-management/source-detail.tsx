import { useMemo } from "react";
import type { ContextSelection } from "@getpaseo/plugin/otto/context-management";
import { ContextDetail } from "./report-view";
import { ContextSourceEditor } from "./source-editor";
import type { ContextSourceDrafts } from "./source-model";
import type { ContextSourceSelection } from "./selection";
import type { ContextEdgeEdit, ContextEdgeEditState } from "./edge-edit";

export function ContextSelectedDetail(props: {
  compact: boolean;
  scope: ContextSelection;
  selection: ContextSourceSelection | null;
  drafts: ContextSourceDrafts;
  active: boolean;
  writeModel: ContextEdgeEdit;
  writeState: ContextEdgeEditState;
  preview: { label: string; text: string } | undefined;
  error: Error | null;
  fetching: boolean;
  onBack(): void;
  onChanged(): void;
}) {
  const { selection } = props;
  const source = useMemo(
    () => (selection?.nodeId ? { ...selection, nodeId: selection.nodeId } : null),
    [selection],
  );
  const editor = useMemo(
    () =>
      source ? (
        <ContextSourceEditor
          scope={props.scope}
          selection={source}
          drafts={props.drafts}
          active={props.active}
          writeModel={props.writeModel}
          writeState={props.writeState}
          onChanged={props.onChanged}
        />
      ) : null,
    [
      source,
      props.scope,
      props.drafts,
      props.active,
      props.writeModel,
      props.writeState,
      props.onChanged,
    ],
  );
  return (
    <ContextDetail
      key={`${selection?.nodeId}/${selection?.findingId ?? "source"}`}
      compact={props.compact}
      selection={selection}
      onBack={props.onBack}
      preview={props.preview}
      error={props.error}
      fetching={props.fetching}
      editor={editor}
      editInitially={Boolean(selection?.findingId)}
    />
  );
}
