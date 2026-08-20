import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ProjectScaffoldStep } from "@otto-code/protocol/messages";
import { ScreenHeader } from "@/components/headers/screen-header";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { HEADER_INNER_HEIGHT, MAX_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { normalizeProjectDescriptor, useSessionStore } from "@/stores/session-store";
import { useOpenProject } from "@/hooks/use-open-project";
import type { Theme } from "@/styles/theme";
import { DirectoryField } from "@/screens/new-project/directory-field";
import { NewProjectDetailFields } from "@/screens/new-project/new-project-detail-fields";
import { NewProjectPickerRow } from "@/screens/new-project/new-project-picker-row";
import {
  buildScaffoldGitRequest,
  createNewProjectFormState,
  findDuplicateProjectPath,
  getNewProjectBlocker,
  previewProjectPath,
  shouldShowDuplicateProjectPath,
  type NewProjectCapabilities,
  type NewProjectFormState,
  type NewProjectMode,
} from "@/screens/new-project/new-project-form";
import { getHostProjectSourceDirectory, useHostProjects } from "@/projects/host-projects";
import {
  PROVIDERS_REQUIRING_OWNER,
  useNewProjectHosting,
} from "@/screens/new-project/use-new-project-hosting";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import type { Href } from "expo-router";

// Wrapped once at module scope so the themed color prop tracks the theme
// without subscribing the screen to every runtime change.
const ThemedSpinner = withUnistyles(LoadingSpinner);
const spinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function getContentStyle(input: { isCompact: boolean; insetBottom: number }) {
  if (input.isCompact) {
    return [styles.content, styles.contentCompact, { paddingBottom: input.insetBottom }];
  }
  return [styles.content, styles.contentCentered];
}

interface NewProjectScreenProps {
  serverId?: string;
  directory?: string;
}

export function NewProjectScreen({
  serverId: serverIdProp,
  directory: directoryProp,
}: NewProjectScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const hosts = useHosts();
  const isCompact = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();

  const [selectedServerId, setSelectedServerId] = useState(
    () => serverIdProp?.trim() || hosts[0]?.serverId || "",
  );
  const [form, setForm] = useState<NewProjectFormState>(() => ({
    ...createNewProjectFormState(),
    mode: directoryProp?.trim() ? "open" : "open",
    directory: directoryProp?.trim() ?? "",
  }));
  // Only the step currently running, for the status line. The full step list is
  // build detail - it belongs in a failure message, not on screen during a
  // successful run.
  const [runningStep, setRunningStep] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSuccessfulSubmission, setHasSuccessfulSubmission] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const client = useHostRuntimeClient(selectedServerId);
  const openProject = useOpenProject(selectedServerId);
  const upsertProject = useSessionStore((state) => state.upsertProject);
  const setHasHydratedWorkspaces = useSessionStore((state) => state.setHasHydratedWorkspaces);

  const hosting = useNewProjectHosting({
    serverId: selectedServerId,
    provider: form.remoteProvider,
    wantsOwners: form.mode === "create" && form.gitSetup === "remote",
    wantsRepositories: form.mode === "clone",
  });

  const update = useCallback(
    <K extends keyof NewProjectFormState>(key: K, value: NewProjectFormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
      setErrorMessage(null);
      setHasSuccessfulSubmission(false);
    },
    [],
  );

  const capabilities = useMemo<NewProjectCapabilities>(
    () => ({
      canScaffold: hosting.canScaffold,
      remoteCapableProviders: hosting.connectedProviders,
      providersRequiringOwner: PROVIDERS_REQUIRING_OWNER,
    }),
    [hosting.canScaffold, hosting.connectedProviders],
  );

  const blocker = getNewProjectBlocker(form, capabilities);
  const pathPreview = previewProjectPath(form);

  // Adding a directory that is already a project succeeds silently on the daemon
  // (find-or-create returns the existing record), so the page would close having
  // done nothing. Refuse it here, the way New workspace refuses an occupied
  // directory, and say which project already owns the path.
  const hostProjects = useHostProjects(useMemo(() => [selectedServerId], [selectedServerId]));
  const existingProjectPaths = useMemo(
    () =>
      hostProjects.flatMap((project) => {
        const directory = getHostProjectSourceDirectory(project, selectedServerId);
        return directory ? [directory] : [];
      }),
    [hostProjects, selectedServerId],
  );
  const duplicateProjectPath = findDuplicateProjectPath({
    targetPath: pathPreview,
    existingProjectPaths,
  });
  const showDuplicateProjectPath = shouldShowDuplicateProjectPath({
    duplicateProjectPath,
    isSubmitting,
    hasSuccessfulSubmission,
  });

  const handleModeChange = useCallback((mode: NewProjectMode) => {
    setRunningStep(null);
    setErrorMessage(null);
    setHasSuccessfulSubmission(false);
    setForm((current) => ({ ...current, mode }));
  }, []);

  const handleDirectoryChange = useCallback(
    (directory: string) => update("directory", directory),
    [update],
  );

  const handleProgress = useCallback(
    (progress: { step: string; status: ProjectScaffoldStep["status"] }) => {
      if (progress.status === "running") {
        setRunningStep(progress.step);
      }
    },
    [],
  );

  const submitOpen = useCallback(async () => {
    const result = await openProject(form.directory.trim());
    if (!result.ok) {
      setErrorMessage(
        result.error ?? t(`projectPicker.errors.${result.errorCode ?? "open_failed"}`),
      );
      return;
    }
    setHasSuccessfulSubmission(true);
    // Back is right when the page was pushed from an entry point. On a direct
    // load (restored URL, deep link) there is nothing to go back to, so land on
    // the home screen rather than a dead end.
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/" as Href);
  }, [form.directory, openProject, router, t]);

  const submitScaffold = useCallback(async () => {
    const git = buildScaffoldGitRequest(form, capabilities);
    if (!git || !client) {
      return;
    }
    const payload = await client.scaffoldProject({
      parentDirectory: form.directory.trim(),
      folderName: form.folderName.trim() || undefined,
      git,
      onProgress: handleProgress,
    });

    if (payload.error || !payload.project) {
      setErrorMessage(payload.error ?? t("newProject.errors.failed"));
      return;
    }

    // The same store update project.add performs, so the new project shows up
    // in the sidebar without waiting for a workspace refetch.
    upsertProject(selectedServerId, normalizeProjectDescriptor(payload.project));
    setHasHydratedWorkspaces(selectedServerId, true);
    setHasSuccessfulSubmission(true);
    // A freshly scaffolded project has no workspace yet, so routing to one lands
    // on "Workspace not found". Hand off to New workspace with the project
    // preselected instead - creating a workspace is what you came here to do next.
    router.replace(
      buildNewWorkspaceRoute({
        serverId: selectedServerId,
        projectId: payload.project.projectId,
        sourceDirectory: payload.path ?? undefined,
        displayName: payload.project.projectDisplayName,
      }) as Href,
    );
  }, [
    upsertProject,
    capabilities,
    client,
    form,
    handleProgress,
    router,
    selectedServerId,
    setHasHydratedWorkspaces,
    t,
  ]);

  const handleSubmitPress = useCallback(() => {
    if (blocker || duplicateProjectPath || isSubmitting || !client) {
      return;
    }
    setIsSubmitting(true);
    setHasSuccessfulSubmission(false);
    setErrorMessage(null);
    setRunningStep(null);
    void (form.mode === "open" ? submitOpen() : submitScaffold())
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : t("newProject.errors.failed"));
      })
      .finally(() => setIsSubmitting(false));
  }, [
    blocker,
    client,
    duplicateProjectPath,
    form.mode,
    isSubmitting,
    submitOpen,
    submitScaffold,
    t,
  ]);

  const screenHeaderLeft = useMemo(() => <SidebarMenuToggle />, []);
  const contentStyle = getContentStyle({ isCompact, insetBottom: insets.bottom });

  const directoryPlaceholder =
    form.mode === "open"
      ? t("newProject.fields.folderPlaceholder")
      : t("newProject.fields.parentFolderPlaceholder");
  const submitLabel =
    form.mode === "open" ? t("newProject.actions.open") : t("newProject.actions.create");
  const blockerMessage = blocker ? t(`newProject.blockers.${blocker}`) : null;
  // A newer daemon may report a step this build has no label for, so fall back
  // to the generic "working" line rather than printing a raw id.
  const statusMessage = runningStep
    ? t(`newProject.status.${runningStep}`, { defaultValue: t("newProject.status.working") })
    : t("newProject.status.working");

  return (
    <View style={styles.container}>
      <ScreenHeader left={screenHeaderLeft} borderless />
      <View style={contentStyle}>
        <TitlebarDragRegion />
        <View style={styles.centered}>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>{t("newProject.title")}</Text>
          </View>

          <NewProjectPickerRow
            form={form}
            hosts={hosts}
            selectedServerId={selectedServerId}
            onSelectHost={setSelectedServerId}
            connectedProviders={hosting.connectedProviders}
            owners={hosting.owners}
            ownersLoading={hosting.ownersLoading}
            repositories={hosting.repositories}
            repositoriesLoading={hosting.repositoriesLoading}
            disabled={isSubmitting}
            onUpdate={update}
            onModeChange={handleModeChange}
          />

          <View style={styles.body}>
            <DirectoryField
              serverId={selectedServerId}
              value={form.directory}
              onChange={handleDirectoryChange}
              placeholder={directoryPlaceholder}
              disabled={isSubmitting}
              testID="new-project-directory"
            />

            <NewProjectDetailFields form={form} disabled={isSubmitting} onUpdate={update} />

            {pathPreview ? (
              <Text style={styles.pathPreview} testID="new-project-path-preview">
                {pathPreview}
              </Text>
            ) : null}

            {/* One status line, not a step log: the sequence is build detail
                the user did not ask to watch. Failures still get the full
                story, from the daemon's error message. */}
            {isSubmitting ? (
              <View style={styles.statusRow} testID="new-project-status">
                <ThemedSpinner uniProps={spinnerMapping} />
                <Text style={styles.statusText} numberOfLines={1}>
                  {statusMessage}
                </Text>
              </View>
            ) : null}

            {/* A conflict, not a not-filled-in-yet field, so it reads as an
                error rather than the muted blocker hint below. */}
            {showDuplicateProjectPath ? (
              <Text style={styles.errorText} testID="new-project-duplicate">
                {t("newProject.errors.alreadyAdded", { path: duplicateProjectPath })}
              </Text>
            ) : null}

            {errorMessage ? (
              <Text style={styles.errorText} testID="new-project-error">
                {errorMessage}
              </Text>
            ) : null}

            {/* Naming the missing field beats a disabled button with no
                explanation. */}
            {blockerMessage && !showDuplicateProjectPath ? (
              <Text style={styles.blockerText} testID="new-project-blocker">
                {blockerMessage}
              </Text>
            ) : null}

            <View style={styles.actionRow}>
              <Button
                variant="default"
                size="sm"
                onPress={handleSubmitPress}
                disabled={Boolean(blocker) || Boolean(duplicateProjectPath) || isSubmitting}
                loading={isSubmitting}
                testID="new-project-submit"
              >
                {submitLabel}
              </Button>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  content: {
    position: "relative",
    flex: 1,
    alignItems: "center",
  },
  contentCentered: {
    justifyContent: "center",
    // The header sits above this centring region, so reserve the same height at
    // the bottom - otherwise the block centres in the below-header space and
    // reads as sitting too low.
    paddingBottom: HEADER_INNER_HEIGHT + theme.spacing[6],
  },
  contentCompact: {
    justifyContent: "flex-end",
  },
  centered: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
  },
  titleContainer: {
    marginBottom: theme.spacing[8],
    paddingLeft: theme.spacing[6],
    paddingRight: theme.spacing[4],
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  body: {
    marginTop: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  // The action is a normal-sized button pinned to the trailing edge, not a
  // full-width bar - the column is a form, not a dialog footer.
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: theme.spacing[1],
  },
  pathPreview: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  statusText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  blockerText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
}));
