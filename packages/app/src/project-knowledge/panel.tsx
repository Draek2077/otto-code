/* oxlint-disable react-perf/jsx-no-new-function-as-prop */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import {
  Archive,
  Architecture,
  BookOpen,
  Check,
  Checklist,
  ClearAll,
  FolderOpen,
  FolderTree,
  Gavel,
  Lightbulb,
  Pencil,
  Robot,
  Search,
  Settings2,
  Shield,
  SquarePen,
  Trash2,
  X,
} from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageLoading } from "@/components/ui/page-loading";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SearchClearButton } from "@/components/ui/search-clear-button";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { ToolbarSeparator } from "@/components/ui/toolbar-separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import { usePaneContext } from "@/panels/pane-context";
import { alertDialog, confirmDialog } from "@/utils/confirm-dialog";
import {
  useProjectKnowledge,
  type ProjectDeliveryStatus,
  type ProjectReferenceDisposition,
} from "@/context-management/use-project-knowledge";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { openRefineTab } from "@/refine/open-refine-tab";
import {
  applyDirectReplacements,
  buildKnowledgeReviewInstruction,
  type KnowledgeReviewDirective,
} from "./review-session";
import {
  formatDeliveryStatus,
  formatMetadataLabel,
  recordMatchesTags,
  summarizeProjectKnowledge,
  uniqueTags,
} from "./model";
import type { IconSizeProp } from "@/components/icons/icon-size";

const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 520;
const MIN_VIEWER_WIDTH = 360;
const SIDEBAR_SHELL_STYLE = { position: "relative" } as const;
const SELECTED_ACCESSIBILITY_STATE = { selected: true } as const;

/** Markdown knowledge is rendered as a document, while Otto owns mutations. */
// eslint-disable-next-line complexity -- panel intentionally owns its three explicit review states.
export function ProjectKnowledgePanel(): ReactElement {
  const { serverId, workspaceId, openFileInWorkspace } = usePaneContext();
  const knowledge = useProjectKnowledge(serverId, workspaceId);
  const animationsEnabled = useAnimationsEnabled();
  const readRecord = knowledge.readRecord;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recordDetail, setRecordDetail] = useState<KnowledgeRecord | null>(null);
  const [selectedRootSlug, setSelectedRootSlug] = useState<string | null>(null);
  const [scope, setScope] = useState<"knowledge" | "projects" | "references">("knowledge");
  const [filter, setFilter] = useState<"all" | "proposed" | "confirmed" | "superseded">("all");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingTruth, setEditingTruth] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [kind, setKind] = useState<
    "decision" | "constraint" | "requirement" | "architecture" | "finding" | "project" | "reference"
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
  const [reviewSelection, setReviewSelection] = useState<string | null>(null);
  const [reviewKind, setReviewKind] = useState<"replace" | "refine">("refine");
  const [reviewValue, setReviewValue] = useState("");
  const [reviewDirectives, setReviewDirectives] = useState<KnowledgeReviewDirective[]>([]);
  const reviewSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.projectKnowledgeRefinement === true,
  );
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
  const normalizedQuery = query.trim().toLowerCase();
  const records = useMemo(
    () =>
      knowledge.view?.records.filter(
        (record) =>
          (filter === "all" || record.status === filter) &&
          recordMatchesScope(record.kind, scope) &&
          recordMatchesTags(record, tagFilter) &&
          record.title.toLowerCase().includes(normalizedQuery),
      ) ?? [],
    [filter, knowledge.view, normalizedQuery, scope, tagFilter],
  );
  const scopedTags = useMemo(
    () =>
      uniqueTags(
        (knowledge.view?.records ?? []).filter((record) => recordMatchesScope(record.kind, scope)),
      ),
    [knowledge.view, scope],
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
  const reviewContent = selectedRoot
    ? rootDocumentBody(selectedRoot.body)
    : (detailedSelection?.statement ?? null);
  const reviewDocumentKey = selectedRoot
    ? `root:${selectedRoot.slug}`
    : `record:${selected?.id ?? ""}`;
  useEffect(() => {
    // Review comments have no durable identity and must never follow a reader
    // to a different article in the same tab.
    setReviewSelection(null);
    setReviewValue("");
    setReviewDirectives([]);
  }, [reviewDocumentKey]);
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
    document = rootDocumentBody(selectedRoot.body);
  } else if (selected) {
    document = recordMarkdown(
      selected,
      knowledge.view?.records ?? [],
      knowledge.view?.findings.filter(
        (finding) => finding.recordId === selected.id || finding.relatedRecordId === selected.id,
      ) ?? [],
    );
  }
  const markdownPath =
    selectedRoot?.absolutePath ?? selectedRoot?.path ?? knowledgePathForRecord(selected);
  let documentIdentity = "";
  if (selectedRoot) documentIdentity = `Knowledge root · ${selectedRoot.slug}`;
  else if (selected)
    documentIdentity = `${recordStatusLabel(selected)} · Updated ${new Date(selected.updatedAt).toLocaleDateString()}`;
  const openMarkdown = useCallback(() => {
    if (!markdownPath) return;
    openFileInWorkspace({ location: { path: markdownPath }, disposition: "main" });
  }, [markdownPath, openFileInWorkspace]);
  const captureReviewSelection = useCallback(() => {
    if (!isWeb || !reviewContent) return;
    const value = window.getSelection?.()?.toString().trim() ?? "";
    if (!value) {
      setFormError("Select a phrase in the article before adding review feedback.");
      return;
    }
    if (!reviewContent.includes(value)) {
      setFormError("The selection is not part of this article's editable text.");
      return;
    }
    if (reviewContent.indexOf(value) !== reviewContent.lastIndexOf(value)) {
      setFormError(
        "That phrase appears more than once. Select a larger passage so the review stays exact.",
      );
      return;
    }
    setFormError(null);
    setReviewSelection(value);
    setReviewValue("");
  }, [reviewContent]);
  const addReviewDirective = useCallback(() => {
    if (!reviewSelection || !reviewValue.trim() || !reviewContent) return;
    const index = reviewContent.indexOf(reviewSelection);
    setReviewDirectives((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        kind: reviewKind,
        selectedText: reviewSelection,
        beforeContext: reviewContent.slice(Math.max(0, index - 96), index),
        afterContext: reviewContent.slice(
          index + reviewSelection.length,
          index + reviewSelection.length + 96,
        ),
        value: reviewValue.trim(),
      },
    ]);
    setReviewSelection(null);
    setReviewValue("");
  }, [reviewContent, reviewKind, reviewSelection, reviewValue]);
  const startKnowledgeRefine = useCallback(() => {
    if (!reviewContent || reviewDirectives.length === 0 || !reviewSupported) return;
    const replacements = applyDirectReplacements(reviewContent, reviewDirectives);
    if (replacements.error) {
      setFormError(replacements.error);
      return;
    }
    let target: Parameters<typeof openRefineTab>[0]["knowledgeReview"] | undefined;
    if (selectedRoot) {
      target = {
        target: "root",
        slug: selectedRoot.slug,
        title: selectedRoot.title,
        content: replacements.content,
        ...(selectedRoot.bodyDigest ? { expectedBodyDigest: selectedRoot.bodyDigest } : {}),
        instruction: buildKnowledgeReviewInstruction(reviewDirectives),
      };
    } else if (selected) {
      target = {
        target: "record",
        id: selected.id,
        title: selected.title,
        content: replacements.content,
        expectedUpdatedAt: selected.updatedAt,
        instruction: buildKnowledgeReviewInstruction(reviewDirectives),
      };
    }
    if (!target) return;
    const opened = openRefineTab({
      serverId,
      workspaceId,
      paths: [
        `project-knowledge://${target.target}/${target.target === "root" ? target.slug : target.id}`,
      ],
      knowledgeReview: target,
    });
    if (opened) {
      setReviewDirectives([]);
      setReviewSelection(null);
      setReviewValue("");
    }
  }, [
    reviewContent,
    reviewDirectives,
    reviewSupported,
    selected,
    selectedRoot,
    serverId,
    workspaceId,
  ]);
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
  const deleteRecord = useCallback(async () => {
    if (!selected) return;
    const confirmed = await confirmDialog({
      title: "Delete project knowledge?",
      message: `Delete “${selected.title}” permanently? Its Markdown page and recorded history will be removed. This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    const error = await knowledge.deleteRecord({
      id: selected.id,
      expectedUpdatedAt: selected.updatedAt,
    });
    if (error) await alertDialog({ title: "Unable to delete project knowledge", message: error });
  }, [knowledge, selected]);
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
  if (knowledge.error) {
    viewer = (
      <View style={styles.empty}>
        <Text style={styles.description}>{knowledge.error}</Text>
        <Button size="sm" variant="outline" onPress={knowledge.reload}>
          Retry
        </Button>
      </View>
    );
  } else if (creating) {
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
                { value: "finding", label: "Finding" },
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
    viewer = (
      <View style={styles.documentContent}>
        <Text style={styles.documentContentTitle}>{selectedRoot.title}</Text>
        <KnowledgeReviewStrip
          directives={reviewDirectives}
          selection={reviewSelection}
          kind={reviewKind}
          value={reviewValue}
          enabled={reviewSupported}
          onKindChange={setReviewKind}
          onValueChange={setReviewValue}
          onSave={addReviewDirective}
          onRemove={(id) =>
            setReviewDirectives((current) => current.filter((item) => item.id !== id))
          }
          onRefine={startKnowledgeRefine}
        />
        <MarkdownRenderer text={document} remoteImages="altText" />
      </View>
    );
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
      <View style={styles.documentContent}>
        <View style={styles.documentContentTitleRow}>
          <ThemedArticleKnowledgeKindIcon kind={selected.kind} />
          <Text style={styles.documentContentTitle}>{selected.title}</Text>
        </View>
        <KnowledgeReviewStrip
          directives={reviewDirectives}
          selection={reviewSelection}
          kind={reviewKind}
          value={reviewValue}
          enabled={reviewSupported && Boolean(detailedSelection)}
          onKindChange={setReviewKind}
          onValueChange={setReviewValue}
          onSave={addReviewDirective}
          onRemove={(id) =>
            setReviewDirectives((current) => current.filter((item) => item.id !== id))
          }
          onRefine={startKnowledgeRefine}
        />
        <MarkdownRenderer text={document} remoteImages="altText" />
      </View>
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
  if (knowledge.loading)
    return <PageLoading label="Loading project knowledge…" testID="project-knowledge-loading" />;

  return (
    <Animated.View
      entering={animationsEnabled ? FadeIn.duration(180) : undefined}
      style={styles.root}
      testID="project-knowledge-panel"
    >
      <Animated.View style={sidebarShellStyle}>
        <View style={styles.sidebar}>
          <View style={styles.summary}>
            <SegmentedControl
              size="sm"
              stretch
              value={scope}
              onValueChange={(value) => {
                setScope(value);
                setSelectedId(null);
                setSelectedRootSlug(null);
                setCreating(false);
                setQuery("");
                setTagFilter([]);
              }}
              options={[
                { value: "knowledge", label: "Knowledge" },
                { value: "projects", label: "Projects" },
                { value: "references", label: "References" },
              ]}
            />
            <Text style={styles.summaryStats}>
              {scopeSummary(scope, summary, knowledge.view?.briefTokens ?? 0)}
            </Text>
            <Button size="sm" onPress={startCreate}>
              {newButtonLabel}
            </Button>
          </View>
          <>
            {scope === "knowledge" ? (
              <View style={styles.filters}>
                <Text style={styles.fieldLabel}>Knowledge map</Text>
                <View style={styles.rootPages}>
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
                </View>
              </View>
            ) : null}
            <View style={styles.searchBox}>
              <ThemedSearch uniProps={searchIconProps} />
              <ThemedTextInput
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${scope}`}
                accessibilityLabel={`Search ${scope}`}
                testID="project-knowledge-search-input"
                uniProps={searchInputProps}
                // @ts-expect-error - outlineStyle is web-only
                style={[styles.searchInput, isWeb && { outlineStyle: "none" }]}
              />
              {query ? <SearchClearButton onPress={() => setQuery("")} /> : null}
            </View>
            {scopedTags.length > 0 ? (
              <ThemedKnowledgeTagFilter
                tags={scopedTags}
                selectedTags={tagFilter}
                onChange={setTagFilter}
              />
            ) : null}
            <View style={styles.statusFilters}>
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
            <ScrollView style={styles.browser} contentContainerStyle={styles.browserContent}>
              {records.map((record) => (
                <KnowledgeRecordRow
                  key={record.id}
                  record={record}
                  selected={record.id === selected?.id}
                  onSelect={() => {
                    setSelectedRootSlug(null);
                    setSelectedId(record.id);
                  }}
                />
              ))}
            </ScrollView>
          </>
        </View>
        <GestureDetector gesture={resizeGesture}>
          <View
            style={[styles.resizeHandle, isWeb && ({ cursor: "col-resize" } as object)]}
            testID="project-knowledge-splitter"
          />
        </GestureDetector>
      </Animated.View>
      <View style={styles.viewer}>
        {selectedRoot || selected ? (
          <View style={styles.documentHeader}>
            <View style={styles.documentIdentity}>
              <Text style={styles.muted}>{documentIdentity}</Text>
            </View>
            <View style={styles.documentToolbar}>
              {markdownPath ? (
                <ToolbarIconButton
                  label="Open Markdown source"
                  Icon={ThemedFolderOpen}
                  onPress={openMarkdown}
                />
              ) : null}
              {!editingTruth && !editingMetadata && !creating ? (
                <ToolbarIconButton
                  label="Add review feedback from selected text"
                  Icon={ThemedRobot}
                  onPress={captureReviewSelection}
                  disabled={!reviewSupported || !reviewContent}
                />
              ) : null}
              {selected && !editingTruth && !editingMetadata && !creating ? (
                <>
                  {markdownPath ? <ToolbarSeparator /> : null}
                  <ToolbarIconButton
                    label="Edit current truth"
                    Icon={ThemedPencil}
                    onPress={() => {
                      setStatement(selected.statement);
                      setTruthReason("");
                      setEditingTruth(true);
                    }}
                  />
                  {selected.kind === "project" || selected.kind === "reference" ? (
                    <ToolbarIconButton
                      label={`Edit ${selected.kind === "project" ? "delivery" : "evaluation"}`}
                      Icon={ThemedSquarePen}
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
                    />
                  ) : null}
                  {selected.status !== "confirmed" ? (
                    <ToolbarIconButton
                      label="Confirm project knowledge"
                      Icon={ThemedCheck}
                      onPress={() => void setStatus("confirmed")}
                    />
                  ) : null}
                  {selected.status !== "superseded" ? (
                    <ToolbarIconButton
                      label="Supersede project knowledge"
                      Icon={ThemedArchive}
                      onPress={() => void setStatus("superseded")}
                    />
                  ) : null}
                  <ToolbarIconButton
                    label={purgeLabel(selected.kind)}
                    Icon={ThemedTrash2}
                    onPress={() => void deleteRecord()}
                    tone="destructive"
                    testID="project-knowledge-delete"
                  />
                </>
              ) : null}
            </View>
          </View>
        ) : null}
        <View style={styles.documentCanvas}>
          <ScrollView contentContainerStyle={styles.viewerContent}>{viewer}</ScrollView>
        </View>
        {selectedRoot || selected ? (
          <View style={styles.documentStatusBar}>
            <Text numberOfLines={1} style={styles.pathLabel}>
              {markdownPath ?? "Markdown source unavailable"}
            </Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

type KnowledgeRecord = NonNullable<
  ReturnType<typeof useProjectKnowledge>["view"]
>["records"][number];
type KnowledgeFinding = NonNullable<
  ReturnType<typeof useProjectKnowledge>["view"]
>["findings"][number];

function KnowledgeRecordRow({
  record,
  selected,
  onSelect,
}: {
  record: KnowledgeRecord;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityState={selected ? SELECTED_ACCESSIBILITY_STATE : undefined}
      style={({ hovered, pressed }) => [
        styles.row,
        selected ? styles.selectedRow : null,
        hovered && !selected ? styles.hoveredRow : null,
        pressed ? styles.pressedRow : null,
      ]}
    >
      <View style={styles.rowIcon}>
        <ThemedKnowledgeKindIcon kind={record.kind} size="mdPlus" />
      </View>
      <View style={styles.rowContent}>
        <Text numberOfLines={2} style={styles.rowTitle}>
          {record.title}
        </Text>
      </View>
    </Pressable>
  );
}

/** Selected tags stay visible as small removable chips; the full list lives in a popover. */
function KnowledgeTagFilter({
  tags,
  selectedTags,
  onChange,
  theme,
}: {
  tags: readonly string[];
  selectedTags: readonly string[];
  onChange: (tags: string[]) => void;
  theme: { colors: { foreground: string; foregroundMuted: string } };
}): ReactElement {
  const toggle = (tag: string) =>
    onChange(
      selectedTags.includes(tag)
        ? selectedTags.filter((value) => value !== tag)
        : [...selectedTags, tag],
    );
  const triggerColor =
    selectedTags.length > 0 ? theme.colors.foreground : theme.colors.foregroundMuted;
  return (
    <View style={styles.tagFilters} accessibilityLabel="Filter by tag">
      <DropdownMenu>
        <DropdownMenuTrigger
          accessibilityLabel="Filter by tag"
          accessibilityRole="button"
          style={styles.tagTrigger}
          testID="project-knowledge-tag-filter-trigger"
        >
          <Settings2 size="sm" color={triggerColor} />
          <Text
            style={[styles.tagTriggerLabel, selectedTags.length > 0 && styles.tagTriggerActive]}
          >
            {selectedTags.length > 0 ? `Tags · ${selectedTags.length}` : "Tags"}
          </Text>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          offset={4}
          minWidth={220}
          scrollable
          maxHeight={320}
          testID="project-knowledge-tag-filter-content"
        >
          {tags.map((tag) => (
            <DropdownMenuItem
              key={tag}
              closeOnSelect={false}
              selected={selectedTags.includes(tag)}
              showSelectedCheck
              onSelect={() => toggle(tag)}
            >
              {tag}
            </DropdownMenuItem>
          ))}
          {selectedTags.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => onChange([])}>
                Clear all
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {selectedTags.length > 0 ? (
        <View style={styles.tagFilterChips}>
          {selectedTags.map((tag) => (
            <View key={tag} style={styles.tagChipSelected}>
              <Text numberOfLines={1} style={styles.tagChipText}>
                {tag}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${tag} filter`}
                hitSlop={4}
                style={({ hovered, pressed }) => [
                  styles.tagChipRemove,
                  (hovered || pressed) && styles.tagChipRemoveActive,
                ]}
                onPress={() => toggle(tag)}
              >
                <X size="xs" color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
          ))}
          <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger
              accessibilityRole="button"
              accessibilityLabel="Clear filter tags"
              style={({ hovered, pressed }) => [
                styles.tagChipClearButton,
                (hovered || pressed) && styles.tagChipClearActive,
              ]}
              onPress={() => onChange([])}
            >
              <ClearAll size="sm" color={theme.colors.foregroundMuted} />
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={6}>
              <Text style={styles.tagTooltipText}>Clear filter tags</Text>
            </TooltipContent>
          </Tooltip>
        </View>
      ) : null}
    </View>
  );
}

function KnowledgeKindIcon({
  kind,
  size,
  color,
}: {
  kind: KnowledgeRecord["kind"];
  size: IconSizeProp;
  color: string;
}): ReactElement {
  if (kind === "architecture") return <Architecture size={size} color={color} />;
  if (kind === "decision") return <Gavel size={size} color={color} />;
  if (kind === "constraint") return <Shield size={size} color={color} />;
  if (kind === "requirement") return <Checklist size={size} color={color} />;
  if (kind === "finding") return <Lightbulb size={size} color={color} />;
  if (kind === "project") return <FolderTree size={size} color={color} />;
  if (kind === "reference") return <BookOpen size={size} color={color} />;
  return <Gavel size={size} color={color} />;
}
const ThemedKnowledgeTagFilter = withUnistyles(KnowledgeTagFilter, (theme) => ({ theme }));
const ThemedKnowledgeKindIcon = withUnistyles(KnowledgeKindIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedArticleKnowledgeKindIcon = withUnistyles(KnowledgeKindIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.lg,
}));
const ThemedArchive = withUnistyles(Archive);
const ThemedCheck = withUnistyles(Check);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedPencil = withUnistyles(Pencil);
const ThemedRobot = withUnistyles(Robot);
const ThemedX = withUnistyles(X);
const ThemedSearch = withUnistyles(Search);
const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedTextInput = withUnistyles(TextInput);

function KnowledgeReviewStrip({
  directives,
  selection,
  kind,
  value,
  enabled,
  onKindChange,
  onValueChange,
  onSave,
  onRemove,
  onRefine,
}: {
  directives: readonly KnowledgeReviewDirective[];
  selection: string | null;
  kind: "replace" | "refine";
  value: string;
  enabled: boolean;
  onKindChange: (kind: "replace" | "refine") => void;
  onValueChange: (value: string) => void;
  onSave: () => void;
  onRemove: (id: string) => void;
  onRefine: () => void;
}): ReactElement | null {
  if (!selection && directives.length === 0) return null;
  return (
    <View style={styles.reviewStrip}>
      {directives.map((directive) => (
        <View
          key={directive.id}
          style={[
            styles.reviewDirective,
            directive.kind === "replace" ? styles.reviewReplace : styles.reviewRefine,
          ]}
        >
          <View style={styles.reviewDirectiveCopy}>
            <Text style={styles.reviewDirectiveKind}>
              {directive.kind === "replace" ? "Replace" : "Refine"}
            </Text>
            <Text style={styles.reviewDirectiveText} numberOfLines={2}>
              “{directive.selectedText}” · {directive.value}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Remove review feedback"
            onPress={() => onRemove(directive.id)}
          >
            <ThemedX size={16} />
          </Pressable>
        </View>
      ))}
      {selection ? (
        <View style={styles.reviewComposer}>
          <Text style={styles.reviewSelection} numberOfLines={2}>
            Selected: “{selection}”
          </Text>
          <SegmentedControl
            size="sm"
            value={kind}
            onValueChange={onKindChange}
            options={[
              { value: "replace", label: "Replace" },
              { value: "refine", label: "Refine" },
            ]}
          />
          <TextInput
            value={value}
            onChangeText={onValueChange}
            multiline
            placeholder={
              kind === "replace" ? "Exact replacement text" : "How should this be improved?"
            }
            placeholderTextColor="#777"
            style={[styles.input, styles.reviewInput]}
          />
          <Button size="sm" disabled={!enabled || !value.trim()} onPress={onSave}>
            Add feedback
          </Button>
        </View>
      ) : null}
      {directives.length > 0 ? (
        <View style={styles.reviewActions}>
          <Text style={styles.muted}>
            Feedback is temporary and is consumed when the Refine tab opens.
          </Text>
          <Button size="sm" disabled={!enabled} onPress={onRefine}>
            Refine with AI
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const searchIconProps = (theme: {
  colors: { foregroundMuted: string };
  iconSize: { md: number };
}) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});
const searchInputProps = (theme: { colors: { foregroundMuted: string } }) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

/**
 * The path to hand the editor. `absolutePath` wins because it is the only one
 * that resolves for a host-local store, where `path` is relative to a store
 * directory the client knows nothing about. Older daemons send neither, so the
 * repository layout stays as the last resort.
 */
function knowledgePathForRecord(record: KnowledgeRecord | null): string | null {
  if (!record) return null;
  return record.absolutePath ?? record.path ?? `.otto/knowledge/${record.kind}s/${record.id}.md`;
}
function recordMarkdown(
  record: KnowledgeRecord,
  records: readonly KnowledgeRecord[],
  findings: readonly KnowledgeFinding[],
): string {
  let operational = "";
  if (record.kind === "project") {
    const progress = record.progress
      ? `${record.progress.completed} of ${record.progress.total} ${record.progress.unit} (${Math.round((record.progress.completed / record.progress.total) * 100)}%)`
      : "Not measured";
    operational = `\n\n## Delivery\n\n- Status: **${formatDeliveryStatus(record.deliveryStatus)}**\n- Progress: ${progress}`;
  } else if (record.kind === "reference") {
    const source = record.sourceUrl ? `[${record.sourceUrl}](${record.sourceUrl})` : "Not recorded";
    operational = `\n\n## Reference\n\n- Evaluation: **${formatMetadataLabel(record.referenceDisposition ?? "unevaluated")}**\n- Source: ${source}`;
  }
  return `## Current understanding\n\n${record.statement}${operational}\n\n## Evidence\n\n${record.evidence || "No evidence recorded."}\n\n## Tags\n\n${record.tags.map((tag) => `\`${tag}\``).join(" ") || "None"}\n\n## Timeline\n\n${record.provenance?.map((entry) => `- ${entry.recordedAt} [${entry.kind ?? "note"}]: ${entry.text}${entry.source ? ` (${entry.source})` : ""}`).join("\n") || "No timeline recorded."}\n\n${reviewSignalsMarkdown(record, records, findings)}`;
}

function reviewSignalsMarkdown(
  record: KnowledgeRecord,
  records: readonly KnowledgeRecord[],
  findings: readonly KnowledgeFinding[],
): string {
  const byId = new Map(records.map((candidate) => [candidate.id, candidate]));
  let identicalTagSets = 0;
  let partialTagOverlap = 0;
  let overlappingTruth = 0;
  let stale = 0;
  for (const finding of findings) {
    if (finding.kind === "stale") {
      stale += 1;
      continue;
    }
    if (finding.kind === "overlapping_statement") {
      overlappingTruth += 1;
      continue;
    }
    const related = finding.relatedRecordId ? byId.get(finding.relatedRecordId) : undefined;
    const other = related?.id === record.id ? byId.get(finding.recordId) : related;
    const complete =
      finding.tagOverlap === "complete" ||
      (!finding.tagOverlap &&
        other &&
        record.tags.length === other.tags.length &&
        record.tags.every((tag) => other.tags.includes(tag)));
    if (complete) identicalTagSets += 1;
    else partialTagOverlap += 1;
  }
  const bullets = [
    identicalTagSets > 0 ? `- **${identicalTagSets}** records share the complete tag set.` : "",
    partialTagOverlap > 0
      ? `- **${partialTagOverlap}** records share one or more, but not all, tags.`
      : "",
    overlappingTruth > 0
      ? `- **${overlappingTruth}** records have potentially overlapping current truth.`
      : "",
    stale > 0 ? `- **${stale}** stale-review signals.` : "",
  ].filter(Boolean);
  return `## Review signals\n\n${bullets.join("\n") || "No current signals."}`;
}
function rootDocumentBody(body: string): string {
  return body.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, "").replace(/^# [^\r\n]+\r?\n+/, "");
}
function recordStatusLabel(record: KnowledgeRecord): string {
  if (record.kind === "project")
    return `${formatMetadataLabel(record.kind)} · ${formatDeliveryStatus(record.deliveryStatus)} · ${formatMetadataLabel(record.status)}`;
  if (record.kind === "reference")
    return `${formatMetadataLabel(record.kind)} · ${formatMetadataLabel(record.referenceDisposition ?? "unevaluated")} · ${formatMetadataLabel(record.status)}`;
  return `${formatMetadataLabel(record.kind)} · ${formatMetadataLabel(record.status)}`;
}
function purgeLabel(kind: KnowledgeRecord["kind"]): string {
  if (kind === "project") return "Purge project";
  if (kind === "reference") return "Purge reference";
  return "Purge knowledge";
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
    return `${summary.projects} projects · ${summary.projectsComplete} complete · ${summary.projectsInFlight} active`;
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
  muted: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.sm },
  summaryStats: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    paddingVertical: 4,
  },
  description: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.sm, lineHeight: 20 },
  filters: {
    padding: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  rootPages: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 40,
    marginHorizontal: theme.spacing[2],
    marginTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  tagFilters: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
  tagFilterChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    alignItems: "center",
  },
  tagTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    selfStart: true,
    minHeight: 32,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  tagTriggerLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  tagTriggerActive: { color: theme.colors.foreground },
  tagChipSelected: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceToggleSelected,
    userSelect: "none",
  },
  tagChipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  tagChipRemove: {
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
    padding: 2,
    borderRadius: theme.borderRadius.full,
  },
  tagChipRemoveActive: { backgroundColor: theme.colors.surface2 },
  tagChipClearButton: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    userSelect: "none",
  },
  tagChipClearActive: { backgroundColor: theme.colors.surface3 },
  tagChipClearText: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  tagTooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.xs },
  statusFilters: {
    paddingTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[1],
  },
  browser: { flex: 1 },
  browserContent: { gap: theme.spacing[1], padding: theme.spacing[1] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    userSelect: "none",
  },
  hoveredRow: { backgroundColor: theme.colors.surface1 },
  selectedRow: { backgroundColor: theme.colors.surfaceToggleSelected },
  pressedRow: { backgroundColor: theme.colors.surface2 },
  rowIcon: {
    alignItems: "center",
    justifyContent: "center",
    width: theme.iconSize.lg,
    height: theme.iconSize.lg,
  },
  rowContent: { flex: 1, minWidth: 0 },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  viewer: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: theme.colors.surface0 },
  // Articles share the Text Editor's content well; the surrounding header and
  // footer deliberately remain on surface0 as pane chrome.
  documentCanvas: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surfaceCode },
  viewerContent: { padding: theme.spacing[6], maxWidth: 920 },
  documentContent: { gap: 0 },
  documentContentTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.foreground,
  },
  documentContentTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
  },
  documentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: PANE_TOOLBAR_HEIGHT,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  documentIdentity: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  viewerTitle: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    fontSize: theme.fontSize.base,
  },
  viewerToolbar: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  reviewStrip: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  reviewDirective: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    borderLeftWidth: 3,
  },
  reviewReplace: { borderLeftColor: theme.colors.statusWarning },
  reviewRefine: { borderLeftColor: theme.colors.primary },
  reviewDirectiveCopy: { flex: 1, minWidth: 0, gap: 2 },
  reviewDirectiveKind: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  reviewDirectiveText: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.xs },
  reviewComposer: { gap: theme.spacing[2] },
  reviewSelection: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  reviewInput: { minHeight: 72, paddingVertical: theme.spacing[2], textAlignVertical: "top" },
  reviewActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  documentToolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  documentStatusBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    minHeight: 24,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
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
