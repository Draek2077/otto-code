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
import {
  Archive,
  Architecture,
  BookOpen,
  Check,
  CheckSquare,
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
  WrapText,
  X,
} from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PageLoading } from "@/components/ui/page-loading";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PANE_TOOLBAR_HEIGHT } from "@/components/ui/control-geometry";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SearchClearButton } from "@/components/ui/search-clear-button";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { ToolbarSeparator } from "@/components/ui/toolbar-separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { usePaneContext } from "@/panels/pane-context";
import { createWorkspaceFileTabTarget } from "@/workspace/file-open";
import { alertDialog, confirmDialog } from "@/utils/confirm-dialog";
import {
  useProjectKnowledge,
  type ProjectDeliveryStatus,
  type ProjectReferenceDisposition,
} from "@/context-management/use-project-knowledge";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import {
  useArchitecturalViews,
  type ArchitecturalViewKnowledgeReference,
  type ArchitecturalViewSummary,
} from "@/architectural-views/use-architectural-views";
import { ArchitecturalViewHtml } from "@/components/architectural-views/architectural-view-html";
import { KnowledgeMarkdownEditor } from "./knowledge-markdown-editor";
import { KnowledgeReviewProposalView } from "./knowledge-review-proposal";
import { KnowledgeReviewSurface } from "./knowledge-review-surface";
import { allHunkIds, applyRefineDecisions, buildRefineDiff, type RefineDiff } from "@/refine/hunks";
import {
  applyDirectReplacements,
  type KnowledgeReviewDirective,
  type KnowledgeReviewProposal,
  type KnowledgeReviewTarget,
} from "./review-session";
import {
  formatDeliveryStatus,
  formatMetadataLabel,
  isolateKnowledgeTypeFilter,
  KNOWLEDGE_ARTICLE_KINDS,
  recordMatchesKnowledgeTypes,
  recordMatchesTags,
  summarizeProjectKnowledge,
  toggleKnowledgeTypeFilter,
  uniqueTags,
  type KnowledgeArticleKind,
} from "./model";
import type { IconSizeProp } from "@/components/icons/icon-size";

const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 520;
const MIN_VIEWER_WIDTH = 360;
const SIDEBAR_SHELL_STYLE = { position: "relative" } as const;
const SELECTED_ACCESSIBILITY_STATE = { selected: true } as const;
// This is source-only. The renderer receives the normal record article, while
// the review engine needs one stable string for source-owned ranges spanning
// Current understanding and Evidence.
const RECORD_REVIEW_SEPARATOR = "\n\n<!-- otto:knowledge-review-evidence -->\n\n";
const EMPTY_REVIEW_DIFF: RefineDiff = { lines: [], hunks: [] };

/** Markdown knowledge is rendered as a document, while Otto owns mutations. */
// eslint-disable-next-line complexity -- panel intentionally owns its three explicit review states.
export function ProjectKnowledgePanel(): ReactElement {
  const { serverId, workspaceId, target: paneTarget, openTab } = usePaneContext();
  const requestedSelection =
    paneTarget.kind === "projectKnowledge" ? paneTarget.selection : undefined;
  const knowledge = useProjectKnowledge(serverId, workspaceId, {
    deferInitialLoad: Boolean(requestedSelection),
  });
  const ensureKnowledgeLoaded = knowledge.load;
  const replaceKnowledgeRecord = knowledge.replaceRecord;
  const replaceKnowledgeRoot = knowledge.replaceRoot;
  const animationsEnabled = useAnimationsEnabled();
  const readRecord = knowledge.readRecord;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recordDetail, setRecordDetail] = useState<KnowledgeRecord | null>(null);
  const [selectedRootSlug, setSelectedRootSlug] = useState<string | null>(null);
  const [scope, setScope] = useState<"knowledge" | "projects" | "references">("knowledge");
  const [filter, setFilter] = useState<"all" | "proposed" | "confirmed" | "superseded">("all");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<KnowledgeArticleKind[]>([
    ...KNOWLEDGE_ARTICLE_KINDS,
  ]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingTruth, setEditingTruth] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
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
  const [reviewDirectives, setReviewDirectives] = useState<KnowledgeReviewDirective[]>([]);
  const [reviewGenerating, setReviewGenerating] = useState(false);
  const [reviewProposal, setReviewProposal] = useState<KnowledgeReviewProposal | null>(null);
  const [reviewApplying, setReviewApplying] = useState(false);
  const [documentMode, setDocumentMode] = useState<"article" | "architectural-view">("article");
  const reviewSupported = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.features?.projectKnowledgeAnchoredRefinement === true,
  );
  const tagEditingSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.projectKnowledgeTagEditing === true,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const { preferences: changesPreferences, updatePreferences: updateChangesPreferences } =
    useChangesPreferences();
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
          (scope !== "knowledge" || recordMatchesKnowledgeTypes(record, typeFilter)) &&
          recordMatchesTags(record, tagFilter) &&
          record.title.toLowerCase().includes(normalizedQuery),
      ) ?? [],
    [filter, knowledge.view, normalizedQuery, scope, tagFilter, typeFilter],
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
  let selectedSummary: KnowledgeRecord | null = null;
  if (!selectedRoot) {
    selectedSummary = selectedId
      ? (records.find((record) => record.id === selectedId) ?? null)
      : (records[0] ?? null);
  }
  const detailedSelection = recordDetail && recordDetail.id === selectedId ? recordDetail : null;
  const selected = detailedSelection ?? selectedSummary;
  let architecturalKnowledgeReference: ArchitecturalViewKnowledgeReference | null = null;
  if (selectedRoot) {
    architecturalKnowledgeReference = { kind: "root", id: selectedRoot.slug };
  } else if (selected) {
    architecturalKnowledgeReference = { kind: "record", id: selected.id };
  }
  const architecturalViews = useArchitecturalViews(
    serverId,
    workspaceId,
    architecturalKnowledgeReference,
  );
  const allArchitecturalViews = useArchitecturalViews(serverId, workspaceId, null, false);
  const showArchitecturalView = documentMode === "architectural-view";
  const showWholePageLoading = knowledge.loading && !knowledge.view && !requestedSelection;
  const reviewContent = reviewContentForSelection(selectedRoot, detailedSelection);
  const reviewDocumentKey = selectedRoot
    ? `root:${selectedRoot.slug}`
    : `record:${selected?.id ?? ""}`;
  const lastAppliedSelectionKey = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedSelection) return;
    const selectionKey =
      requestedSelection.kind === "root"
        ? `root:${requestedSelection.slug}`
        : `record:${requestedSelection.id}`;
    if (lastAppliedSelectionKey.current === selectionKey) return;
    lastAppliedSelectionKey.current = selectionKey;
    if (requestedSelection.kind === "root") {
      setScope("knowledge");
      setSelectedRootSlug(requestedSelection.slug);
      setSelectedId(null);
      ensureKnowledgeLoaded();
    } else {
      setScope("knowledge");
      setSelectedRootSlug(null);
      setSelectedId(requestedSelection.id);
    }
    setCreating(false);
    setEditingTruth(false);
    setEditingMetadata(false);
    setEditingTags(false);
    setQuery("");
    setFilter("all");
    setTypeFilter([...KNOWLEDGE_ARTICLE_KINDS]);
    setTagFilter([]);
  }, [ensureKnowledgeLoaded, requestedSelection]);
  useEffect(() => {
    // Review comments have no durable identity and must never follow a reader
    // to a different article in the same tab.
    setReviewDirectives([]);
    setReviewProposal(null);
    setFormError(null);
    setEditingTags(false);
  }, [reviewDocumentKey]);
  useEffect(() => {
    // A view belongs to a single source article. Never carry it to the next
    // Knowledge selection in the same pane.
    setDocumentMode("article");
  }, [selected?.id, selectedRoot?.slug]);
  useEffect(() => {
    if (!selectedId) {
      setRecordDetail(null);
      return;
    }
    let cancelled = false;
    setRecordDetail(null);
    void readRecord(selectedId)
      .then((record) => {
        if (cancelled || !record) return undefined;
        setRecordDetail(record);
        if (record.kind === "project") setScope("projects");
        else if (record.kind === "reference") setScope("references");
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setRecordDetail(null);
      })
      .finally(() => {
        if (!cancelled) ensureKnowledgeLoaded();
      });
    return () => {
      cancelled = true;
    };
  }, [ensureKnowledgeLoaded, readRecord, selectedId]);
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
  if (reviewProposal) documentIdentity = `Review proposal · ${documentIdentity}`;
  if (showArchitecturalView && architecturalViews.selectedView) {
    const freshness = architecturalViewFreshnessSuffix(
      architecturalViews.selectedView.sourceStatus,
    );
    documentIdentity = `Architectural View · ${architecturalViews.selectedView.title}${freshness}`;
  }
  const openMarkdown = useCallback(() => {
    if (!markdownPath) return;
    openTab(createWorkspaceFileTabTarget({ path: markdownPath }));
  }, [markdownPath, openTab]);
  const addReviewDirective = useCallback((directive: Omit<KnowledgeReviewDirective, "id">) => {
    const id = `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setReviewDirectives((current) => [
      ...current,
      {
        id,
        ...directive,
      },
    ]);
    return id;
  }, []);
  const updateReviewDirective = useCallback(
    (id: string, update: Pick<KnowledgeReviewDirective, "kind" | "value">) => {
      setReviewDirectives((current) =>
        current.map((directive) => (directive.id === id ? { ...directive, ...update } : directive)),
      );
    },
    [],
  );
  const runnableReviewDirectives = useMemo(
    () => reviewDirectives.filter((directive) => directive.value.trim().length > 0),
    [reviewDirectives],
  );
  const startKnowledgeRefine = useCallback(async () => {
    if (
      !reviewContent ||
      runnableReviewDirectives.length === 0 ||
      !reviewSupported ||
      !client ||
      reviewGenerating
    )
      return;
    const replacements = applyDirectReplacements(reviewContent, runnableReviewDirectives);
    if (replacements.error) {
      setFormError(replacements.error);
      return;
    }
    let target: KnowledgeReviewTarget | null = null;
    if (selectedRoot) {
      target = {
        kind: "root",
        slug: selectedRoot.slug,
        title: selectedRoot.title,
        ...(selectedRoot.bodyDigest ? { expectedBodyDigest: selectedRoot.bodyDigest } : {}),
      };
    } else if (selected) {
      target = {
        kind: "record",
        id: selected.id,
        title: selected.title,
        expectedUpdatedAt: selected.updatedAt,
      };
    }
    if (!target) return;
    const refinements = replacements.refinements;
    setReviewGenerating(true);
    setFormError(null);
    try {
      const response = refinements.length
        ? await client.proposeProjectKnowledgeRefinement({
            workspaceId,
            content: replacements.content,
            directives: refinements,
          })
        : { content: replacements.content };
      if (!response.content) {
        setFormError(
          ("error" in response ? response.error : undefined) ??
            "No Knowledge refinement was produced.",
        );
        return;
      }
      const proposal = buildKnowledgeReviewProposal(target, reviewContent, response.content);
      if (!proposal) {
        setFormError("The Knowledge proposal could not preserve its editable field boundary.");
        return;
      }
      setReviewProposal(proposal);
      setReviewDirectives([]);
    } finally {
      setReviewGenerating(false);
    }
  }, [
    client,
    reviewContent,
    reviewGenerating,
    runnableReviewDirectives,
    reviewSupported,
    selected,
    selectedRoot,
    workspaceId,
  ]);
  const applyReviewProposal = useCallback(
    async (content: string) => {
      if (!client || !reviewProposal || reviewApplying) return;
      setReviewApplying(true);
      setFormError(null);
      try {
        let payload;
        const selectedProposal = { ...reviewProposal, proposal: content };
        if (reviewProposal.target.kind === "record") {
          const recordProposal = { ...selectedProposal, target: reviewProposal.target };
          payload = await applyRecordReviewProposal({
            client,
            reviewProposal: recordProposal,
            workspaceId,
          });
        } else {
          payload = await client.applyProjectKnowledgeRefinement({
            workspaceId,
            target: "root",
            slug: reviewProposal.target.slug,
            body: content,
            ...(reviewProposal.target.expectedBodyDigest
              ? { expectedBodyDigest: reviewProposal.target.expectedBodyDigest }
              : {}),
          });
        }
        if (payload.error) {
          setFormError(payload.error);
          return;
        }
        if ("record" in payload && payload.record) {
          replaceKnowledgeRecord(payload.record);
          setRecordDetail(payload.record);
        } else if ("page" in payload && payload.page) {
          replaceKnowledgeRoot(payload.page);
        }
        setReviewProposal(null);
      } finally {
        setReviewApplying(false);
      }
    },
    [
      client,
      replaceKnowledgeRecord,
      replaceKnowledgeRoot,
      reviewApplying,
      reviewProposal,
      workspaceId,
    ],
  );
  // The review decision state lives beside the article toolbar. This keeps the
  // only actions that change proposal state in the one pinned control row,
  // while the canvas stays a continuous document for reading.
  const reviewDiff = useMemo<RefineDiff | null>(
    () => (reviewProposal ? buildRefineDiff(reviewProposal.base, reviewProposal.proposal) : null),
    [reviewProposal],
  );
  const [reviewKeptHunks, setReviewKeptHunks] = useState<Set<string>>(new Set());
  useEffect(() => {
    setReviewKeptHunks(reviewDiff ? allHunkIds(reviewDiff) : new Set());
  }, [reviewDiff]);
  const reviewAllKept =
    reviewDiff !== null &&
    reviewDiff.hunks.length > 0 &&
    reviewKeptHunks.size === reviewDiff.hunks.length;
  const toggleReviewHunk = useCallback((id: string) => {
    setReviewKeptHunks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleAllReviewHunks = useCallback(() => {
    setReviewKeptHunks(reviewAllKept || !reviewDiff ? new Set() : allHunkIds(reviewDiff));
  }, [reviewAllKept, reviewDiff]);
  const reviewProposalContent = useMemo(
    () => (reviewDiff ? applyRefineDecisions(reviewDiff, reviewKeptHunks) : null),
    [reviewDiff, reviewKeptHunks],
  );
  const applyKeptReviewProposal = useCallback(() => {
    if (reviewProposalContent === null) return;
    void applyReviewProposal(reviewProposalContent);
  }, [applyReviewProposal, reviewProposalContent]);
  const toggleReviewWrap = useCallback(
    () => void updateChangesPreferences({ wrapLines: !changesPreferences.wrapLines }),
    [changesPreferences.wrapLines, updateChangesPreferences],
  );
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
  const saveTags = useCallback(async () => {
    if (!selected) return;
    setFormError(null);
    const error = await knowledge.updateTags({
      id: selected.id,
      tags: parseTagInput(tags),
      expectedUpdatedAt: selected.updatedAt,
    });
    if (!error) {
      setEditingTags(false);
      setTags("");
      return;
    }
    setFormError(error);
  }, [knowledge, selected, tags]);
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
        <KnowledgeMarkdownEditor
          documentKey={`create:${kind}`}
          value={statement}
          onChange={setStatement}
          minHeight={260}
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
        {reviewProposal ? (
          <KnowledgeReviewProposalView
            proposal={reviewProposal}
            diff={reviewDiff ?? EMPTY_REVIEW_DIFF}
            keptHunks={reviewKeptHunks}
            onToggleHunk={toggleReviewHunk}
            wrap={changesPreferences.wrapLines}
          />
        ) : (
          <>
            <Text style={styles.documentContentTitle}>{selectedRoot.title}</Text>
            <KnowledgeReviewSurface
              source={document}
              directiveSource={reviewContent ?? ""}
              directives={reviewDirectives}
              enabled={reviewSupported}
              onAdd={addReviewDirective}
              onUpdate={updateReviewDirective}
              onRemove={(id) =>
                setReviewDirectives((current) => current.filter((item) => item.id !== id))
              }
              onSelectionError={setFormError}
            />
          </>
        )}
      </View>
    );
  } else if (editingTags && selected) {
    const suggestions = scopedTags.filter((tag) => !parseTagInput(tags).includes(tag)).slice(0, 16);
    viewer = (
      <View style={styles.composer}>
        <Text style={styles.viewerTitle}>Edit tags</Text>
        <Text style={styles.description}>
          Tags improve discovery and keep related Knowledge together. This does not change the
          article&apos;s current truth or review status.
        </Text>
        <Text style={styles.fieldLabel}>Tags</Text>
        <TextInput
          value={tags}
          onChangeText={setTags}
          placeholder="Comma-separated, for example: protocol, compatibility"
          placeholderTextColor="#777"
          style={styles.input}
        />
        {suggestions.length > 0 ? (
          <View style={styles.tagSuggestionGroup}>
            <Text style={styles.muted}>Suggestions from this Knowledge scope</Text>
            <View style={styles.tagSuggestionList}>
              {suggestions.map((tag) => (
                <Pressable
                  key={tag}
                  accessibilityRole="button"
                  accessibilityLabel={`Add tag ${tag}`}
                  onPress={() => setTags((current) => addTagToInput(current, tag))}
                  style={({ hovered, pressed }) => [
                    styles.tagSuggestion,
                    (hovered || pressed) && styles.tagSuggestionActive,
                  ]}
                >
                  <Text style={styles.tagSuggestionText}>{tag}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <View style={styles.viewerToolbar}>
          <Button variant="outline" size="sm" onPress={() => setEditingTags(false)}>
            Cancel
          </Button>
          <Button size="sm" onPress={() => void saveTags()}>
            Save tags
          </Button>
        </View>
      </View>
    );
  } else if (editingTruth && selected) {
    viewer = (
      <View style={styles.composer}>
        <Text style={styles.viewerTitle}>Update current truth</Text>
        <Text style={styles.description}>
          Otto will atomically append the reason to this page&apos;s permanent timeline. Editing a
          confirmed article returns it to Proposed for review.
        </Text>
        <KnowledgeMarkdownEditor
          documentKey={`truth:${selected.id}:${selected.updatedAt}`}
          value={statement}
          onChange={setStatement}
          minHeight={360}
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
        {reviewProposal ? (
          <KnowledgeReviewProposalView
            proposal={reviewProposal}
            diff={reviewDiff ?? EMPTY_REVIEW_DIFF}
            keptHunks={reviewKeptHunks}
            onToggleHunk={toggleReviewHunk}
            wrap={changesPreferences.wrapLines}
          />
        ) : (
          <>
            <View style={styles.documentContentTitleRow}>
              <ThemedArticleKnowledgeKindIcon kind={selected.kind} />
              <Text style={styles.documentContentTitle}>{selected.title}</Text>
            </View>
            <KnowledgeReviewSurface
              source={document}
              directiveSource={reviewContent ?? ""}
              directives={reviewDirectives}
              enabled={reviewSupported && Boolean(detailedSelection)}
              onAdd={addReviewDirective}
              onUpdate={updateReviewDirective}
              onRemove={(id) =>
                setReviewDirectives((current) => current.filter((item) => item.id !== id))
              }
              onSelectionError={setFormError}
            />
          </>
        )}
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
  if (showWholePageLoading) {
    return <PageLoading label="Loading project knowledge…" testID="project-knowledge-loading" />;
  }

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
                setTypeFilter([...KNOWLEDGE_ARTICLE_KINDS]);
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
            {scope === "knowledge" ? (
              <ThemedKnowledgeTypeFilter selectedTypes={typeFilter} onChange={setTypeFilter} />
            ) : null}
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
            {knowledge.loading && !knowledge.view ? (
              <View style={styles.catalogLoading} testID="project-knowledge-catalog-loading">
                <LoadingSpinner size="small" />
                <Text style={styles.muted}>Loading project knowledge…</Text>
              </View>
            ) : (
              <ScrollView style={styles.browser} contentContainerStyle={styles.browserContent}>
                {scope === "knowledge" && allArchitecturalViews.views.length > 0 ? (
                  <View style={styles.architecturalViewsSection}>
                    <Text style={styles.sectionLabel}>Architectural Views</Text>
                    {allArchitecturalViews.views.map((view) => (
                      <ArchitecturalViewRow
                        key={view.id}
                        view={view}
                        onSelect={() => openTab({ kind: "architecturalView", viewId: view.id })}
                      />
                    ))}
                  </View>
                ) : null}
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
            )}
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
              {architecturalViews.views.length > 0 ? (
                <>
                  <SegmentedControl
                    size="xs"
                    value={documentMode}
                    onValueChange={setDocumentMode}
                    options={[
                      { value: "article", label: "Article" },
                      { value: "architectural-view", label: "Architectural View" },
                    ]}
                  />
                  {showArchitecturalView && architecturalViews.views.length > 1 ? (
                    <ArchitecturalViewPicker
                      views={architecturalViews.views}
                      selectedViewId={architecturalViews.selectedView?.id ?? null}
                      onSelect={architecturalViews.selectView}
                    />
                  ) : null}
                  <ToolbarSeparator />
                </>
              ) : null}
              {markdownPath ? (
                <ToolbarIconButton
                  label="Open in Markdown editor"
                  Icon={ThemedFolderOpen}
                  onPress={openMarkdown}
                />
              ) : null}
              {reviewProposal ? (
                <>
                  {markdownPath ? <ToolbarSeparator /> : null}
                  <ToolbarIconButton
                    label="Discard proposal"
                    Icon={ThemedX}
                    onPress={() => {
                      setReviewProposal(null);
                      setFormError(null);
                    }}
                    disabled={reviewApplying}
                  />
                  <ToolbarIconButton
                    label={reviewAllKept ? "Drop all changes" : "Keep all changes"}
                    Icon={ThemedCheckSquare}
                    onPress={toggleAllReviewHunks}
                    selected={reviewAllKept}
                    disabled={reviewApplying || !reviewDiff || reviewDiff.hunks.length === 0}
                  />
                  <ToolbarSeparator />
                  <ToolbarIconButton
                    label={changesPreferences.wrapLines ? "Scroll long lines" : "Wrap long lines"}
                    Icon={ThemedWrapText}
                    onPress={toggleReviewWrap}
                    selected={changesPreferences.wrapLines}
                    disabled={reviewApplying}
                  />
                  <ToolbarSeparator />
                  <ToolbarIconButton
                    label="Apply kept changes"
                    Icon={ThemedCheck}
                    onPress={applyKeptReviewProposal}
                    tone="accent"
                    loading={reviewApplying}
                    disabled={!reviewDiff || reviewKeptHunks.size === 0}
                  />
                </>
              ) : null}
              {!editingTruth &&
              !editingMetadata &&
              !editingTags &&
              !creating &&
              !reviewProposal &&
              runnableReviewDirectives.length > 0 ? (
                <ToolbarIconButton
                  label={
                    reviewGenerating
                      ? "Generating Knowledge refinement"
                      : `Refine ${runnableReviewDirectives.length} review note${runnableReviewDirectives.length === 1 ? "" : "s"} with AI`
                  }
                  Icon={ThemedRobot}
                  onPress={startKnowledgeRefine}
                  disabled={!reviewSupported || !reviewContent}
                  loading={reviewGenerating}
                />
              ) : null}
              {selected &&
              !editingTruth &&
              !editingMetadata &&
              !editingTags &&
              !creating &&
              !reviewProposal ? (
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
                  {tagEditingSupported ? (
                    <ToolbarIconButton
                      label="Edit tags"
                      Icon={ThemedSettings2}
                      onPress={() => {
                        setTags(selected.tags.join(", "));
                        setFormError(null);
                        setEditingTags(true);
                      }}
                    />
                  ) : null}
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
          {showArchitecturalView ? (
            <ArchitecturalViewCanvas
              html={architecturalViews.html}
              loading={architecturalViews.loading}
              error={architecturalViews.error}
            />
          ) : (
            <ScrollView
              contentContainerStyle={
                reviewProposal ? styles.viewerProposalContent : styles.viewerContent
              }
            >
              {viewer}
            </ScrollView>
          )}
        </View>
        {selectedRoot || selected || formError ? (
          <View style={formError ? styles.documentStatusError : styles.documentStatusBar}>
            <Text numberOfLines={1} style={formError ? styles.statusErrorLabel : styles.pathLabel}>
              {formError ??
                (showArchitecturalView
                  ? (architecturalViews.selectedView?.htmlPath ?? architecturalViews.error)
                  : markdownPath) ??
                "Markdown source unavailable"}
            </Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function ArchitecturalViewCanvas({
  html,
  loading,
  error,
}: {
  html: string | null;
  loading: boolean;
  error: string | null;
}): ReactElement {
  if (html) return <ArchitecturalViewHtml html={html} />;
  return (
    <View style={styles.architecturalViewLoading}>
      {loading ? <LoadingSpinner size="small" /> : null}
      <Text style={styles.muted}>{error ?? "Loading Architectural View…"}</Text>
    </View>
  );
}

function ArchitecturalViewPicker({
  views,
  selectedViewId,
  onSelect,
}: {
  views: readonly ArchitecturalViewSummary[];
  selectedViewId: string | null;
  onSelect: (viewId: string) => void;
}): ReactElement {
  const selectedView = views.find((view) => view.id === selectedViewId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityLabel="Choose Architectural View"
        accessibilityRole="button"
        style={styles.architecturalViewSelector}
      >
        <Text numberOfLines={1} style={styles.architecturalViewSelectorLabel}>
          {selectedView?.title ?? "Choose view"}
        </Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" offset={4} minWidth={220}>
        {views.map((view) => (
          <DropdownMenuItem
            key={view.id}
            selected={view.id === selectedViewId}
            showSelectedCheck
            onSelect={() => onSelect(view.id)}
          >
            {view.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

function ArchitecturalViewRow({
  view,
  onSelect,
}: {
  view: ArchitecturalViewSummary;
  onSelect: () => void;
}): ReactElement {
  const sourceLabel = architecturalViewSourceLabel(view.sourceStatus);
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={`Open Architectural View: ${view.title}`}
      style={({ hovered, pressed }) => [
        styles.row,
        hovered ? styles.hoveredRow : null,
        pressed ? styles.pressedRow : null,
      ]}
    >
      <View style={styles.rowIcon}>
        <Architecture size="mdPlus" />
      </View>
      <View style={styles.rowContent}>
        <Text numberOfLines={2} style={styles.rowTitle}>
          {view.title}
        </Text>
        <Text
          numberOfLines={1}
          style={view.sourceStatus === "stale" ? styles.staleView : styles.viewMeta}
        >
          {sourceLabel}
        </Text>
      </View>
    </Pressable>
  );
}

function architecturalViewFreshnessSuffix(
  status: ArchitecturalViewSummary["sourceStatus"],
): string {
  if (status === "stale") return " · Source changed";
  if (status === "unknown") return " · Source status unknown";
  return "";
}

function architecturalViewSourceLabel(status: ArchitecturalViewSummary["sourceStatus"]): string {
  if (status === "stale") return "Source changed";
  if (status === "unknown") return "Source status unknown";
  return "Current";
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

function KnowledgeTypeFilter({
  selectedTypes,
  onChange,
  theme,
}: {
  selectedTypes: readonly KnowledgeArticleKind[];
  onChange: (types: KnowledgeArticleKind[]) => void;
  theme: { colors: { foreground: string; foregroundMuted: string } };
}): ReactElement {
  const allSelected = selectedTypes.length === KNOWLEDGE_ARTICLE_KINDS.length;
  const triggerColor = allSelected ? theme.colors.foregroundMuted : theme.colors.foreground;
  return (
    <View style={styles.tagFilters} accessibilityLabel="Filter by article type">
      <DropdownMenu>
        <DropdownMenuTrigger
          accessibilityLabel="Filter by article type"
          accessibilityRole="button"
          style={styles.tagTrigger}
          testID="project-knowledge-type-filter-trigger"
        >
          <Checklist size="sm" color={triggerColor} />
          <Text style={[styles.tagTriggerLabel, !allSelected && styles.tagTriggerActive]}>
            {allSelected ? "Types · All" : `Types · ${selectedTypes.length}`}
          </Text>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          offset={4}
          minWidth={220}
          testID="project-knowledge-type-filter-content"
        >
          <DropdownMenuItem
            closeOnSelect={false}
            selected={allSelected}
            showSelectedCheck
            onSelect={() => onChange(toggleKnowledgeTypeFilter(selectedTypes, "all"))}
          >
            All types
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {KNOWLEDGE_ARTICLE_KINDS.map((kind) => (
            <DropdownMenuItem
              key={kind}
              closeOnSelect={false}
              selected={selectedTypes.includes(kind)}
              showSelectedCheck
              onSelect={() => onChange(toggleKnowledgeTypeFilter(selectedTypes, kind))}
              onAlternateSelect={() => onChange(isolateKnowledgeTypeFilter(kind))}
              tooltip="Right-click or long-press to show only this type"
            >
              {formatMetadataLabel(kind)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
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
const ThemedKnowledgeTypeFilter = withUnistyles(KnowledgeTypeFilter, (theme) => ({ theme }));
const ThemedKnowledgeKindIcon = withUnistyles(KnowledgeKindIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedArticleKnowledgeKindIcon = withUnistyles(KnowledgeKindIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.lg,
}));
const ThemedArchive = withUnistyles(Archive);
const ThemedCheck = withUnistyles(Check);
const ThemedCheckSquare = withUnistyles(CheckSquare);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedPencil = withUnistyles(Pencil);
const ThemedRobot = withUnistyles(Robot);
const ThemedSearch = withUnistyles(Search);
const ThemedSettings2 = withUnistyles(Settings2);
const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedWrapText = withUnistyles(WrapText);
const ThemedX = withUnistyles(X);
const ThemedTextInput = withUnistyles(TextInput);

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

function recordReviewContent(statement: string, evidence: string | undefined): string {
  return `${statement}${RECORD_REVIEW_SEPARATOR}${evidence ?? ""}`;
}

function parseTagInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function addTagToInput(value: string, tag: string): string {
  const tags = parseTagInput(value);
  return tags.includes(tag) ? value : [...tags, tag].join(", ");
}

function reviewContentForSelection(
  root: { body: string } | null,
  record: KnowledgeRecord | null,
): string | null {
  if (root) return rootDocumentBody(root.body);
  if (record) return recordReviewContent(record.statement, record.evidence);
  return null;
}

function splitRecordReviewContent(content: string): { statement: string; evidence: string } | null {
  const index = content.indexOf(RECORD_REVIEW_SEPARATOR);
  if (index === -1 || content.indexOf(RECORD_REVIEW_SEPARATOR, index + 1) !== -1) return null;
  return {
    statement: content.slice(0, index),
    evidence: content.slice(index + RECORD_REVIEW_SEPARATOR.length),
  };
}

function recordReviewDisplay(fields: { statement: string; evidence: string }): string {
  return `## Current understanding\n\n${fields.statement}\n\n## Evidence\n\n${fields.evidence || "No evidence recorded."}`;
}

function buildKnowledgeReviewProposal(
  target: KnowledgeReviewTarget,
  base: string,
  proposal: string,
): KnowledgeReviewProposal | null {
  if (target.kind !== "record") return { target, base, proposal };
  const baseFields = splitRecordReviewContent(base);
  const proposalFields = splitRecordReviewContent(proposal);
  if (!baseFields || !proposalFields) return null;
  return {
    target,
    base,
    proposal,
    displayBase: recordReviewDisplay(baseFields),
    displayProposal: recordReviewDisplay(proposalFields),
  };
}

async function applyRecordReviewProposal({
  client,
  reviewProposal,
  workspaceId,
}: {
  client: NonNullable<ReturnType<typeof useSessionStore.getState>["sessions"][string]["client"]>;
  reviewProposal: KnowledgeReviewProposal & {
    target: Extract<KnowledgeReviewTarget, { kind: "record" }>;
  };
  workspaceId: string;
}) {
  const proposal = splitRecordReviewContent(reviewProposal.proposal);
  const base = splitRecordReviewContent(reviewProposal.base);
  if (!proposal || !base) {
    return { error: "The Knowledge proposal could not preserve its editable field boundary." };
  }
  return client.applyProjectKnowledgeRefinement({
    workspaceId,
    target: "record",
    id: reviewProposal.target.id,
    statement: proposal.statement,
    ...(proposal.evidence !== base.evidence ? { evidence: proposal.evidence } : {}),
    expectedUpdatedAt: reviewProposal.target.expectedUpdatedAt,
  });
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
  architecturalViewsSection: {
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  sectionLabel: {
    paddingHorizontal: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  catalogLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
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
  viewMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  staleView: { color: theme.colors.statusWarning, fontSize: theme.fontSize.xs },
  viewer: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: theme.colors.surface0 },
  // Articles share the Text Editor's content well; the surrounding header and
  // footer deliberately remain on surface0 as pane chrome.
  documentCanvas: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surfaceCode },
  viewerContent: { padding: theme.spacing[6], maxWidth: 920 },
  viewerProposalContent: { flexGrow: 1, width: "100%" },
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
  architecturalViewSelector: {
    maxWidth: 220,
    minHeight: 24,
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
  },
  architecturalViewSelectorLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  architecturalViewLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
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
  documentStatusError: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    minHeight: 24,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.statusDanger,
    backgroundColor: theme.colors.statusDangerSurface,
  },
  pathLabel: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.xs, flex: 1 },
  statusErrorLabel: { color: theme.colors.statusDanger, fontSize: theme.fontSize.xs, flex: 1 },
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
  tagSuggestionGroup: { gap: theme.spacing[2] },
  tagSuggestionList: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  tagSuggestion: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
  },
  tagSuggestionActive: { backgroundColor: theme.colors.surface2 },
  tagSuggestionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  fieldLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  optional: { color: theme.colors.mutedForeground, fontWeight: theme.fontWeight.normal },
  progressFields: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  progressNumber: { width: 88 },
  progressUnit: { flex: 1 },
}));
