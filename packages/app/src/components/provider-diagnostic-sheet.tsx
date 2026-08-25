import * as Clipboard from "expo-clipboard";
import { AlertTriangle, Copy, RotateCw } from "@/components/icons/material-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  Text,
  View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  SHEET_HORIZONTAL_PADDING_SCALE,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollableCodeSurface, SurfaceCard } from "@/components/ui/scrollable-code-surface";
import { TabScrollView } from "@/components/ui/tabbed-modal-sheet";
import { useToast } from "@/contexts/toast-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { formatTimeAgo } from "@/utils/time";
import type {
  AgentModelDefinition,
  AgentProvider,
  ModelTier,
} from "@otto-code/protocol/agent-types";
import { compareMatchScores, scoreTextFields } from "@otto-code/protocol/search/text-match";
import type { ProviderProfileModel } from "@otto-code/protocol/provider-config";
import type { ModelVisibilityOverride } from "@otto-code/protocol/messages";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextFieldPicker } from "@/components/ui/text-field-picker";
import {
  resolveProviderDiscoveredModels,
  type ProviderDiscoveredModelsCache,
} from "./provider-diagnostic-models";
import {
  CLAUDE_COMPATIBLE_MODEL_ID_PRESETS,
  DESKTOP_SHEET_HEIGHT,
  EMPTY_COMBOBOX_OPTIONS,
  EMPTY_SAVED_ENDPOINTS,
  ModelRowText,
  ModelTierSelect,
  ModelVisibilityCheckbox,
  ModelsSearchField,
  ModelsTabActions,
  ProviderAgentsSection,
  ProviderConnectionSection,
  ProviderRemoveSection,
  ProviderToolGroupsSection,
  ThemedRemoveIcon,
  buildProviderTabOptions,
  readProviderConfigEntry,
  readProviderExtends,
  resolveCurrentTab,
  resolveIsCustomProvider,
  resolveIsOpenAiCompatFamily,
  resolveProviderConnection,
  useProviderSheetFeature,
} from "./provider-sheet/provider-sheet-content";
import type { ProviderSettingsTab } from "./provider-sheet/provider-sheet-content";
import { isModelVisible, updateModelVisibilityOverrides } from "./provider-model-visibility";
// Themed leaf per docs/unistyles.md "Static Theme Imports" - only the icon
// re-renders on theme changes, not the row that hosts it.

interface ProviderDiagnosticSheetProps {
  provider: string;
  visible: boolean;
  onClose: () => void;
  serverId: string;
}

function rankModels<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  const scored = items
    .map((item) => ({ item, score: scoreTextFields(query, fields(item)) }))
    .filter(
      (entry): entry is { item: T; score: NonNullable<typeof entry.score> } => entry.score !== null,
    );
  scored.sort((a, b) => compareMatchScores(a.score, b.score));
  return scored.map((entry) => entry.item);
}

function resolveModelVisibilityOverrides(
  config: { modelVisibilityOverrides?: readonly ModelVisibilityOverride[] } | null | undefined,
): readonly ModelVisibilityOverride[] {
  return config?.modelVisibilityOverrides ?? [];
}

function ModelVisibilityToolbar({
  show,
  visibleCount,
  totalCount,
  onShowAll,
  onHideAll,
}: {
  show: boolean;
  visibleCount: number;
  totalCount: number;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  const { t } = useTranslation();
  if (!show || totalCount === 0) return null;

  return (
    <View style={sheetStyles.modelVisibilityToolbar}>
      <Text style={sheetStyles.mutedText}>
        {t("settings.providers.models.visibleCount", {
          visible: visibleCount,
          total: totalCount,
        })}
      </Text>
      <View style={sheetStyles.modelVisibilityActions}>
        <Button
          variant="outline"
          size="xs"
          onPress={onShowAll}
          disabled={visibleCount === totalCount}
          testID="provider-models-show-all"
        >
          {t("settings.providers.models.showAll")}
        </Button>
        <Button
          variant="outline"
          size="xs"
          onPress={onHideAll}
          disabled={visibleCount === 0}
          testID="provider-models-hide-all"
        >
          {t("settings.providers.models.hideAll")}
        </Button>
      </View>
    </View>
  );
}

function DiscoveredModelRow({
  model,
  showTier,
  showVisibility,
  visible,
  onSetTier,
  onSetVisibility,
}: {
  model: AgentModelDefinition;
  showTier: boolean;
  showVisibility: boolean;
  visible: boolean;
  onSetTier: (modelId: string, tier: ModelTier | null) => void;
  onSetVisibility: (modelId: string, visible: boolean) => void;
}) {
  return (
    <View style={sheetStyles.modelRow}>
      {showVisibility ? (
        <ModelVisibilityCheckbox
          modelId={model.id}
          visible={visible}
          disabled={false}
          onChange={onSetVisibility}
        />
      ) : null}
      <ModelRowText label={model.label} id={model.id} description={model.description} />
      {showTier ? (
        <ModelTierSelect
          modelId={model.id}
          tier={model.tier}
          disabled={false}
          onChange={onSetTier}
        />
      ) : null}
    </View>
  );
}

function CustomModelRow({
  model,
  showVisibility,
  visible,
  deleting,
  onSetVisibility,
  onDelete,
}: {
  model: ProviderProfileModel;
  showVisibility: boolean;
  visible: boolean;
  deleting: boolean;
  onSetVisibility: (modelId: string, visible: boolean) => void;
  onDelete: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const handleDelete = useCallback(() => onDelete(model.id), [model.id, onDelete]);
  const deleteButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && sheetStyles.iconButtonHovered,
      deleting ? sheetStyles.disabled : null,
    ],
    [deleting],
  );

  return (
    <View style={sheetStyles.modelRow}>
      {showVisibility ? (
        <ModelVisibilityCheckbox
          modelId={model.id}
          visible={visible}
          disabled={deleting}
          onChange={onSetVisibility}
        />
      ) : null}
      <ModelRowText label={model.label} id={model.id} />
      <Pressable
        onPress={handleDelete}
        disabled={deleting}
        hitSlop={8}
        style={deleteButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("settings.providers.models.removeModel", { id: model.id })}
      >
        <ThemedRemoveIcon />
      </Pressable>
    </View>
  );
}

function SectionHeader({ title, count, hint }: { title: string; count?: number; hint?: string }) {
  return (
    <View style={sheetStyles.sectionHeader}>
      <Text style={settingsStyles.sectionHeaderTitle}>{title}</Text>
      <View style={sheetStyles.sectionHeaderMeta}>
        {count !== undefined ? (
          <Text style={settingsStyles.sectionHeaderTitle}>{count}</Text>
        ) : null}
        {count !== undefined && hint ? (
          <Text style={settingsStyles.sectionHeaderTitle}>·</Text>
        ) : null}
        {hint ? <Text style={settingsStyles.sectionHeaderTitle}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function AddCustomModelSubSheet({
  provider,
  serverId,
  extendsProvider,
  visible,
  onClose,
  refresh,
}: {
  provider: string;
  serverId: string;
  extendsProvider: string | null;
  visible: boolean;
  onClose: () => void;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const modelIdPresets =
    extendsProvider === "claude" ? CLAUDE_COMPATIBLE_MODEL_ID_PRESETS : EMPTY_COMBOBOX_OPTIONS;
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const additionalModels = useMemo(
    () => config?.providers?.[provider]?.additionalModels ?? [],
    [config?.providers, provider],
  );
  const trimmed = input.trim();
  const canAdd = trimmed.length > 0 && !additionalModels.some((model) => model.id === trimmed);

  useEffect(() => {
    if (!visible) {
      setInput("");
      setError(null);
    }
  }, [visible]);

  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    setError(null);
    setSaving(true);
    void patchConfig({
      providers: {
        [provider]: {
          additionalModels: [...additionalModels, { id: trimmed, label: trimmed }],
        },
      },
    })
      .then(() => refresh([provider]))
      .then(() => onClose())
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("settings.providers.models.failedToSave"));
      })
      .finally(() => setSaving(false));
  }, [additionalModels, canAdd, onClose, patchConfig, provider, refresh, t, trimmed]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.providers.models.addCustomTitle") }),
    [t],
  );

  const footer = useMemo(
    () => (
      <View style={sheetStyles.sheetFooter}>
        <Button
          style={sheetStyles.sheetFooterButton}
          variant="secondary"
          size="sm"
          onPress={onClose}
          disabled={saving}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={sheetStyles.sheetFooterButton}
          variant="default"
          size="sm"
          onPress={handleAdd}
          disabled={!canAdd || saving}
        >
          {saving ? t("settings.providers.models.adding") : t("settings.providers.models.add")}
        </Button>
      </View>
    ),
    [canAdd, handleAdd, onClose, saving, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={420}
      snapPoints={ADD_SNAP_POINTS}
      footer={footer}
      testID="add-custom-model-sheet"
    >
      <View style={sheetStyles.formGroup}>
        <Text style={sheetStyles.formLabel}>{t("settings.providers.models.modelId")}</Text>
        <TextFieldPicker
          value={input}
          onChange={setInput}
          options={modelIdPresets}
          placeholder={t("settings.providers.models.modelIdPlaceholder")}
          testID="add-custom-model-id"
        />
        {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function DiagnosticSubSheet({
  provider,
  serverId,
  visible,
  onClose,
}: {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDiagnostic = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const result = await client.getProviderDiagnostic(provider);
      setDiagnostic(result.diagnostic);
    } catch (err) {
      setDiagnostic(
        err instanceof Error ? err.message : t("settings.providers.diagnostic.failedToFetch"),
      );
    } finally {
      setLoading(false);
    }
  }, [client, provider, t]);

  useEffect(() => {
    if (visible) {
      void fetchDiagnostic();
    } else {
      setDiagnostic(null);
    }
  }, [visible, fetchDiagnostic]);

  const refreshButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && sheetStyles.iconButtonHovered,
      loading ? sheetStyles.disabled : null,
    ],
    [loading],
  );

  const handleRefreshPress = useCallback(() => {
    void fetchDiagnostic();
  }, [fetchDiagnostic]);

  const copyButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && Boolean(diagnostic) && sheetStyles.iconButtonHovered,
      diagnostic ? null : sheetStyles.disabled,
    ],
    [diagnostic],
  );

  const handleCopyPress = useCallback(() => {
    if (!diagnostic) return;
    void Clipboard.setStringAsync(diagnostic)
      .then(() => toast.copied(t("settings.providers.diagnostic.copyLabel")))
      .catch(() => toast.error(t("settings.providers.diagnostic.copyFailed")));
  }, [diagnostic, t, toast]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.providers.diagnostic.title"),
      actions: (
        <View style={sheetStyles.headerActions}>
          <Pressable
            onPress={handleCopyPress}
            disabled={!diagnostic}
            hitSlop={8}
            style={copyButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("settings.providers.diagnostic.copyAccessibility")}
          >
            <Copy size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Pressable
            onPress={handleRefreshPress}
            disabled={loading}
            hitSlop={8}
            style={refreshButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={
              loading
                ? t("settings.providers.diagnostic.refreshingAccessibility")
                : t("settings.providers.diagnostic.refreshAccessibility")
            }
          >
            {loading ? (
              <LoadingSpinner size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            ) : (
              <RotateCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            )}
          </Pressable>
        </View>
      ),
    }),
    [
      copyButtonStyle,
      diagnostic,
      handleCopyPress,
      handleRefreshPress,
      loading,
      refreshButtonStyle,
      t,
      theme.colors.foregroundMuted,
      theme.iconSize.sm,
    ],
  );

  let body: React.ReactNode;
  if (loading && !diagnostic) {
    body = (
      <SurfaceCard key={visible ? "visible" : "hidden"}>
        <View style={sheetStyles.codeBlockLoading}>
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          <Text style={sheetStyles.mutedText}>{t("settings.providers.diagnostic.running")}</Text>
        </View>
      </SurfaceCard>
    );
  } else if (diagnostic) {
    body = (
      <ScrollableCodeSurface key={visible ? "visible" : "hidden"} maxHeight={480}>
        {diagnostic}
      </ScrollableCodeSurface>
    );
  } else {
    body = (
      <SurfaceCard key={visible ? "visible" : "hidden"}>
        <View style={sheetStyles.codeBlockLoading}>
          <Text style={sheetStyles.mutedText}>{t("settings.providers.diagnostic.none")}</Text>
        </View>
      </SurfaceCard>
    );
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      snapPoints={DIAGNOSTIC_SNAP_POINTS}
      scrollable={false}
      testID="provider-diagnostic-sheet"
    >
      {body}
    </AdaptiveModalSheet>
  );
}

interface ProviderModalBodyProps {
  provider: string;
  discoveredCount: number;
  additionalCount: number;
  providerSnapshotRefreshing: boolean;
  providerErrorMessage: string | null;
  modelsRefreshing: boolean;
  searchActive: boolean;
  filteredDiscovered: AgentModelDefinition[];
  filteredCustom: ProviderProfileModel[];
  deletingModelId: string | null;
  showTier: boolean;
  showVisibility: boolean;
  visibilityOverrides: readonly ModelVisibilityOverride[];
  onSetTier: (modelId: string, tier: ModelTier | null) => void;
  onSetVisibility: (modelId: string, visible: boolean) => void;
  onRefresh: () => void;
  onDeleteCustom: (modelId: string) => void;
  theme: { iconSize: { md: number }; colors: { foregroundMuted: string } };
}

function ProviderModalBody(props: ProviderModalBodyProps) {
  const { t } = useTranslation();
  const {
    provider,
    discoveredCount,
    additionalCount,
    providerSnapshotRefreshing,
    providerErrorMessage,
    modelsRefreshing,
    searchActive,
    filteredDiscovered,
    filteredCustom,
    deletingModelId,
    showTier,
    showVisibility,
    visibilityOverrides,
    onSetTier,
    onSetVisibility,
    onRefresh,
    onDeleteCustom,
    theme,
  } = props;

  if (discoveredCount === 0 && additionalCount === 0 && providerSnapshotRefreshing) {
    return (
      <View style={sheetStyles.emptyState}>
        <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.loading")}</Text>
      </View>
    );
  }
  if (discoveredCount === 0 && additionalCount === 0 && providerErrorMessage) {
    return (
      <View style={sheetStyles.emptyState}>
        <AlertTriangle size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
        <Text style={sheetStyles.mutedText}>{providerErrorMessage}</Text>
        <Button variant="default" size="sm" onPress={onRefresh} disabled={modelsRefreshing}>
          {modelsRefreshing
            ? t("settings.providers.models.retrying")
            : t("settings.providers.models.retry")}
        </Button>
      </View>
    );
  }
  if (filteredDiscovered.length === 0 && filteredCustom.length === 0 && searchActive) {
    return (
      <View style={sheetStyles.emptyState}>
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.noSearchMatches")}</Text>
      </View>
    );
  }
  if (discoveredCount === 0 && additionalCount === 0) {
    return (
      <View style={sheetStyles.emptyState}>
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.noneDetected")}</Text>
      </View>
    );
  }
  return (
    <>
      {filteredDiscovered.length > 0 ? (
        <View style={sheetStyles.section}>
          <SectionHeader
            title={t("settings.providers.models.discovered")}
            count={filteredDiscovered.length}
          />
          <View style={settingsStyles.card}>
            {filteredDiscovered.map((model) => (
              <DiscoveredModelRow
                key={model.id}
                model={model}
                showTier={showTier}
                showVisibility={showVisibility}
                visible={isModelVisible(visibilityOverrides, provider, model.id)}
                onSetTier={onSetTier}
                onSetVisibility={onSetVisibility}
              />
            ))}
          </View>
        </View>
      ) : null}
      {filteredCustom.length > 0 ? (
        <View style={sheetStyles.section}>
          <SectionHeader
            title={t("settings.providers.models.custom")}
            count={filteredCustom.length}
          />
          <View style={settingsStyles.card}>
            {filteredCustom.map((model) => (
              <CustomModelRow
                key={model.id}
                model={model}
                showVisibility={showVisibility}
                visible={isModelVisible(visibilityOverrides, provider, model.id)}
                deleting={deletingModelId === model.id}
                onSetVisibility={onSetVisibility}
                onDelete={onDeleteCustom}
              />
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

export function ProviderDiagnosticSheet({
  provider,
  visible,
  onClose,
  serverId,
}: ProviderDiagnosticSheetProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { entries: snapshotEntries, refresh, isRefreshing } = useProvidersSnapshot(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ProviderSettingsTab | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [diagSheetOpen, setDiagSheetOpen] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);

  const providerLabel = resolveProviderLabel(provider, snapshotEntries);
  const providerEntry = useMemo(
    () => snapshotEntries?.find((entry) => entry.provider === provider),
    [snapshotEntries, provider],
  );
  const additionalModels = useMemo(
    () => config?.providers?.[provider]?.additionalModels ?? [],
    [config?.providers, provider],
  );
  const providerConfigEntry = readProviderConfigEntry(config, provider);
  const providerExtends = readProviderExtends(providerConfigEntry);
  const isCustomProvider = resolveIsCustomProvider(provider, providerExtends);
  const connection = useMemo(
    () => resolveProviderConnection(provider, providerConfigEntry, providerExtends),
    [provider, providerConfigEntry, providerExtends],
  );
  const supportsProviderRemove = useProviderSheetFeature(serverId, "providerRemove");
  const supportsArtifactsToolGroup = useProviderSheetFeature(serverId, "artifactsToolGroup");
  // COMPAT(modelTierOverrides): added in v0.5.2, drop the gate when daemon floor >= v0.5.2.
  const supportsModelTierOverrides = useProviderSheetFeature(serverId, "modelTierOverrides");
  // COMPAT(modelVisibilityOverrides): added in v0.8.18, drop the gate when daemon floor >= v0.8.18.
  const supportsModelVisibilityOverrides = useProviderSheetFeature(
    serverId,
    "modelVisibilityOverrides",
  );
  // COMPAT(savedProviderEndpoints): added in v0.6.5, drop the gate when daemon floor >= v0.6.5.
  const supportsSavedEndpoints = useProviderSheetFeature(serverId, "savedProviderEndpoints");
  // COMPAT(openaiCompatMaxToolRounds): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
  const supportsMaxToolRounds = useProviderSheetFeature(serverId, "openaiCompatMaxToolRounds");
  const supportsActionBreaker = useProviderSheetFeature(serverId, "openaiCompatActionBreaker");
  // COMPAT(openaiCompatMidSessionUpdates): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
  const supportsMidSessionUpdates = useProviderSheetFeature(
    serverId,
    "openaiCompatMidSessionUpdates",
  );
  const savedEndpoints = useMemo(
    () => config?.savedProviderEndpoints ?? EMPTY_SAVED_ENDPOINTS,
    [config?.savedProviderEndpoints],
  );
  const handleRemoved = useCallback(() => {
    onClose();
  }, [onClose]);
  const providerSnapshotRefreshing = providerEntry?.status === "loading";
  const providerErrorMessage =
    providerEntry?.status === "error"
      ? (providerEntry.error ?? t("settings.providers.diagnostic.unknownError"))
      : null;
  const modelsRefreshing = isRefreshing || providerSnapshotRefreshing;

  const stableDiscoveredRef = useRef<ProviderDiscoveredModelsCache | null>(null);
  const currentModels = providerEntry?.models;
  const { models: discoveredModels, cache: nextDiscoveredCache } = resolveProviderDiscoveredModels({
    serverId,
    provider,
    currentModels,
    providerSnapshotRefreshing,
    previousCache: stableDiscoveredRef.current,
  });
  stableDiscoveredRef.current = nextDiscoveredCache;

  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setClockTick((tick) => tick + 1), 10_000);
    return () => clearInterval(id);
  }, [visible]);
  const fetchedAtLabel = useMemo(() => {
    if (!providerEntry?.fetchedAt) return null;
    void clockTick;
    return formatTimeAgo(new Date(providerEntry.fetchedAt));
  }, [providerEntry?.fetchedAt, clockTick]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setActiveTab(null);
      setAddSheetOpen(false);
      setDiagSheetOpen(false);
    }
  }, [visible]);

  const hasConnectionTab = connection !== null;
  const isOpenAiCompatFamily = resolveIsOpenAiCompatFamily(provider, providerExtends);
  const hasToolsTab = isOpenAiCompatFamily;
  const hasAgentsTab = isOpenAiCompatFamily;
  const tabOptions = useMemo(
    () => buildProviderTabOptions(t, hasConnectionTab, hasToolsTab, hasAgentsTab),
    [hasAgentsTab, hasConnectionTab, hasToolsTab, t],
  );
  // Falls back to the first tab until the user picks one, or if a config
  // refresh drops the selected tab (e.g. the provider loses its connection).
  const currentTab = resolveCurrentTab(activeTab, tabOptions);

  const q = query.trim();
  const filteredDiscovered = useMemo(
    () => rankModels(discoveredModels, q, (m) => [m.label, m.id, m.description ?? ""]),
    [discoveredModels, q],
  );
  const filteredCustom = useMemo(
    () => rankModels(additionalModels, q, (m) => [m.label, m.id]),
    [additionalModels, q],
  );
  const visibilityOverrides = useMemo(() => resolveModelVisibilityOverrides(config), [config]);
  const allModelIds = useMemo(
    () => Array.from(new Set([...discoveredModels, ...additionalModels].map((model) => model.id))),
    [additionalModels, discoveredModels],
  );
  const showVisibility = [supportsModelVisibilityOverrides, isOpenAiCompatFamily].every(Boolean);
  const visibleModelCount = useMemo(
    () =>
      allModelIds.filter((modelId) => isModelVisible(visibilityOverrides, provider, modelId))
        .length,
    [allModelIds, provider, visibilityOverrides],
  );

  const handleRefreshModels = useCallback(() => {
    void refresh([provider]);
  }, [provider, refresh]);

  const handleOpenAddSheet = useCallback(() => setAddSheetOpen(true), []);
  const handleCloseAddSheet = useCallback(() => setAddSheetOpen(false), []);
  const handleOpenDiagSheet = useCallback(() => setDiagSheetOpen(true), []);
  const handleCloseDiagSheet = useCallback(() => setDiagSheetOpen(false), []);

  const handleDeleteCustom = useCallback(
    (modelId: string) => {
      setDeletingModelId(modelId);
      void patchConfig({
        providers: {
          [provider]: {
            additionalModels: additionalModels.filter((model) => model.id !== modelId),
          },
        },
      })
        .then(() => refresh([provider]))
        .finally(() => {
          setDeletingModelId((current) => (current === modelId ? null : current));
        });
    },
    [additionalModels, patchConfig, provider, refresh],
  );

  const handleSetModelTier = useCallback(
    (modelId: string, tier: ModelTier | null) => {
      // Wholesale-replace the array (patch semantics): drop any existing tag for
      // this model, then add the new one unless clearing back to Unknown.
      const current = config?.modelTierOverrides ?? [];
      const next = current.filter(
        (entry) => !(entry.provider === provider && entry.modelId === modelId),
      );
      if (tier !== null) {
        next.push({ provider, modelId, tier });
      }
      // No refresh needed: the daemon re-stamps loaded models and pushes a
      // providers_snapshot_update when the config changes.
      void patchConfig({ modelTierOverrides: next });
    },
    [config?.modelTierOverrides, patchConfig, provider],
  );

  const handleSetModelVisibility = useCallback(
    (modelId: string, modelVisible: boolean) => {
      const next = updateModelVisibilityOverrides({
        overrides: visibilityOverrides,
        provider,
        modelIds: [modelId],
        visible: modelVisible,
      });
      void patchConfig({ modelVisibilityOverrides: next });
    },
    [patchConfig, provider, visibilityOverrides],
  );

  const handleShowAllModels = useCallback(() => {
    const storedProviderModelIds = visibilityOverrides
      .filter((entry) => entry.provider === provider)
      .map((entry) => entry.modelId);
    const next = updateModelVisibilityOverrides({
      overrides: visibilityOverrides,
      provider,
      modelIds: [...allModelIds, ...storedProviderModelIds],
      visible: true,
    });
    void patchConfig({ modelVisibilityOverrides: next });
  }, [allModelIds, patchConfig, provider, visibilityOverrides]);

  const handleHideAllModels = useCallback(() => {
    const next = updateModelVisibilityOverrides({
      overrides: visibilityOverrides,
      provider,
      modelIds: allModelIds,
      visible: false,
    });
    void patchConfig({ modelVisibilityOverrides: next });
  }, [allModelIds, patchConfig, provider, visibilityOverrides]);

  const sheetHeader = useMemo<SheetHeader>(() => ({ title: providerLabel }), [providerLabel]);

  // Pinned sheet footer, visible on every tab. Only custom providers (config
  // entries with `extends`) are removable; built-ins get no footer.
  const removeFooter = useMemo(
    () =>
      isCustomProvider ? (
        <ProviderRemoveSection
          provider={provider}
          providerLabel={providerLabel}
          supportsRemove={supportsProviderRemove}
          patchConfig={patchConfig}
          onRemoved={handleRemoved}
        />
      ) : undefined,
    [handleRemoved, isCustomProvider, patchConfig, provider, providerLabel, supportsProviderRemove],
  );

  const tabStrip = useMemo(
    () => (
      <View style={sheetStyles.tabStrip}>
        <SegmentedControl
          size="sm"
          value={currentTab}
          onValueChange={setActiveTab}
          options={tabOptions}
          testID="provider-settings-tabs"
        />
      </View>
    ),
    [currentTab, tabOptions],
  );

  return (
    <>
      <AdaptiveModalSheet
        header={sheetHeader}
        visible={visible}
        onClose={onClose}
        testID="provider-settings-sheet"
        subHeader={tabStrip}
        desktopHeight={DESKTOP_SHEET_HEIGHT}
        scrollable={false}
        // Each tab pane's own TabScrollView owns the body indent, so a field
        // flush with the scroll box keeps its whole focus ring.
        contentPadding={false}
        footer={removeFooter}
        snapPoints={MAIN_SNAP_POINTS}
      >
        {currentTab === "models" ? (
          <View style={sheetStyles.tabPane}>
            <View style={sheetStyles.tabPaneFixedRow}>
              <ModelsSearchField initialValue={query} onChange={setQuery} />
              <ModelVisibilityToolbar
                show={showVisibility}
                visibleCount={visibleModelCount}
                totalCount={allModelIds.length}
                onShowAll={handleShowAllModels}
                onHideAll={handleHideAllModels}
              />
            </View>
            <TabScrollView>
              <ProviderModalBody
                provider={provider}
                discoveredCount={discoveredModels.length}
                additionalCount={additionalModels.length}
                providerSnapshotRefreshing={providerSnapshotRefreshing}
                providerErrorMessage={providerErrorMessage}
                modelsRefreshing={modelsRefreshing}
                searchActive={Boolean(q)}
                filteredDiscovered={filteredDiscovered}
                filteredCustom={filteredCustom}
                deletingModelId={deletingModelId}
                showTier={supportsModelTierOverrides}
                showVisibility={showVisibility}
                visibilityOverrides={visibilityOverrides}
                onSetTier={handleSetModelTier}
                onSetVisibility={handleSetModelVisibility}
                onRefresh={handleRefreshModels}
                onDeleteCustom={handleDeleteCustom}
                theme={theme}
              />
            </TabScrollView>
            <View style={sheetStyles.tabPaneFixedRow}>
              <ModelsTabActions
                fetchedAtLabel={fetchedAtLabel}
                modelsRefreshing={modelsRefreshing}
                onOpenAddSheet={handleOpenAddSheet}
                onOpenDiagSheet={handleOpenDiagSheet}
                onRefreshModels={handleRefreshModels}
              />
            </View>
          </View>
        ) : null}
        {currentTab === "connection" && connection ? (
          <TabScrollView>
            <ProviderConnectionSection
              key={`connection-${provider}`}
              provider={provider}
              connection={connection}
              savedEndpoints={savedEndpoints}
              supportsSavedEndpoints={supportsSavedEndpoints}
              patchConfig={patchConfig}
              refresh={refresh}
            />
          </TabScrollView>
        ) : null}
        {currentTab === "tools" ? (
          <TabScrollView>
            <ProviderToolGroupsSection
              key={`tools-${provider}`}
              provider={provider}
              selectedGroups={config?.providers?.[provider]?.ottoToolGroups ?? null}
              supportsArtifactsGroup={supportsArtifactsToolGroup}
              patchConfig={patchConfig}
              refresh={refresh}
            />
          </TabScrollView>
        ) : null}
        {currentTab === "agents" ? (
          <TabScrollView>
            <ProviderAgentsSection
              key={`agents-${provider}`}
              provider={provider}
              configEntry={providerConfigEntry}
              supportsMaxToolRounds={supportsMaxToolRounds}
              supportsActionBreaker={supportsActionBreaker}
              supportsMidSessionUpdates={supportsMidSessionUpdates}
              patchConfig={patchConfig}
              refresh={refresh}
            />
          </TabScrollView>
        ) : null}
      </AdaptiveModalSheet>
      <AddCustomModelSubSheet
        provider={provider}
        serverId={serverId}
        extendsProvider={providerExtends}
        visible={addSheetOpen}
        onClose={handleCloseAddSheet}
        refresh={refresh}
      />
      <DiagnosticSubSheet
        provider={provider}
        serverId={serverId}
        visible={diagSheetOpen}
        onClose={handleCloseDiagSheet}
      />
    </>
  );
}

// Single detent on purpose: this sheet has a sticky footer, and gorhom sizes
// the content column for the highest detent - at a lower resting detent the
// footer would sit below the fold, unreachable by scrolling.
const MAIN_SNAP_POINTS = ["92%"];
const ADD_SNAP_POINTS = ["40%"];
const DIAGNOSTIC_SNAP_POINTS = ["50%", "85%"];

const sheetStyles = StyleSheet.create((theme) => ({
  mutedText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  disabled: {
    opacity: 0.5,
  },
  section: {
    marginBottom: theme.spacing[4],
  },
  // Fixed strip between the sheet header and the scrolling tab content. Row
  // direction keeps the segmented control at its intrinsic width.
  tabStrip: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    paddingTop: theme.spacing[4],
  },
  // Fills the sheet's static content area: fixed rows (search, actions)
  // sandwich the scrolling list. Only the vertical inset lives here - the
  // scrolling middle supplies its own horizontal indent (see TabScrollView),
  // so the fixed rows carry theirs individually.
  tabPane: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
  },
  tabPaneFixedRow: {
    paddingHorizontal: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    gap: theme.spacing[2],
  },
  modelVisibilityToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  modelVisibilityActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  sectionHeaderMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  // Text column shrinks as a unit so the trailing control keeps its width.
  emptyState: {
    paddingVertical: theme.spacing[8],
    alignItems: "center",
    gap: theme.spacing[3],
  },
  formGroup: {
    gap: theme.spacing[3],
  },
  formLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  sheetFooter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  sheetFooterButton: {
    flex: 1,
  },
  codeBlockLoading: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
