import { useCallback, useSyncExternalStore } from "react";
import {
  SettingsCard,
  SettingsCollapsibleRow,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import type { ContextReport } from "@getpaseo/plugin/otto/context-management";
import type { ContextCompactionModel, ContextFileRole } from "./compaction-model";

const roles = [
  { value: "rewrite", label: "Rewritable" },
  { value: "reference", label: "Read-only reference" },
  { value: "excluded", label: "Excluded" },
];
function RoleRow({
  model,
  node,
  role,
  busy,
}: {
  model: ContextCompactionModel;
  node: ContextReport["nodes"][number];
  role: ContextFileRole;
  busy: boolean;
}) {
  const select = useCallback(
    (value: string) => {
      switch (value) {
        case "rewrite":
          model.setRole(node.id, "rewrite");
          break;
        case "reference":
          model.setRole(node.id, "reference");
          break;
        case "excluded":
          model.setRole(node.id, "excluded");
          break;
      }
    },
    [model, node.id],
  );
  return (
    <SettingsSelect
      label={node.label}
      hint={node.scope}
      value={role}
      options={roles}
      onValueChange={select}
      disabled={busy}
      testID={`context-compaction-role-${node.id}`}
    />
  );
}
export function ContextCompactionFiles({ model }: { model: ContextCompactionModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  return (
    <SettingsSection
      title="Document set"
      info="Only rewritable prose files can change. References remain read-only; complete references are chosen smallest-first within twelve files and 60 KB."
    >
      <SettingsCard>
        {state.documents.map((document) => (
          <SettingsRow
            key={document.file.nodeId}
            label={document.file.label}
            hint={`Rewritable · ${document.file.scope} · ${document.file.text.length.toLocaleString()} characters`}
          />
        ))}
        <SettingsCollapsibleRow label="Choose files and scope" testID="context-compaction-files">
          {model.nodes.map((node) => (
            <RoleRow
              key={node.id}
              model={model}
              node={node}
              role={state.roles.get(node.id) ?? "excluded"}
              busy={state.busy}
            />
          ))}
        </SettingsCollapsibleRow>
        <SettingsCollapsibleRow
          label={`Read-only references (${state.references.length})`}
          testID="context-compaction-references"
        >
          {state.references.map((file) => (
            <SettingsRow
              key={file.nodeId}
              label={file.label}
              hint={`${file.characters.toLocaleString()} characters · pinned revision`}
            />
          ))}
        </SettingsCollapsibleRow>
      </SettingsCard>
      {state.omittedReferences ? (
        <Alert
          variant="info"
          description={`${state.omittedReferences} reference candidates were unavailable or outside the reference budget; they were not included.`}
        />
      ) : null}
      {state.setChanged ? (
        <Alert
          variant="warning"
          description="The document roles changed. Load the selected files before generating or applying changes."
        />
      ) : null}
    </SettingsSection>
  );
}
