import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { ArchiveX } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID, type HostPickerHost } from "@/components/hosts/host-picker";
import type { AgentHistoryScope } from "@/hooks/use-agent-history";
import { useProjects } from "@/hooks/use-projects";
import { useArchiveDescriptions, useArchiveTargets, useClearArchive } from "./use-archive-history";

type ArchiveSelection = "all" | "active" | "archived";
const ARCHIVE_OPTIONS: Array<{ value: ArchiveSelection; label: string; testID: string }> = [
  { value: "all", label: "All", testID: "sessions-archive-all" },
  { value: "active", label: "Active", testID: "sessions-archive-active" },
  { value: "archived", label: "Archived", testID: "sessions-archive-archived" },
];
const allProjects = "otto:all-projects";
const hostOptionTestID = (id: string) => `sessions-host-filter-item-${id}`;

interface ToolbarInput {
  hosts: HostPickerHost[];
  selectedHost: string;
  onSelectHost(serverId: string): void;
}

function useHistoryProjects(serverId: string | null) {
  const { projects, isLoading } = useProjects();
  const [value, setValue] = useState(allProjects);
  const list = useMemo(
    () =>
      projects.filter(
        (project) => !serverId || project.hosts.some((host) => host.serverId === serverId),
      ),
    [projects, serverId],
  );
  const options = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: allProjects, value: allProjects, label: "All projects" },
      ...list.map((project) => ({
        id: project.viewKey,
        value: project.viewKey,
        label: project.projectCustomName || project.projectName,
      })),
    ],
    [list],
  );
  const projectKeysByHost = useMemo(() => {
    if (value === allProjects) return undefined;
    const project = list.find((item) => item.viewKey === value);
    const byHost = new Map<string, string[]>();
    for (const host of project?.hosts ?? []) {
      const existing = byHost.get(host.serverId);
      if (existing) existing.push(host.projectId);
      else byHost.set(host.serverId, [host.projectId]);
    }
    return Object.fromEntries(byHost);
  }, [list, value]);
  return { value, setValue, options, projectKeysByHost, isLoading };
}

export function useHistoryToolbar({ hosts, selectedHost, onSelectHost }: ToolbarInput) {
  const serverId = selectedHost === ALL_HOSTS_OPTION_ID ? null : selectedHost;
  const [archiveSelection, setArchiveSelection] = useState<ArchiveSelection>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const project = useHistoryProjects(serverId);
  const { setValue: setProjectValue } = project;
  const { canFilter, canReview, eligible, selected, excluded } = useArchiveTargets(hosts, serverId);
  const archive = useClearArchive({ serverId, targets: selected, excluded });
  const { cancel: cancelArchive } = archive;
  const descriptions = useArchiveDescriptions(eligible, hosts.length, pickerOpen);
  const projectKeysByHost = project.projectKeysByHost;
  const archiveStatus = canFilter && archiveSelection !== "all" ? archiveSelection : undefined;
  const scope = useMemo<AgentHistoryScope | undefined>(
    () => (archiveStatus || projectKeysByHost ? { archiveStatus, projectKeysByHost } : undefined),
    [archiveStatus, projectKeysByHost],
  );
  const selectHost = useCallback(
    (id: string) => {
      if (id === selectedHost) return;
      cancelArchive();
      setProjectValue(allProjects);
      onSelectHost(id);
    },
    [cancelArchive, onSelectHost, setProjectValue, selectedHost],
  );
  const showHost = hosts.length > 1 || (hosts.length === 1 && canReview);
  const includeAll = hosts.length > 1;
  const displayedHost = includeAll ? selectedHost : (hosts[0]?.serverId ?? selectedHost);
  const chosenProject = project.options.find((option) => option.value === project.value);
  const showProject = project.options.length > 1 || project.value !== allProjects;
  const showToolbar = showHost || showProject || canFilter || canReview;

  return {
    scope,
    toolbar: showToolbar ? (
      <View style={styles.row}>
        {showHost ? (
          <HostFilter
            hosts={hosts}
            selectedHost={displayedHost}
            onSelectHost={selectHost}
            includeAllHost={includeAll}
            optionDescriptions={descriptions}
            onPickerOpenChange={setPickerOpen}
            triggerTestID="sessions-host-filter-trigger"
            hostOptionTestID={hostOptionTestID}
          />
        ) : null}
        {showProject ? (
          <View style={styles.project}>
            <SelectField
              field={false}
              size="sm"
              label="Filter by project"
              value={project.value}
              selectedDisplay={chosenProject ?? null}
              options={project.options}
              onChange={project.setValue}
              placeholder="All projects"
              emptyText="No projects"
              loading={project.isLoading}
              triggerTestID="sessions-project-filter-trigger"
            />
          </View>
        ) : null}
        {canFilter ? (
          <SegmentedControl
            options={ARCHIVE_OPTIONS}
            value={archiveSelection}
            onValueChange={setArchiveSelection}
            size="sm"
            testID="sessions-archive-filter"
          />
        ) : null}
        {canReview ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={ArchiveX}
            onPress={archive.clear}
            disabled={archive.busy}
            testID="sessions-clear-archived"
          >
            {archive.busy ? "Reviewing archive…" : "Clear archived"}
          </Button>
        ) : null}
      </View>
    ) : null,
  };
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[2],
    rowGap: theme.spacing[2],
  },
  project: { minWidth: 128, maxWidth: 240 },
}));
