/* oxlint-disable react-perf/jsx-no-new-function-as-prop */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { isWeb } from "@/constants/platform";
import { usePaneContext } from "@/panels/pane-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  useProjectKnowledge,
  type ProjectDeliveryStatus,
  type ProjectReferenceDisposition,
} from "@/context-management/use-project-knowledge";
import { usePanelStore } from "@/stores/panel-store";
import { formatDeliveryStatus, summarizeProjectKnowledge } from "./model";

const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 520;
const MIN_VIEWER_WIDTH = 360;
const SIDEBAR_SHELL_STYLE = { position: "relative" } as const;

/** Markdown knowledge is rendered as a document, while Otto owns mutations. */
// eslint-disable-next-line complexity -- panel intentionally owns its three explicit review states.
export function ProjectKnowledgePanel(): ReactElement {
  const { serverId, workspaceId, openFileInWorkspace } = usePaneContext();
  const knowledge = useProjectKnowledge(serverId, workspaceId);
  const readRecord = knowledge.readRecord;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recordDetail, setRecordDetail] = useState<KnowledgeRecord | null>(null);
  const [selectedRootSlug, setSelectedRootSlug] = useState<string | null>(null);
  const [scope, setScope] = useState<"knowledge" | "projects" | "references">("knowledge");
  const [filter, setFilter] = useState<"all" | "proposed" | "confirmed" | "superseded">("all");
  const [creating, setCreating] = useState(false);
  const [editingTruth, setEditingTruth] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [kind, setKind] = useState<
    "decision" | "constraint" | "requirement" | "architecture" | "project" | "reference"
  >("decision");
  const [evidence, setEvidence] = useState("");
  const [tags, setTags] = useState("");
  const [truthReason, setTruthReason] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState<ProjectDeliveryStatus>("charter");
  const [progressCompleted, setProgressCompleted] = useState("");
  const [progressTotal, setProgressTotal] = useState("");
  const [progressUnit, setProgressUnit] = useState("milestones");
  const [referenceDisposition, setReferenceDisposition] =
    useState<ProjectReferenceDisposition>("unevaluated");
  const [sourceUrl, setSourceUrl] = useState("");
  const [metadataReason, setMetadataReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const knowledgeSidebarWidth = usePanelStore((state) => state.projectKnowledgeSidebarWidth);
  const setKnowledgeSidebarWidth = usePanelStore((state) => state.setProjectKnowledgeSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const startWidthRef = useRef(knowledgeSidebarWidth);
  const resizeWidth = useSharedValue(knowledgeSidebarWidth);
  const maxSidebarWidth = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - MIN_VIEWER_WIDTH),
  );
  useEffect(() => {
    if (knowledgeSidebarWidth > maxSidebarWidth) {
      setKnowledgeSidebarWidth(maxSidebarWidth);
      return;
    }
    resizeWidth.value = knowledgeSidebarWidth;
  }, [knowledgeSidebarWidth, maxSidebarWidth, resizeWidth, setKnowledgeSidebarWidth]);
  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = knowledgeSidebarWidth;
          resizeWidth.value = knowledgeSidebarWidth;
        })
        .onUpdate((event) => {
          const next = startWidthRef.current + event.translationX;
          resizeWidth.value = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxSidebarWidth, next));
        })
        .onEnd(() => runOnJS(setKnowledgeSidebarWidth)(resizeWidth.value)),
    [knowledgeSidebarWidth, maxSidebarWidth, resizeWidth, setKnowledgeSidebarWidth],
  );
  const sidebarWidthStyle = useAnimatedStyle(() => ({ width: resizeWidth.value }));
  const sidebarShellStyle = useMemo(
    () => [SIDEBAR_SHELL_STYLE, sidebarWidthStyle],
    [sidebarWidthStyle],
  );
  const records = useMemo(
    () =>
      knowledge.view?.records.filter(
        (record) =>
          (filter === "all" || record.status === filter) && recordMatchesScope(record.kind, scope),
      ) ?? [],
    [filter, knowledge.view, scope],
  );
  const selectedRoot =
    scope === "knowledge"
      ? (knowledge.view?.rootPages?.find((page) => page.slug === selectedRootSlug) ?? null)
      : null;
  const selectedSummary = selectedRoot
    ? null
    : (records.find((record) => record.id === selectedId) ?? records[0] ?? null);
  const detailedSelection =
    recordDetail &&
    selectedSummary &&
    recordDetail.id === selectedSummary.id &&
    recordDetail.updatedAt === selectedSummary.updatedAt
      ? recordDetail
      : null;
  const selected = detailedSelection ?? selectedSummary;
  useEffect(() => {
    if (!selectedSummary) {
      setRecordDetail(null);
      return;
    }
    let cancelled = false;
    setRecordDetail(null);
    void readRecord(selectedSummary.id)
      .then((record) => {
        if (!cancelled) setRecordDetail(record);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setRecordDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [readRecord, selectedSummary]);
  const summary = useMemo(
    () => summarizeProjectKnowledge(knowledge.view?.records ?? []),
    [knowledge.view?.records],
  );
  let document =
    "# Project knowledge\n\nSelect a root page or record to inspect its Markdown-backed current truth.";
  if (selectedRoot) {
    document = selectedRoot.body;
  } else if (selected) {
    document = recordMarkdown(
      selected,
      knowledge.view?.findings.filter(
        (finding) => finding.recordId === selected.id || finding.relatedRecordId === selected.id,
      ) ?? [],
    );
  }
  const markdownPath = selectedRoot?.path ?? knowledgePathForRecord(selected);
  const openMarkdown = useCallback(() => {
    if (!markdownPath) return;
    openFileInWorkspace({ location: { path: markdownPath }, disposition: "main" });
  }, [markdownPath, openFileInWorkspace]);
  const setStatus = useCallback(
    async (status: "confirmed" | "superseded") => {
      if (!selected) return;
      const confirmed = await confirmDialog({
        title:
          status === "confirmed" ? "Confirm project knowledge?" : "Supersede project knowledge?",
        message:
          status === "confirmed"
            ? "This reviewed record becomes active project knowledge that agents can pull when needed."
            : "The record stays as historical evidence but is removed from normal knowledge search.",
        confirmLabel: status === "confirmed" ? "Confirm" : "Supersede",
        destructive: status === "superseded",
      });
      if (confirmed) await knowledge.setStatus(selected.id, status);
    },
    [knowledge, selected],
  );
  const startCreate = useCallback(() => {
    if (scope === "projects") setKind("project");
    else if (scope === "references") setKind("reference");
    else setKind("decision");
    setFormError(null);
    setCreating(true);
  }, [scope]);
  const create = useCallback(async () => {
    setFormError(null);
    let progress: { completed: number; total: number; unit: string } | undefined;
    if (kind === "project" && (progressCompleted.trim() || progressTotal.trim())) {
      const completed = Number(progressCompleted);
      const total = Number(progressTotal);
      if (
        !Number.isInteger(completed) ||
        completed < 0 ||
        !Number.isInteger(total) ||
        total <= 0 ||
        completed > total ||
        !progressUnit.trim()
      ) {
        setFormError(
          "Progress needs whole numbers, completed cannot exceed total, and unit is required.",
        );
        return;
      }
      progress = { completed, total, unit: progressUnit.trim() };
    }
    const error = await knowledge.createProposal({
      kind,
      title,
      statement,
      ...(evidence.trim() ? { evidence } : {}),
      ...(tags.trim()
        ? {
            tags: tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          }
        : {}),
      ...(kind === "project" ? { deliveryStatus } : {}),
      ...(progress ? { progress } : {}),
      ...(kind === "reference" ? { referenceDisposition } : {}),
      ...(kind === "reference" && sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
    });
    if (!error) {
      setCreating(false);
      setTitle("");
      setStatement("");
      setEvidence("");
      setTags("");
      setProgressCompleted("");
      setProgressTotal("");
      setSourceUrl("");
    } else setFormError(error);
  }, [
    deliveryStatus,
    evidence,
    kind,
    knowledge,
    progressCompleted,
    progressTotal,
    progressUnit,
    referenceDisposition,
    sourceUrl,
    statement,
    tags,
    title,
  ]);
  const saveTruth = useCallback(async () => {
    if (!selected) return;
    const error = await knowledge.updateTruth({
      id: selected.id,
      statement,
      reason: truthReason,
      expectedUpdatedAt: selected.updatedAt,
    });
    if (!error) {
      setEditingTruth(false);
      setStatement("");
      setTruthReason("");
    }
  }, [knowledge, selected, statement, truthReason]);
  const saveMetadata = useCallback(async () => {
    if (!selected) return;
    setFormError(null);
    let error: string | null;
    if (selected.kind === "project") {
      let progress: { completed: number; total: number; unit: string } | null = null;
      if (progressCompleted.trim() || progressTotal.trim()) {
        const completed = Number(progressCompleted);
        const total = Number(progressTotal);
        if (
          !Number.isInteger(completed) ||
          completed < 0 ||
          !Number.isInteger(total) ||
          total <= 0 ||
          completed > total ||
          !progressUnit.trim()
        ) {
          setFormError(
            "Progress needs whole numbers, completed cannot exceed total, and unit is required.",
          );
          return;
        }
        progress = { completed, total, unit: progressUnit.trim() };
      }
      error = await knowledge.updateProject({
        id: selected.id,
        deliveryStatus,
        progress,
        reason: metadataReason,
        expectedUpdatedAt: selected.updatedAt,
      });
    } else if (selected.kind === "reference") {
      error = await knowledge.updateReference({
        id: selected.id,
        disposition: referenceDisposition,
        sourceUrl: sourceUrl.trim() || null,
        reason: metadataReason,
        expectedUpdatedAt: selected.updatedAt,
      });
    } else return;
    if (!error) {
      setEditingMetadata(false);
      setMetadataReason("");
    } else setFormError(error);
  }, [
    deliveryStatus,
    knowledge,
    metadataReason,
    progressCompleted,
    progressTotal,
    progressUnit,
    referenceDisposition,
    selected,
    sourceUrl,
  ]);
  const creationCopy = knowledgeCreationCopy(kind);
  const emptyCopy = emptyScopeCopy(scope);
  const newButtonLabel = emptyCopy.newLabel;
  let viewer: ReactElement;
  if (creating) {
    viewer = (
      <View style={styles.composer}>
        <Text style={styles.viewerTitle}>{creationCopy.title}</Text>
        <Text style={styles.description}>{creationCopy.description}</Text>
        {scope === "knowledge" ? (
          <>
            <Text style={styles.fieldLabel}>Kind</Text>
            <SegmentedControl
              size="sm"
              stretch
              value={kind}
              onValueChange={setKind}
              options={[
                { value: "decision", label: "Decision" },
                { value: "constraint", label: "Constraint" },
                { value: "requirement", label: "Requirement" },
                { value: "architecture", label: "Architecture" },
              ]}
            />
          </>
        ) : null}
        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Short title"
          placeholderTextColor="#777"
          style={styles.input}
        />
        <Text style={styles.fieldLabel}>{creationCopy.bodyLabel}</Text>
        <TextInput
          value={statement}
          onChangeText={setStatement}
          multiline
          placeholder="Rich Markdown: headings, lists, links, code, and [[wiki links]]"
          placeholderTextColor="#777"
          style={[styles.input, styles.statement]}
        />
        {kind === "project" ? (
          <>
            <Text style={styles.fieldLabel}>Delivery status</Text>
            <SegmentedControl
              size="sm"
              value={deliveryStatus}
              onValueChange={setDeliveryStatus}
              options={PROJECT_STATUS_OPTIONS}
            />
            <Text style={styles.fieldLabel}>
              Progress <Text style={styles.optional}>Optional</Text>
            </Text>
            <View style={styles.progressFields}>
              <TextInput
                value={progressCompleted}
                onChangeText={setProgressCompleted}
                keyboardType="number-pad"
                placeholder="Done"
                placeholderTextColor="#777"
                style={[styles.input, styles.progressNumber]}
              />
              <Text style={styles.muted}>of</Text>
              <TextInput
                value={progressTotal}
                onChangeText={setProgressTotal}
                keyboardType="number-pad"
                placeholder="Total"
                placeholderTextColor="#777"
                style={[styles.input, styles.progressNumber]}
              />
              <TextInput
                value={progressUnit}
                onChangeText={setProgressUnit}
                placeholder="milestones"
                placeholderTextColor="#777"
                style={[styles.input, styles.progressUnit]}
              />
            </View>
          </>
        ) : null}
        {kind === "reference" ? (
          <>
            <Text style={styles.fieldLabel}>Evaluation</Text>
            <SegmentedControl
              size="sm"
              value={referenceDisposition}
              onValueChange={setReferenceDisposition}
              options={REFERENCE_OPTIONS}
            />
            <Text style={styles.fieldLabel}>
              Source URL <Text style={styles.optional}>Optional</Text>
            </Text>
            <TextInput
              value={sourceUrl}
              onChangeText={setSourceUrl}
              autoCapitalize="none"
              placeholder="https://…"
              placeholderTextColor="#777"
              style={styles.input}
            />
          </>
        ) : null}
        <Text style={styles.fieldLabel}>
          Evidence <Text style={styles.optional}>Optional</Text>
        </Text>
        <TextInput
          value={evidence}
          onChangeText={setEvidence}
          multiline
          placeholder="Issue, code path, test, or decision record that supports this"
          placeholderTextColor="#777"
          style={[styles.input, styles.evidence]}
        />
        <Text style={styles.fieldLabel}>
          Tags <Text style={styles.optional}>Optional</Text>
        </Text>
        <TextInput
          value={tags}
          onChangeText={setTags}
          placeholder="Comma-separated, for example: protocol, compatibility"
          placeholderTextColor="#777"
          style={styles.input}
        />
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <View style={styles.viewerToolbar}>
          <Button variant="outline" size="sm" onPress={() => setCreating(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!title.trim() || !statement.trim()}
            onPress={() => void create()}
          >
            {creationCopy.saveLabel}
          </Button>
        </View>
      </View>
    );
  } else if (selectedRoot) {
    viewer = <MarkdownRenderer text={document} remoteImages="altText" />;
  } else if (editingTruth && selected) {
    viewer = (
      <View style={styles.composer}>
        <Text style={styles.viewerTitle}>Update current truth</Text>
        <Text style={styles.description}>
          Otto will atomically append the reason to this page&apos;s permanent timeline.
        </Text>
        <TextInput
          value={statement}
          onChangeText={setStatement}
          multiline
          placeholder="Compiled truth in rich Markdown"
          placeholderTextColor="#777"
          style={[styles.input, styles.statement]}
        />
        <TextInput
          value={truthReason}
          onChangeText={setTruthReason}
          multiline
          placeholder="Why did the current truth change?"
          placeholderTextColor="#777"
          style={[styles.input, styles.statement]}
        />
        <View style={styles.viewerToolbar}>
          <Button variant="outline" size="sm" onPress={() => setEditingTruth(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!statement.trim() || !truthReason.trim()}
            onPress={() => void saveTruth()}
          >
            Save with reason
          </Button>
        </View>
      </View>
    );
  } else if (
    editingMetadata &&
    selected &&
    (selected.kind === "project" || selected.kind === "reference")
  ) {
    viewer = (
      <View style={styles.composer}>
        <Text style={styles.viewerTitle}>
          {selected.kind === "project" ? "Update delivery" : "Update reference evaluation"}
        </Text>
        <Text style={styles.description}>
          This changes operational metadata, not whether the page itself is confirmed knowledge.
          Otto appends your reason to the permanent timeline.
        </Text>
        {selected.kind === "project" ? (
          <>
            <Text style={styles.fieldLabel}>Delivery status</Text>
            <SegmentedControl
              size="sm"
              value={deliveryStatus}
              onValueChange={setDeliveryStatus}
              options={PROJECT_STATUS_OPTIONS}
            />
            <Text style={styles.fieldLabel}>Measured progress</Text>
            <View style={styles.progressFields}>
              <TextInput
                value={progressCompleted}
                onChangeText={setProgressCompleted}
                keyboardType="number-pad"
                placeholder="Done"
                placeholderTextColor="#777"
                style={[styles.input, styles.progressNumber]}
              />
              <Text style={styles.muted}>of</Text>
              <TextInput
                value={progressTotal}
                onChangeText={setProgressTotal}
                keyboardType="number-pad"
                placeholder="Total"
                placeholderTextColor="#777"
                style={[styles.input, styles.progressNumber]}
              />
              <TextInput
                value={progressUnit}
                onChangeText={setProgressUnit}
                placeholder="milestones"
                placeholderTextColor="#777"
                style={[styles.input, styles.progressUnit]}
              />
            </View>
            <Text style={styles.muted}>Leave both numbers blank to remove the metric.</Text>
          </>
        ) : (
          <>
            <Text style={styles.fieldLabel}>Evaluation</Text>
            <SegmentedControl
              size="sm"
              value={referenceDisposition}
              onValueChange={setReferenceDisposition}
              options={REFERENCE_OPTIONS}
            />
            <Text style={styles.fieldLabel}>Source URL</Text>
            <TextInput
              value={sourceUrl}
              onChangeText={setSourceUrl}
              autoCapitalize="none"
              placeholder="https://…"
              placeholderTextColor="#777"
              style={styles.input}
            />
          </>
        )}
        <Text style={styles.fieldLabel}>Reason</Text>
        <TextInput
          value={metadataReason}
          onChangeText={setMetadataReason}
          multiline
          placeholder="What changed, and what evidence supports it?"
          placeholderTextColor="#777"
          style={[styles.input, styles.evidence]}
        />
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <View style={styles.viewerToolbar}>
          <Button variant="outline" size="sm" onPress={() => setEditingMetadata(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!metadataReason.trim()} onPress={() => void saveMetadata()}>
            Save with reason
          </Button>
        </View>
      </View>
    );
  } else if (selected) {
    viewer = (
      <>
        <View style={styles.viewerHeader}>
          <View>
            <Text style={styles.viewerTitle}>{selected.title}</Text>
            <Text style={styles.muted}>
              {recordStatusLabel(selected)} · Updated{" "}
              {new Date(selected.updatedAt).toLocaleDateString()}
            </Text>
          </View>
          <View style={styles.viewerToolbar}>
            <Button
              variant="outline"
              size="sm"
              onPress={() => {
                setStatement(selected.statement);
                setTruthReason("");
                setEditingTruth(true);
              }}
            >
              Update truth
            </Button>
            {selected.kind === "project" || selected.kind === "reference" ? (
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  setDeliveryStatus(selected.deliveryStatus ?? "charter");
                  setProgressCompleted(
                    selected.progress ? String(selected.progress.completed) : "",
                  );
                  setProgressTotal(selected.progress ? String(selected.progress.total) : "");
                  setProgressUnit(selected.progress?.unit ?? "milestones");
                  setReferenceDisposition(selected.referenceDisposition ?? "unevaluated");
                  setSourceUrl(selected.sourceUrl ?? "");
                  setMetadataReason("");
                  setFormError(null);
                  setEditingMetadata(true);
                }}
              >
                {selected.kind === "project" ? "Update delivery" : "Update evaluation"}
              </Button>
            ) : null}
            {selected.status !== "confirmed" ? (
              <Button variant="outline" size="sm" onPress={() => void setStatus("confirmed")}>
                Confirm
              </Button>
            ) : null}
            {selected.status !== "superseded" ? (
              <Button variant="outline" size="sm" onPress={() => void setStatus("superseded")}>
                Supersede
              </Button>
            ) : null}
          </View>
        </View>
        <MarkdownRenderer text={document} remoteImages="altText" />
      </>
    );
  } else {
    viewer = (
      <View style={styles.empty}>
        <Text style={styles.viewerTitle}>{emptyCopy.title}</Text>
        <Text style={styles.description}>{emptyCopy.description}</Text>
        <Button onPress={startCreate}>{emptyCopy.createLabel}</Button>
      </View>
    );
  }
  return (
    <View style={styles.root} testID="project-knowledge-panel">
      <Animated.View style={sidebarShellStyle}>
        <View style={styles.sidebar}>
          <View style={styles.summary}>
            <Text style={styles.heading}>Knowledge</Text>
            <Text style={styles.description}>
              Confirmed pages are discoverable in every chat. Full Markdown loads only when the task
              needs it.
            </Text>
            <SegmentedControl
              size="sm"
              stretch
              value={scope}
              onValueChange={(value) => {
                setScope(value);
                setSelectedId(null);
                setSelectedRootSlug(null);
                setCreating(false);
              }}
              options={[
                { value: "knowledge", label: "Knowledge" },
                { value: "projects", label: "Projects" },
                { value: "references", label: "References" },
              ]}
            />
            <Text style={styles.muted}>
              {scopeSummary(scope, summary, knowledge.view?.briefTokens ?? 0)}
            </Text>
            <Button size="sm" onPress={startCreate}>
              {newButtonLabel}
            </Button>
          </View>
          {scope === "knowledge" ? (
            <View style={styles.filters}>
              <Text style={styles.fieldLabel}>Knowledge map</Text>
              <ScrollView horizontal contentContainerStyle={styles.rootPages}>
                {(knowledge.view?.rootPages ?? []).map((page) => (
                  <Button
                    key={page.slug}
                    variant={selectedRoot?.slug === page.slug ? "secondary" : "outline"}
                    size="sm"
                    onPress={() => {
                      setSelectedRootSlug(page.slug);
                      setSelectedId(null);
                    }}
                  >
                    {page.title}
                  </Button>
                ))}
              </ScrollView>
            </View>
          ) : null}
          <View style={styles.filters}>
            <SegmentedControl
              size="sm"
              stretch
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "proposed", label: "Proposed" },
                { value: "confirmed", label: "Confirmed" },
                { value: "superseded", label: "History" },
              ]}
            />
          </View>
          <ScrollView style={styles.browser}>
            {records.map((record) => (
              <Pressable
                key={record.id}
                // oxlint-disable-next-line react-perf/jsx-no-new-function-as-prop
                onPress={() => {
                  setSelectedRootSlug(null);
                  setSelectedId(record.id);
                }}
                style={record.id === selected?.id ? styles.selectedRow : styles.row}
              >
                <Text style={styles.rowTitle}>{record.title}</Text>
                <Text style={styles.muted}>{recordStatusLabel(record)}</Text>
                <Text numberOfLines={2} style={styles.muted}>
                  {record.statement}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <GestureDetector gesture={resizeGesture}>
          <View style={RESIZE_HANDLE_STYLE} testID="project-knowledge-splitter" />
        </GestureDetector>
      </Animated.View>
      <ScrollView style={styles.viewer} contentContainerStyle={styles.viewerContent}>
        <View style={styles.viewerToolbar}>
          <Text style={styles.pathLabel}>{markdownPath ?? "Markdown source unavailable"}</Text>
          {markdownPath ? (
            <Button variant="outline" size="sm" onPress={openMarkdown}>
              Open Markdown
            </Button>
          ) : null}
        </View>
        {viewer}
      </ScrollView>
    </View>
  );
}

type KnowledgeRecord = NonNullable<
  ReturnType<typeof useProjectKnowledge>["view"]
>["records"][number];

function knowledgePathForRecord(record: KnowledgeRecord | null): string | null {
  if (!record) return null;
  return record.path ?? `.otto/knowledge/${record.kind}s/${record.id}.md`;
}
function recordMarkdown(record: KnowledgeRecord, findings: readonly { message: string }[]): string {
  let operational = "";
  if (record.kind === "project") {
    const progress = record.progress
      ? `${record.progress.completed} of ${record.progress.total} ${record.progress.unit} (${Math.round((record.progress.completed / record.progress.total) * 100)}%)`
      : "Not measured";
    operational = `\n\n## Delivery\n\n- Status: **${formatDeliveryStatus(record.deliveryStatus)}**\n- Progress: ${progress}`;
  } else if (record.kind === "reference") {
    const source = record.sourceUrl ? `[${record.sourceUrl}](${record.sourceUrl})` : "Not recorded";
    operational = `\n\n## Reference\n\n- Evaluation: **${record.referenceDisposition ?? "unevaluated"}**\n- Source: ${source}`;
  }
  return `# ${record.title}\n\n**${record.kind} · ${record.status}**${operational}\n\n## Current understanding\n\n${record.statement}\n\n## Evidence\n\n${record.evidence || "No evidence recorded."}\n\n## Tags\n\n${record.tags.map((tag) => `\`${tag}\``).join(" ") || "None"}\n\n## Timeline\n\n${record.provenance?.map((entry) => `- ${entry.recordedAt} [${entry.kind ?? "note"}]: ${entry.text}${entry.source ? ` (${entry.source})` : ""}`).join("\n") || "No timeline recorded."}\n\n## Review signals\n\n${findings.map((finding) => `- ${finding.message}`).join("\n") || "No current signals."}\n\n_Last updated ${record.updatedAt}._`;
}
function recordStatusLabel(record: KnowledgeRecord): string {
  if (record.kind === "project")
    return `project · ${formatDeliveryStatus(record.deliveryStatus)} · ${record.status}`;
  if (record.kind === "reference")
    return `reference · ${record.referenceDisposition ?? "unevaluated"} · ${record.status}`;
  return `${record.kind} · ${record.status}`;
}
function recordMatchesScope(
  kind: KnowledgeRecord["kind"],
  scope: "knowledge" | "projects" | "references",
): boolean {
  if (scope === "projects") return kind === "project";
  if (scope === "references") return kind === "reference";
  return kind !== "project" && kind !== "reference";
}
function knowledgeCreationCopy(kind: KnowledgeRecord["kind"]): {
  title: string;
  description: string;
  bodyLabel: string;
  saveLabel: string;
} {
  if (kind === "project")
    return {
      title: "New project charter",
      description:
        "Describe the outcome, scope, constraints, and acceptance criteria. Review state and delivery state remain separate.",
      bodyLabel: "Charter",
      saveLabel: "Save charter",
    };
  if (kind === "reference")
    return {
      title: "New project reference",
      description:
        "Record what the source says, how it affected the project, and whether it was adopted or rejected.",
      bodyLabel: "Evaluation",
      saveLabel: "Save reference",
    };
  return {
    title: "New knowledge proposal",
    description:
      "Capture the full current understanding. Evidence and tags make it useful to someone outside the original discussion.",
    bodyLabel: "Current understanding",
    saveLabel: "Save proposal",
  };
}
function emptyScopeCopy(scope: "knowledge" | "projects" | "references"): {
  title: string;
  description: string;
  createLabel: string;
  newLabel: string;
} {
  if (scope === "projects")
    return {
      title: "Start with a charter",
      description:
        "Define the outcome and acceptance criteria, then track delivery without confusing it with knowledge review.",
      createLabel: "Create charter",
      newLabel: "New charter",
    };
  if (scope === "references")
    return {
      title: "Start with a reference",
      description: "Preserve sources and the reasons they were adopted or rejected.",
      createLabel: "Create reference",
      newLabel: "New reference",
    };
  return {
    title: "Start with a proposal",
    description:
      "Capture a durable fact while the context is fresh. It remains a proposal until the team deliberately confirms it.",
    createLabel: "Create proposal",
    newLabel: "New proposal",
  };
}
function scopeSummary(
  scope: "knowledge" | "projects" | "references",
  summary: ReturnType<typeof summarizeProjectKnowledge>,
  briefTokens: number,
): string {
  if (scope === "projects")
    return `${summary.projects} projects · ${summary.projectsComplete} complete · ${summary.projectsInFlight} active${summary.measuredPercentage === null ? "" : ` · ${summary.measuredPercentage}% measured progress`}`;
  if (scope === "references")
    return `${summary.references} references · ${summary.referencesAdopted} adopted · ${summary.referencesRejected} rejected`;
  return `${briefTokens} catalog tokens per chat`;
}
const PROJECT_STATUS_OPTIONS: { value: ProjectDeliveryStatus; label: string }[] = [
  { value: "charter", label: "Charter" },
  { value: "in_build", label: "Building" },
  { value: "partial", label: "Partial" },
  { value: "blocked", label: "Blocked" },
  { value: "complete", label: "Complete" },
  { value: "reference", label: "Reference" },
  { value: "deferred", label: "Deferred" },
  { value: "cancelled", label: "Cancelled" },
];
const REFERENCE_OPTIONS: { value: ProjectReferenceDisposition; label: string }[] = [
  { value: "unevaluated", label: "New" },
  { value: "read", label: "Read" },
  { value: "adopted", label: "Adopted" },
  { value: "rejected", label: "Rejected" },
  { value: "dependency", label: "Dependency" },
];
const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, flexDirection: "row" },
  sidebar: {
    flex: 1,
    minWidth: 0,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  resizeHandle: {
    position: "absolute",
    right: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  summary: {
    padding: theme.spacing[3],
    gap: theme.spacing[1],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  heading: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    fontSize: theme.fontSize.base,
  },
  muted: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.sm },
  description: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.sm, lineHeight: 20 },
  filters: {
    padding: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  rootPages: { gap: theme.spacing[2], paddingTop: theme.spacing[2] },
  browser: { flex: 1 },
  row: {
    padding: theme.spacing[3],
    gap: theme.spacing[1],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  selectedRow: {
    padding: theme.spacing[3],
    gap: theme.spacing[1],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  rowTitle: { color: theme.colors.foreground, fontWeight: "600" },
  viewer: { flex: 1 },
  viewerContent: { padding: theme.spacing[6], maxWidth: 920 },
  viewerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    marginBottom: theme.spacing[4],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  viewerTitle: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    fontSize: theme.fontSize.base,
  },
  viewerToolbar: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  pathLabel: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.xs, flex: 1 },
  empty: { gap: theme.spacing[3], maxWidth: 440, paddingTop: theme.spacing[12] },
  composer: { gap: theme.spacing[3], maxWidth: 640 },
  input: {
    color: theme.colors.foreground,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    minHeight: 44,
    fontSize: theme.fontSize.sm,
  },
  statement: { minHeight: 132, paddingVertical: theme.spacing[3], textAlignVertical: "top" },
  evidence: { minHeight: 88, paddingVertical: theme.spacing[3], textAlignVertical: "top" },
  fieldLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  optional: { color: theme.colors.mutedForeground, fontWeight: theme.fontWeight.normal },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  progressFields: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  progressNumber: { width: 88 },
  progressUnit: { flex: 1 },
}));

const RESIZE_HANDLE_STYLE = [styles.resizeHandle, isWeb && ({ cursor: "col-resize" } as object)];
