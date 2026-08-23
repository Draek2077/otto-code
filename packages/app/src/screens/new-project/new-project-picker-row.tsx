import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PROJECT_SCAFFOLD_GITIGNORE_TEMPLATE_IDS } from "@otto-code/protocol/messages";
import type { HostingOwnerSummary, HostingRepositorySummary } from "@otto-code/protocol/messages";
import {
  Download,
  EyeOff,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Globe,
  Groups,
  PrivacyTip,
  Server,
} from "@/components/icons/material-icons";
import { GitBranch } from "@/components/icons/lucide";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { HostProfile } from "@/types/host-connection";
import type { Theme } from "@/styles/theme";
import { NewProjectBadgePicker } from "./new-project-badge-picker";
import type { NewProjectFieldUpdate } from "./new-project-detail-fields";
import type { NewProjectFormState, NewProjectGitSetup, NewProjectMode } from "./new-project-form";

// Pills above the input, mirroring New workspace's project / host / isolation /
// base row. Which pills appear follows the mode: a choice that cannot apply is
// hidden, never shown disabled. Usually one row; see the wrap note below for the
// single case that earns a second.

// Gitignore is optional, so the picker needs an explicit "no template" entry.
const NO_GITIGNORE = "__none__";

// Wrapped once at module scope: withUnistyles per render would remount the icon.
const badgeIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedDownload = withUnistyles(Download);
const ThemedServer = withUnistyles(Server);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedEyeOff = withUnistyles(EyeOff);
const ThemedGlobe = withUnistyles(Globe);
const ThemedFolderGit2 = withUnistyles(FolderGit2);
const ThemedGroups = withUnistyles(Groups);
const ThemedPrivacyTip = withUnistyles(PrivacyTip);

const modeIcons = {
  open: <ThemedFolderOpen uniProps={badgeIconMapping} />,
  create: <ThemedFolderPlus uniProps={badgeIconMapping} />,
  clone: <ThemedDownload uniProps={badgeIconMapping} />,
} satisfies Record<NewProjectMode, React.ReactNode>;

const hostIcon = <ThemedServer uniProps={badgeIconMapping} />;
const gitSetupIcon = <ThemedGitBranch uniProps={badgeIconMapping} />;
const gitignoreIcon = <ThemedEyeOff uniProps={badgeIconMapping} />;
const providerIcon = <ThemedGlobe uniProps={badgeIconMapping} />;
const repositoryIcon = <ThemedFolderGit2 uniProps={badgeIconMapping} />;
const ownerIcon = <ThemedGroups uniProps={badgeIconMapping} />;
const visibilityIcon = <ThemedPrivacyTip uniProps={badgeIconMapping} />;

interface NewProjectPickerRowProps {
  form: NewProjectFormState;
  hosts: HostProfile[];
  selectedServerId: string;
  onSelectHost: (serverId: string) => void;
  connectedProviders: string[];
  owners: HostingOwnerSummary[];
  ownersLoading: boolean;
  repositories: HostingRepositorySummary[];
  repositoriesLoading: boolean;
  disabled: boolean;
  onUpdate: NewProjectFieldUpdate;
  onModeChange: (mode: NewProjectMode) => void;
}

export function NewProjectPickerRow({
  form,
  hosts,
  selectedServerId,
  onSelectHost,
  connectedProviders,
  owners,
  ownersLoading,
  repositories,
  repositoriesLoading,
  disabled,
  onUpdate,
  onModeChange,
}: NewProjectPickerRowProps) {
  const { t } = useTranslation();

  const handleModeSelect = useCallback(
    (id: string) => onModeChange(id as NewProjectMode),
    [onModeChange],
  );
  const handleGitSetupSelect = useCallback(
    (id: string) => onUpdate("gitSetup", id as NewProjectGitSetup),
    [onUpdate],
  );
  const handleProviderSelect = useCallback(
    (id: string) => onUpdate("remoteProvider", id),
    [onUpdate],
  );
  const handleOwnerSelect = useCallback((id: string) => onUpdate("remoteOwner", id), [onUpdate]);
  const handleVisibilitySelect = useCallback(
    (id: string) => onUpdate("remoteVisibility", id as "private" | "public"),
    [onUpdate],
  );
  const handleRepositorySelect = useCallback((id: string) => onUpdate("cloneUrl", id), [onUpdate]);
  const handleGitignoreSelect = useCallback(
    (id: string) => onUpdate("gitignoreTemplate", id === NO_GITIGNORE ? null : id),
    [onUpdate],
  );

  const modeOptions = useMemo<ComboboxOption[]>(
    () => [
      { id: "open", label: t("newProject.modes.open") },
      { id: "create", label: t("newProject.modes.create") },
      { id: "clone", label: t("newProject.modes.clone") },
    ],
    [t],
  );

  const hostOptions = useMemo<ComboboxOption[]>(
    () => hosts.map((host) => ({ id: host.serverId, label: host.label })),
    [hosts],
  );

  const gitSetupOptions = useMemo<ComboboxOption[]>(
    () => [
      { id: "none", label: t("newProject.gitSetup.none") },
      { id: "init", label: t("newProject.gitSetup.init") },
      // Creating a remote needs somewhere to create it; with no connected
      // provider the choice is hidden rather than shown and then refused.
      ...(connectedProviders.length > 0
        ? [{ id: "remote", label: t("newProject.gitSetup.remote") }]
        : []),
    ],
    [connectedProviders.length, t],
  );

  const providerOptions = useMemo<ComboboxOption[]>(
    () =>
      connectedProviders.map((provider) => ({
        id: provider,
        label: t(`newProject.providers.${provider}`, { defaultValue: provider }),
      })),
    [connectedProviders, t],
  );

  const ownerOptions = useMemo<ComboboxOption[]>(
    () =>
      owners.map((owner) => ({
        id: owner.id,
        label: owner.label,
        description: owner.id === owner.label ? undefined : owner.id,
      })),
    [owners],
  );

  const repositoryOptions = useMemo<ComboboxOption[]>(
    () =>
      repositories.map((repository) => ({
        id: repository.cloneUrl,
        label: repository.fullName,
        description: repository.description ?? undefined,
      })),
    [repositories],
  );

  const visibilityOptions = useMemo<ComboboxOption[]>(
    () => [
      { id: "private", label: t("newProject.visibility.private") },
      { id: "public", label: t("newProject.visibility.public") },
    ],
    [t],
  );

  const gitignoreOptions = useMemo<ComboboxOption[]>(
    () => [
      { id: NO_GITIGNORE, label: t("newProject.fields.gitignorePlaceholder") },
      ...PROJECT_SCAFFOLD_GITIGNORE_TEMPLATE_IDS.map((id) => ({
        id,
        label: t(`newProject.gitignore.${id}`, { defaultValue: id }),
      })),
    ],
    [t],
  );

  const labelFor = (options: ComboboxOption[], id: string | null, fallback: string): string =>
    options.find((option) => option.id === id)?.label ?? fallback;

  const isCreate = form.mode === "create";
  const isClone = form.mode === "clone";
  const showRepoSetup = isCreate && form.gitSetup !== "none";
  const showRemote = isCreate && form.gitSetup === "remote";
  const selectedRepositoryLabel = labelFor(
    repositoryOptions,
    form.cloneUrl || null,
    t("newProject.fields.repositoryPlaceholder"),
  );

  // Only "create + remote" earns a second row. It adds four pills on top of
  // mode/host/git-setup/gitignore, which wraps arbitrarily mid-group and reads
  // as noise. Clone adds just two (provider, repository) to a row that has at
  // most mode and host - that fits, so it stays inline.
  const remotePickers = (
    <RemotePickers
      form={form}
      showRemote={showRemote}
      isClone={isClone}
      providerOptions={providerOptions}
      ownerOptions={ownerOptions}
      repositoryOptions={repositoryOptions}
      visibilityOptions={visibilityOptions}
      selectedRepositoryLabel={selectedRepositoryLabel}
      ownersLoading={ownersLoading}
      repositoriesLoading={repositoriesLoading}
      disabled={disabled}
      onSelectProvider={handleProviderSelect}
      onSelectOwner={handleOwnerSelect}
      onSelectRepository={handleRepositorySelect}
      onSelectVisibility={handleVisibilitySelect}
    />
  );
  const showCloneInline = isClone && providerOptions.length > 0;

  return (
    <View style={styles.rows}>
      <View style={styles.row} testID="new-project-picker-row">
        <NewProjectBadgePicker
          icon={modeIcons[form.mode]}
          label={labelFor(modeOptions, form.mode, "")}
          tooltip={t("newProject.pickers.mode")}
          options={modeOptions}
          value={form.mode}
          onSelect={handleModeSelect}
          disabled={disabled}
          title={t("newProject.pickers.mode")}
          testID="new-project-mode"
        />

        {hosts.length > 1 ? (
          <NewProjectBadgePicker
            icon={hostIcon}
            label={labelFor(hostOptions, selectedServerId, t("newProject.fields.hostPlaceholder"))}
            tooltip={t("newProject.pickers.host")}
            options={hostOptions}
            value={selectedServerId}
            onSelect={onSelectHost}
            disabled={disabled}
            title={t("newProject.pickers.host")}
            emptyText={t("newProject.fields.hostEmpty")}
            testID="new-project-host"
          />
        ) : null}

        {isCreate ? (
          <NewProjectBadgePicker
            icon={gitSetupIcon}
            label={labelFor(gitSetupOptions, form.gitSetup, "")}
            tooltip={t("newProject.pickers.gitSetup")}
            options={gitSetupOptions}
            value={form.gitSetup}
            onSelect={handleGitSetupSelect}
            disabled={disabled}
            title={t("newProject.pickers.gitSetup")}
            testID="new-project-git-setup"
          />
        ) : null}

        {showRepoSetup ? (
          <NewProjectBadgePicker
            icon={gitignoreIcon}
            label={labelFor(
              gitignoreOptions,
              form.gitignoreTemplate ?? NO_GITIGNORE,
              t("newProject.fields.gitignorePlaceholder"),
            )}
            tooltip={t("newProject.pickers.gitignore")}
            options={gitignoreOptions}
            value={form.gitignoreTemplate ?? NO_GITIGNORE}
            onSelect={handleGitignoreSelect}
            disabled={disabled}
            title={t("newProject.pickers.gitignore")}
            testID="new-project-gitignore"
          />
        ) : null}

        {showCloneInline ? remotePickers : null}
      </View>

      {showRemote ? (
        <View style={styles.row} testID="new-project-remote-picker-row">
          {remotePickers}
        </View>
      ) : null}
    </View>
  );
}

interface RemotePickersProps {
  form: NewProjectFormState;
  showRemote: boolean;
  isClone: boolean;
  providerOptions: ComboboxOption[];
  ownerOptions: ComboboxOption[];
  repositoryOptions: ComboboxOption[];
  visibilityOptions: ComboboxOption[];
  selectedRepositoryLabel: string;
  ownersLoading: boolean;
  repositoriesLoading: boolean;
  disabled: boolean;
  onSelectProvider: (id: string) => void;
  onSelectOwner: (id: string) => void;
  onSelectRepository: (id: string) => void;
  onSelectVisibility: (id: string) => void;
}

// The second row's contents. Split out so the row component itself stays a flat
// list of pills rather than a nest of mode conditionals.
function RemotePickers({
  form,
  showRemote,
  isClone,
  providerOptions,
  ownerOptions,
  repositoryOptions,
  visibilityOptions,
  selectedRepositoryLabel,
  ownersLoading,
  repositoriesLoading,
  disabled,
  onSelectProvider,
  onSelectOwner,
  onSelectRepository,
  onSelectVisibility,
}: RemotePickersProps) {
  const { t } = useTranslation();
  const providerLabel =
    providerOptions.find((option) => option.id === form.remoteProvider)?.label ??
    t("newProject.fields.providerPlaceholder");
  const visibilityLabel =
    visibilityOptions.find((option) => option.id === form.remoteVisibility)?.label ?? "";

  return (
    <>
      {/* Clone offers the provider pill purely to browse your own repositories;
          a pasted URL works with no provider connected at all. */}
      <NewProjectBadgePicker
        icon={providerIcon}
        label={providerLabel}
        tooltip={t("newProject.pickers.provider")}
        options={providerOptions}
        value={form.remoteProvider ?? ""}
        onSelect={onSelectProvider}
        disabled={disabled}
        title={t("newProject.pickers.provider")}
        emptyText={t("newProject.fields.providerEmpty")}
        testID="new-project-provider"
      />

      {isClone && form.remoteProvider ? (
        <NewProjectBadgePicker
          icon={repositoryIcon}
          label={selectedRepositoryLabel}
          tooltip={t("newProject.pickers.repository")}
          options={repositoryOptions}
          value={form.cloneUrl}
          onSelect={onSelectRepository}
          disabled={disabled}
          searchable
          searchPlaceholder={t("newProject.fields.repositorySearch")}
          title={t("newProject.pickers.repository")}
          emptyText={
            repositoriesLoading ? t("common.loading") : t("newProject.fields.repositoryEmpty")
          }
          testID="new-project-clone-repository"
        />
      ) : null}

      {showRemote ? (
        <>
          <NewProjectBadgePicker
            icon={ownerIcon}
            label={form.remoteOwner ?? t("newProject.fields.ownerPlaceholder")}
            tooltip={t("newProject.pickers.owner")}
            options={ownerOptions}
            value={form.remoteOwner ?? ""}
            onSelect={onSelectOwner}
            disabled={disabled || !form.remoteProvider}
            searchable
            title={t("newProject.pickers.owner")}
            emptyText={ownersLoading ? t("common.loading") : t("newProject.fields.ownerEmpty")}
            testID="new-project-owner"
          />

          <NewProjectBadgePicker
            icon={visibilityIcon}
            label={visibilityLabel}
            tooltip={t("newProject.pickers.visibility")}
            options={visibilityOptions}
            value={form.remoteVisibility}
            onSelect={onSelectVisibility}
            disabled={disabled}
            title={t("newProject.pickers.visibility")}
            testID="new-project-visibility"
          />
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  rows: {
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    // The badge adds its own left padding; offset it so the first pill's icon
    // lands on the "New project" title's left edge.
    paddingLeft: theme.spacing[4],
    gap: theme.spacing[2],
  },
}));
