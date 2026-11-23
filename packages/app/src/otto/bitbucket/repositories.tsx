import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import {
  readBitbucketRepositories,
  createBitbucketRepository,
  readBitbucketWorkspaces,
  type BitbucketRepository,
} from "@getpaseo/plugin/otto/bitbucket-connections";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsInput,
  SettingsSwitch,
  SettingsSelect,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useAddProjectFlowStore } from "@/stores/add-project-flow-store";
import { openBitbucketRepositoryForm, type BitbucketRepositoryForm } from "./repository-form";

const protocols = [
  { value: "ssh", label: "SSH" },
  { value: "https", label: "HTTPS" },
];
function RepositoryRow({
  repository,
  model,
}: {
  repository: BitbucketRepository;
  model: BitbucketRepositoryForm;
}) {
  const clone = useCallback(() => model.clone(repository), [model, repository]);
  return (
    <SettingsRow label={repository.fullName} hint={repository.description ?? undefined}>
      <Button variant="outline" onPress={clone}>
        Clone
      </Button>
    </SettingsRow>
  );
}
export function BitbucketRepositories({
  hostId,
  projectId,
  revision,
  active,
}: {
  hostId: string;
  projectId?: string;
  revision: string;
  active: boolean;
}) {
  const list = useRpc(readBitbucketRepositories),
    create = useRpc(createBitbucketRepository),
    workspaces = useRpc(readBitbucketWorkspaces);
  const [model] = useState(() =>
    openBitbucketRepositoryForm(revision, {
      workspaces: () => workspaces({ hostId, ...(projectId ? { projectId } : {}) }),
      list: (input) => list({ hostId, ...(projectId ? { projectId } : {}), ...input }),
      create: (input) => create({ hostId, ...(projectId ? { projectId } : {}), ...input }),
      clone: (repository, protocol) =>
        useAddProjectFlowStore.getState().openRepository(hostId, {
          id: repository.fullName,
          nameWithOwner: repository.fullName,
          cloneUrl: protocol === "ssh" ? repository.sshUrl : repository.cloneUrl,
          description: repository.description,
          updatedAt: repository.updatedAt,
        }),
    }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    model.setActive(active);
  }, [model, active]);
  useEffect(() => model.updateRevision(revision), [model, revision]);
  useEffect(() => () => model.close(), [model]);
  const workspace = useCallback((value: string) => model.edit({ workspace: value }), [model]);
  const query = useCallback((value: string) => model.edit({ query: value }), [model]);
  const name = useCallback((value: string) => model.edit({ name: value }), [model]);
  const description = useCallback((value: string) => model.edit({ description: value }), [model]);
  const privacy = useCallback((value: boolean) => model.edit({ private: value }), [model]);
  const protocol = useCallback(
    (value: "ssh" | "https") => model.edit({ protocol: value }),
    [model],
  );
  const begin = useCallback(() => model.edit({ creating: true }), [model]);
  const cancel = useCallback(() => model.edit({ creating: false }), [model]);
  const submit = useCallback(
    () =>
      model.create(() =>
        confirmDialog({
          title: "Create Bitbucket repository?",
          message: `Create ${state.name} in workspace ${state.workspace} as a ${state.private ? "private" : "public"} repository?`,
          confirmLabel: "Create repository",
        }),
      ),
    [model, state.name, state.workspace, state.private],
  );
  const acknowledge = useCallback(
    () =>
      model.acknowledge(revision, () =>
        confirmDialog({
          title: "Review Bitbucket account and remote state",
          message:
            "Check Bitbucket for the result of any earlier write. Use the currently selected account for subsequent actions?",
          confirmLabel: "Use selected account",
        }),
      ),
    [model, revision],
  );
  return (
    <SettingsSection title="Bitbucket repositories">
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.message ? <Alert variant="info" description={state.message} /> : null}
      {state.revision !== revision || state.blocked ? (
        <SettingsCard>
          <SettingsRow label="Review account and remote state before another create">
            <Button variant="outline" onPress={acknowledge} disabled={state.busy}>
              Review and continue
            </Button>
          </SettingsRow>
        </SettingsCard>
      ) : null}
      <SettingsCard>
        <SettingsRow label="Accessible workspaces">
          <Button
            variant="outline"
            onPress={model.discover}
            disabled={state.busy || state.revision !== revision}
          >
            Load workspaces
          </Button>
        </SettingsRow>
        {state.workspaces.length ? (
          <SettingsSelect
            label="Workspace"
            value={state.workspace}
            options={state.workspaces.map((entry) => ({ value: entry.id, label: entry.label }))}
            onValueChange={workspace}
            disabled={state.busy}
          />
        ) : null}
        {state.workspacesTruncated ? (
          <SettingsRow label="More workspaces are available. Enter another workspace ID directly." />
        ) : null}
        <SettingsInput
          label="Workspace ID"
          initialValue={state.workspace}
          onChangeText={workspace}
          disabled={state.busy}
        />
        <SettingsInput
          label="Search repositories"
          initialValue={state.query}
          onChangeText={query}
          disabled={state.busy}
        />
        <SettingsSelect
          label="Clone protocol"
          value={state.protocol}
          options={protocols}
          onValueChange={protocol}
          disabled={state.busy}
        />
        <SettingsRow label="Repository actions">
          <Button variant="outline" onPress={model.search} disabled={state.busy}>
            {state.busy ? "Working…" : "Search"}
          </Button>
          <Button
            variant="outline"
            onPress={begin}
            disabled={state.busy || state.blocked || state.revision !== revision}
          >
            New repository
          </Button>
        </SettingsRow>
        {state.repositories.map((repository) => (
          <RepositoryRow key={repository.fullName} repository={repository} model={model} />
        ))}
        {state.searched && state.repositories.length === 0 ? (
          <SettingsRow label="No repositories found" />
        ) : null}
        {state.truncated ? (
          <SettingsRow label="More repositories match. Narrow the search to see another result." />
        ) : null}
      </SettingsCard>
      {state.creating ? (
        <SettingsCard>
          <SettingsInput
            label="Repository name"
            initialValue={state.name}
            onChangeText={name}
            disabled={state.busy}
          />
          <SettingsInput
            label="Description"
            initialValue={state.description}
            onChangeText={description}
            disabled={state.busy}
          />
          <SettingsSwitch
            label="Private repository"
            value={state.private}
            onValueChange={privacy}
            disabled={state.busy}
          />
          <SettingsRow label="Create repository">
            <Button variant="outline" onPress={cancel} disabled={state.busy}>
              Cancel
            </Button>
            <Button
              onPress={submit}
              disabled={state.busy || state.blocked || state.revision !== revision}
            >
              Create repository
            </Button>
          </SettingsRow>
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
