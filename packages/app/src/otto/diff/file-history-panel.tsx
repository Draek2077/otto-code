import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { History } from "lucide-react-native";
import invariant from "tiny-invariant";
import { useFetchQuery } from "@/data/query";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SelectField } from "@/components/ui/select-field";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { DiffDocument } from "@/git/diff-document";
import { useAppSettings } from "@/hooks/use-settings";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel } from "@/panels/panel-registry";
import {
  listFileRevisions,
  readFileRevisionDiff,
  readFileOrigin,
  readFileBlame,
  type FileHistoryCommit,
} from "@getpaseo/plugin/otto/workspace-git";
import { DiffPresentationControl, useHostDiffReview } from "./preferences";

const icon = withUnistyles(History);
const mode = { kind: "commit" as const };
const pageSize = 40;
const blameSize = 200;

function accept<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }) {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function FileHistoryPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "file_history", "File History requires a history tab");
  // COMPAT(ottoFileHistory): added v0.10.0; remove after 2027-05-20.
  const supported = useHostFeature(serverId, "ottoFileHistory");
  const active = useRetainedPanelActive();
  const online = useHostRuntimeIsConnected(serverId);
  const client = useHostRuntimeClient(serverId);
  const ready = supported && active && online && !!client;
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showOrigin, setShowOrigin] = useState(false);
  const { reviewPresentation, includeStructuralSource } = useHostDiffReview(serverId);
  const scope = useMemo(
    () => ({ hostId: serverId, workspaceId, file: target.path }),
    [serverId, target.path, workspaceId],
  );
  const call = useCallback(
    (method: string, input: unknown) => {
      if (!client) return Promise.reject(new Error("Connect to the workspace host."));
      return client.invokePluginRpc("otto-workspace-git", method, input, 70_000);
    },
    [client],
  );
  const history = useFetchQuery({
    queryKey: ["ottoFileHistory", scope, target.range, offset],
    dataShape: "value",
    staleTimeMs: 15_000,
    enabled: ready,
    retry: false,
    queryFn: async () =>
      accept(
        listFileRevisions.output.parse(
          await call(listFileRevisions.name, { ...scope, range: target.range, offset }),
        ),
      ),
  });
  const origin = useFetchQuery({
    queryKey: ["ottoFileOrigin", scope],
    dataShape: "value",
    staleTimeMs: 60_000,
    enabled: ready && showOrigin,
    retry: false,
    queryFn: async () =>
      accept(readFileOrigin.output.parse(await call(readFileOrigin.name, scope))),
  });
  const options = useMemo(
    () =>
      history.data?.entries.map((entry) => ({
        id: entry.sha,
        value: entry.sha,
        label: entry.subject || entry.shortSha,
        description: `${entry.shortSha} · ${entry.authorName}`,
      })) ?? [],
    [history.data],
  );
  const entry =
    history.data?.entries.find((commit) => commit.sha === selected) ?? history.data?.entries[0];
  const change = useCallback((sha: string) => setSelected(sha), []);
  const previous = useCallback(() => setOffset((value) => Math.max(0, value - pageSize)), []);
  const next = useCallback(() => setOffset((value) => value + pageSize), []);
  const toggleOrigin = useCallback(() => setShowOrigin((value) => !value), []);
  const reload = useCallback(() => void history.refetch(), [history]);
  if (!supported) return <Alert description="Update this host to use File History." />;
  if (!online) return <Alert description="Connect to the workspace host to see File History." />;
  return (
    <View style={styles.root} testID="otto-file-history">
      <View style={styles.controls}>
        <View style={styles.revisions}>
          <SelectField
            label="File revision"
            placeholder="Choose a revision"
            emptyText="No commits on this page"
            field={false}
            options={options}
            value={entry?.sha ?? null}
            selectedDisplay={options.find((item) => item.value === entry?.sha) ?? null}
            onChange={change}
            loading={history.isLoading}
            size="sm"
          />
        </View>
        <Button variant="outline" size="sm" disabled={offset === 0} onPress={previous}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={!history.data?.hasMore} onPress={next}>
          Next
        </Button>
        <Button variant="outline" size="sm" onPress={reload}>
          Refresh
        </Button>
        <Button variant="outline" size="sm" onPress={toggleOrigin}>
          {showOrigin ? "Hide origin" : "File origin"}
        </Button>
      </View>
      {history.error ? <Alert variant="error" description={history.error.message} /> : null}
      {showOrigin ? (
        <Text style={styles.meta}>{originMessage(origin.data, origin.error)}</Text>
      ) : null}
      {entry ? (
        <Revision
          key={entry.sha}
          entry={entry}
          scope={scope}
          call={call}
          active={ready}
          includeStructuralSource={includeStructuralSource}
          review={reviewPresentation}
        />
      ) : null}
      {history.data && !entry ? <Text style={styles.meta}>No commits for this file.</Text> : null}
    </View>
  );
}

type Invoke = (method: string, input: unknown) => Promise<unknown>;
interface Scope {
  hostId: string;
  workspaceId: string;
  file: string;
}

function Revision({
  entry,
  scope,
  call,
  active,
  includeStructuralSource,
  review,
}: {
  entry: FileHistoryCommit;
  scope: Scope;
  call: Invoke;
  active: boolean;
  includeStructuralSource: boolean;
  review: ReturnType<typeof useHostDiffReview>["reviewPresentation"];
}) {
  const { settings } = useAppSettings();
  const { preferences } = useChangesPreferences();
  const [showBlame, setShowBlame] = useState(false);
  const toggle = useCallback(() => setShowBlame((value) => !value), []);
  const request = useMemo(
    () => ({ ...scope, sha: entry.sha, revisionPath: entry.path }),
    [scope, entry.path, entry.sha],
  );
  const diff = useFetchQuery({
    queryKey: ["ottoFileRevisionDiff", request, includeStructuralSource],
    dataShape: "value",
    immutableWhen: () => true,
    enabled: active && !showBlame,
    retry: false,
    queryFn: async () =>
      accept(
        readFileRevisionDiff.output.parse(
          await call(readFileRevisionDiff.name, {
            ...request,
            ...(includeStructuralSource ? { includeStructuralSource: true } : {}),
          }),
        ),
      ),
  });
  const displayPreferences = useMemo(
    () => ({
      layout: preferences.layout,
      wrapLines: preferences.wrapLines,
      codeFontSize: settings.codeFontSize,
      monoFontFamily: settings.monoFontFamily,
    }),
    [preferences.layout, preferences.wrapLines, settings.codeFontSize, settings.monoFontFamily],
  );
  const files = useMemo(() => (diff.data ? [diff.data.file] : []), [diff.data]);
  return (
    <View style={styles.body}>
      <View style={styles.controls}>
        <Text style={styles.meta} numberOfLines={1}>
          {entry.authorName} · {new Date(entry.authoredAt * 1000).toLocaleDateString()} ·{" "}
          {entry.path}
        </Text>
        {!showBlame && files.length > 0 ? (
          <DiffPresentationControl inline value={review.presentation} onChange={review.select} />
        ) : null}
        <Button variant="outline" size="sm" onPress={toggle}>
          {showBlame ? "Show diff" : "Blame lines"}
        </Button>
      </View>
      {entry.body.trim() ? (
        <Text style={styles.meta} selectable numberOfLines={5}>
          {entry.body}
        </Text>
      ) : null}
      {showBlame ? <Blame request={request} call={call} active={active} /> : null}
      {!showBlame && diff.error ? <Alert variant="error" description={diff.error.message} /> : null}
      {!showBlame && files.length ? (
        <DiffDocument
          files={files}
          mode={mode}
          reviewPresentation={review}
          displayPreferences={displayPreferences}
        />
      ) : null}
      {!showBlame && diff.isLoading ? <Text style={styles.meta}>Loading revision…</Text> : null}
    </View>
  );
}

function Blame({
  request,
  call,
  active,
}: {
  request: Scope & { sha: string; revisionPath: string };
  call: Invoke;
  active: boolean;
}) {
  const [startLine, setStart] = useState(1);
  const previous = useCallback(() => setStart((value) => Math.max(1, value - blameSize)), []);
  const next = useCallback(() => setStart((value) => value + blameSize), []);
  const query = useFetchQuery({
    queryKey: ["ottoFileBlame", request, startLine],
    dataShape: "value",
    immutableWhen: () => true,
    enabled: active,
    retry: false,
    queryFn: async () =>
      accept(readFileBlame.output.parse(await call(readFileBlame.name, { ...request, startLine }))),
  });
  const commits = useMemo(
    () => new Map(query.data?.commits.map((item) => [item.sha, item])),
    [query.data],
  );
  if (query.error) return <Alert variant="error" description={query.error.message} />;
  if (!query.data) return <Text style={styles.meta}>Loading line authors…</Text>;
  return (
    <View style={styles.body}>
      <View style={styles.controls}>
        <Button variant="outline" size="sm" disabled={startLine === 1} onPress={previous}>
          Previous lines
        </Button>
        <Button variant="outline" size="sm" disabled={query.data.reachedEndOfFile} onPress={next}>
          Next lines
        </Button>
      </View>
      <ScrollView>
        {query.data.lines.map((line) => {
          const commit = commits.get(line.sha);
          return (
            <Text
              key={line.line}
              style={styles.meta}
              selectable
              testID={`otto-file-blame-line-${line.line}`}
            >
              {line.line} · {commit?.authorName ?? "Unknown"} · {commit?.shortSha} ·{" "}
              {commit?.summary}
            </Text>
          );
        })}
      </ScrollView>
    </View>
  );
}

function originMessage(origin: FileHistoryCommit | null | undefined, error: Error | null) {
  if (error) return error.message;
  if (origin === undefined) return "Looking up file origin…";
  if (!origin) return "No origin commit found.";
  return `Created by ${origin.authorName} · ${origin.shortSha} · ${origin.subject}`;
}

export const fileHistoryPanelRegistration = definePanel("file_history", {
  component: FileHistoryPanel,
  useDescriptor: (target) => ({
    label: `History: ${target.path.split(/[\\/]/).at(-1) ?? target.path}`,
    tooltip: target.path,
    titleState: "ready",
    icon,
    statusBucket: null,
    subtitle: target.range
      ? `Lines ${target.range.startLine}–${target.range.endLine}`
      : target.path,
  }),
});

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0 },
  body: { flex: 1, minHeight: 0 },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
  },
  revisions: { flex: 1, minWidth: 160 },
  meta: {
    paddingHorizontal: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
