/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- component ids are bound per rendered bundle row */
/**
 * The per-model hosting fields, plus the VRAM budget they produce.
 *
 * This is the TUI's Configuration panel and VRAM panel, which had no UI outside
 * the terminal at all. Two decisions carry over from there and are worth keeping:
 *
 *  - The fields are a compact labelled grid, not eight settings rows on a
 *    scroll. They are read together, because the budget below is a function of
 *    all of them at once, and separating them by a screen of whitespace makes
 *    that relationship invisible.
 *  - The controls are built from the descriptors the BRAIN sends
 *    (`config/profile-edit.ts`), not from ranges hardcoded here. A client that
 *    invented its own limits would either offer a value the brain rejects or
 *    hide one it accepts.
 *
 * Edits are local until saved. The budget preview follows the draft rather than
 * the saved profile, so the fit verdict answers "what happens if I keep this"
 * while a control is still being scrubbed.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  BrainBudget,
  BrainInventoryModel,
  BrainHostingProfile,
  BrainProfile,
  BrainProfileField,
  BrainProfileWarning,
} from "@otto-code/protocol/messages";
import { Minus, Plus } from "@/components/icons/material-icons";
import { Alert } from "@/components/ui/alert";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { calibrationLabel, formatGiB } from "./use-brain-data";

const ThemedMinus = withUnistyles(Minus);
const ThemedPlus = withUnistyles(Plus);
const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const smallIcon = (theme: Theme) => ({ color: theme.colors.foreground, size: theme.iconSize.xs });
const minusIcon = <ThemedMinus uniProps={smallIcon} />;
const plusIcon = <ThemedPlus uniProps={smallIcon} />;

/** How long to wait after the last keystroke before re-pricing the budget. */
const BUDGET_DEBOUNCE_MS = 250;
const HOSTING_PROFILE_SHEET_HEADER = {
  title: "Prompt & template profiles",
  subtitle: "Stored on this Brain and applied on reload.",
};

type DraftValue = string | number | boolean | null;
type Draft = Record<string, DraftValue>;

function readDraftValue(profile: BrainProfile | null, key: string): DraftValue | undefined {
  const value = (profile as Record<string, unknown> | null)?.[key];
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return undefined;
}

/**
 * Profile keys the editor owns that the brain does not describe as a field.
 *
 * The prompt/template choice is made in its own dialog rather than by a
 * descriptor-driven row, so it has no entry in `fields`. Seeding it separately
 * is what makes the saved selection survive: a draft built from `fields` alone
 * dropped both keys on load and again on every autosave reply, so the control
 * read back as "Off" no matter what the brain had actually stored.
 */
const EXTRA_DRAFT_KEYS = ["hostingProfileMode", "hostingProfileId"] as const;

function buildDraft(profile: BrainProfile | null, fields: BrainProfileField[]): Draft {
  const draft: Draft = {};
  for (const key of [...fields.map((field) => field.key), ...EXTRA_DRAFT_KEYS]) {
    const value = readDraftValue(profile, key);
    if (value !== undefined) {
      draft[key] = value;
    }
  }
  return draft;
}

/** Query-string form of the draft, for the budget preview endpoint. */
function draftToOverrides(draft: Draft): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft)) {
    // The prompt/template choice costs no VRAM, so it has nothing to say to the
    // budget preview and would only arrive there as the string "null".
    if ((EXTRA_DRAFT_KEYS as readonly string[]).includes(key)) continue;
    overrides[key] = String(value);
  }
  return overrides;
}

/**
 * The draft to send, with the prompt/template keys dropped unless this edit
 * changed them.
 *
 * They live in the draft for display, but the brain validates a selection it is
 * sent, so resending an unchanged one would make an unrelated field edit fail
 * against a profile some other client had meanwhile deleted.
 */
function hostingKeysWhenChanged(draft: Draft, saved: Draft): Draft {
  const patch: Draft = { ...draft };
  for (const key of EXTRA_DRAFT_KEYS) {
    if (patch[key] === saved[key]) delete patch[key];
  }
  return patch;
}

function draftsMatch(a: Draft, b: Draft): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

function hostingProfileSummary(
  mode: string,
  profile: BrainHostingProfile | undefined,
  familyDefault: BrainHostingProfile | undefined,
): string {
  if (mode === "inherit") {
    return familyDefault
      ? `System default (${familyDefault.name}) · applies next load`
      : "System default · none set for this model family";
  }
  if (mode === "custom") {
    return profile ? `${profile.name} · applies next load` : "Custom profile · no longer available";
  }
  return "Off · use the template embedded in the model";
}

/**
 * The two numeric fields whose extreme reads as a word rather than a number.
 * 999 GPU layers means "all of them", which is what the flag actually does, and
 * 0 cached chats means the engine keeps its own prompt-cache limit - a
 * different thing from caching nothing, which is how a bare "0" reads.
 */
function formatFieldValue(field: BrainProfileField, value: number): string {
  if (field.key === "gpuLayers" && value >= (field.max ?? 999)) return "All";
  if (field.key === "cachedChats" && value <= 0) return "Default";
  return value.toLocaleString();
}

function NumberField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: BrainProfileField;
  value: number;
  onChange: (next: number) => void;
  disabled: boolean;
}) {
  const step = field.step ?? 1;
  const min = field.min ?? 0;
  const max = field.max ?? Number.MAX_SAFE_INTEGER;
  const clamp = useCallback((next: number) => Math.max(min, Math.min(max, next)), [max, min]);
  const handleDecrease = useCallback(
    () => onChange(clamp(value - step)),
    [clamp, onChange, step, value],
  );
  const handleIncrease = useCallback(
    () => onChange(clamp(value + step)),
    [clamp, onChange, step, value],
  );

  const display = formatFieldValue(field, value);

  return (
    <View style={styles.stepper}>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={minusIcon}
        onPress={handleDecrease}
        disabled={disabled || value <= min}
        accessibilityLabel={`Decrease ${field.label}`}
        testID={`brain-field-${field.key}-down`}
      />
      <Text style={styles.stepperValue} numberOfLines={1}>
        {display}
      </Text>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={plusIcon}
        onPress={handleIncrease}
        disabled={disabled || value >= max}
        accessibilityLabel={`Increase ${field.label}`}
        testID={`brain-field-${field.key}-up`}
      />
    </View>
  );
}

function CycleField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: BrainProfileField;
  value: string | number;
  onChange: (next: string | number) => void;
  disabled: boolean;
}) {
  const options = useMemo(
    () =>
      field.options.map((option, index) => ({
        value: String(option),
        label: field.optionLabels[index] ?? String(option),
      })),
    [field.optionLabels, field.options],
  );

  const handleChange = useCallback(
    (next: string) => {
      // Map the string the control hands back to the ORIGINAL option, so a
      // numeric budget stays a number rather than becoming "1536" on the wire.
      const index = options.findIndex((option) => option.value === next);
      onChange(field.options[index] ?? next);
    },
    [field.options, onChange, options],
  );

  // SegmentedControl has no disabled state, so a read-only editor blocks the
  // touches and dims the row instead of silently accepting presses it discards.
  return (
    <View
      style={disabled ? styles.controlDisabled : undefined}
      pointerEvents={disabled ? "none" : "auto"}
    >
      <SegmentedControl
        size="sm"
        wrap
        options={options}
        value={String(value)}
        onValueChange={handleChange}
        testID={`brain-field-${field.key}`}
      />
    </View>
  );
}

/** The control for one field, chosen by the kind the brain declared. */
function FieldControl({
  field,
  value,
  onChange,
  locked,
}: {
  field: BrainProfileField;
  value: DraftValue | undefined;
  onChange: (next: DraftValue) => void;
  locked: boolean;
}) {
  if (field.kind === "toggle") {
    return (
      <Switch
        value={value === true}
        onValueChange={onChange}
        disabled={locked}
        accessibilityLabel={field.label}
        testID={`brain-field-${field.key}`}
      />
    );
  }
  if (field.kind === "cycle") {
    return (
      <CycleField
        field={field}
        value={typeof value === "boolean" ? String(value) : (value ?? "")}
        onChange={onChange}
        disabled={locked}
      />
    );
  }
  return (
    <NumberField
      field={field}
      value={typeof value === "number" ? value : 0}
      onChange={onChange}
      disabled={locked}
    />
  );
}

/** Muted, yellow, or red, by the warning's severity. */
function warningSeverityStyle(severity: string) {
  if (severity === "error") return styles.errorText;
  if (severity === "warn") return styles.warnText;
  return styles.hintText;
}

function FieldRow({
  field,
  value,
  onChange,
  disabled,
  warnings,
  onFitContext,
}: {
  field: BrainProfileField;
  value: DraftValue | undefined;
  /** Keyed, so the row can bind its own handler instead of the list making one per render. */
  onChange: (key: string, next: DraftValue) => void;
  disabled: boolean;
  warnings: BrainProfileWarning[];
  /** When set, the fit-to-VRAM shortcut renders inline, immediately before the control. */
  onFitContext?: () => void;
}) {
  const fieldWarnings = useMemo(
    () => warnings.filter((warning) => warning.field === field.key),
    [field.key, warnings],
  );
  const locked = disabled || !field.available;
  const handleChange = useCallback(
    (next: DraftValue) => onChange(field.key, next),
    [field.key, onChange],
  );

  return (
    <View style={styles.fieldRow}>
      <View style={styles.fieldLabelColumn}>
        <Text style={styles.fieldLabel}>{field.label}</Text>
        {field.available ? null : (
          <Text style={styles.fieldUnavailable}>{field.unavailableReason ?? "unavailable"}</Text>
        )}
      </View>
      <View style={styles.fieldControl}>
        <View style={styles.controlLine}>
          {onFitContext ? (
            <Button variant="ghost" size="sm" onPress={onFitContext} testID="brain-fit-context">
              Fit to VRAM
            </Button>
          ) : null}
          <FieldControl field={field} value={value} onChange={handleChange} locked={locked} />
        </View>
        {fieldWarnings.map((warning) => (
          <Text key={warning.message} style={warningSeverityStyle(warning.severity)}>
            {warning.message}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** The VRAM breakdown, and the verdict that decides whether the model can load. */
function BudgetPanel({
  budget,
  calibration,
}: {
  budget: BrainBudget | null;
  calibration: string | null;
}) {
  if (!budget) {
    return (
      <View style={styles.budget}>
        <Text style={styles.budgetVerdictNeutral}>
          No GPU detected, so there is no VRAM budget to check.
        </Text>
      </View>
    );
  }

  // The track scales to the WHOLE allocation, not just the usable VRAM. When
  // the total exceeds VRAM, the bar grows past its 100% line and the excess is
  // a third, purple segment: that is the cache spilling into system RAM.
  const spillBytes = Math.max(0, budget.totalBytes - budget.usableBytes);
  const onGpuBytes = Math.min(budget.totalBytes, budget.usableBytes);
  const scaleTotal = Math.max(budget.totalBytes, budget.usableBytes);
  const onGpuPct = scaleTotal > 0 ? (onGpuBytes / scaleTotal) * 100 : 0;
  const spillPct = scaleTotal > 0 ? (spillBytes / scaleTotal) * 100 : 0;

  return (
    <View style={styles.budget}>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${onGpuPct}%` as const }]} />
        {spillPct > 0 ? (
          <View
            style={[styles.meterFill, styles.meterFillSpill, { width: `${spillPct}%` as const }]}
          />
        ) : null}
      </View>
      <Text style={budget.fits ? styles.budgetVerdictGood : styles.budgetVerdictBad}>
        {budget.fits
          ? `Fits entirely on the GPU, ${formatGiB(budget.headroomBytes)} to spare`
          : `${formatGiB(onGpuBytes)} on the GPU, ${formatGiB(spillBytes)} spills to RAM`}
      </Text>
      <Text style={styles.budgetBreakdown}>
        {`weights ${formatGiB(budget.weightsBytes)}`}
        {budget.mmprojBytes > 0 ? ` + projector ${formatGiB(budget.mmprojBytes)}` : ""}
        {` + KV ${formatGiB(budget.kvBytes)} + overhead ${formatGiB(budget.overheadBytes)}`}
        {` = ${formatGiB(budget.totalBytes)}`}
        {` of ${formatGiB(budget.usableBytes)} usable`}
        {!budget.fits ? ` · ${formatGiB(spillBytes)} over` : ""}
      </Text>
      {/* Where the KV figure came from decides how much to trust the verdict.
          The theoretical formula overestimates badly on architectures that only
          keep a full cache on some layers, so an estimate usually means MORE
          context is available than this says, not less. */}
      <Text style={styles.budgetSource}>
        {`KV ${Math.round(budget.kvBytesPerToken)} bytes/token · ${calibrationLabel(calibration)}`}
      </Text>
    </View>
  );
}

// This screen coordinates independent model, component, budget, and hosting-profile state.
// Keep the orchestration here so every persist path feeds the same saved draft.
// oxlint-disable-next-line complexity
export function BrainProfileEditor({
  serverId,
  modelId,
  family,
  components,
  canWrite,
  reloadToken = 0,
  onSaved,
  onRequiresRestartChange,
  onCalibrationRequiredChange,
}: {
  serverId: string;
  modelId: string;
  family?: string | null;
  /** Bundle-only companion artifacts. Plain models omit this surface entirely. */
  components?: BrainInventoryModel["components"];
  /** False when the brain has not opted into remote configuration. */
  canWrite: boolean;
  /**
   * Bumped when something outside this editor changed the saved profile - a
   * finished calibration is the one that matters. Without it the budget panel
   * keeps reporting the estimate it loaded with, so a calibration that the
   * brain did save still reads as "Estimated" until the model is reselected.
   */
  reloadToken?: number;
  onSaved: () => void;
  /** Whether the just-saved edit is sitting on the loaded model, unapplied. */
  onRequiresRestartChange: (requiresRestart: boolean) => void;
  /** Whether this saved profile still needs a fresh VRAM calibration. */
  onCalibrationRequiredChange: (required: boolean) => void;
}) {
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);

  const [fields, setFields] = useState<BrainProfileField[]>([]);
  const [saved, setSaved] = useState<Draft>({});
  const [draft, setDraft] = useState<Draft>({});
  const [warnings, setWarnings] = useState<BrainProfileWarning[]>([]);
  const [calibration, setCalibration] = useState<string | null>(null);
  const [budget, setBudget] = useState<BrainBudget | null>(null);
  const [maxContext, setMaxContext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabledComponents, setEnabledComponents] = useState<string[]>([]);
  const [savedComponents, setSavedComponents] = useState<string[]>([]);
  const [hostingProfiles, setHostingProfiles] = useState<BrainHostingProfile[]>([]);
  const [familyHostingProfileId, setFamilyHostingProfileId] = useState<string | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [editingHostingProfile, setEditingHostingProfile] = useState<BrainHostingProfile | null>(
    null,
  );
  const [profileName, setProfileName] = useState("");
  const [profilePrompt, setProfilePrompt] = useState("");
  const [profileTemplate, setProfileTemplate] = useState("");

  // Load the profile and its descriptors whenever the selected model changes,
  // or when a calibration lands and makes the loaded budget stale.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      if (!client) {
        return;
      }
      try {
        const result = await client.brainModelProfileGet(modelId);
        if (cancelled) {
          return;
        }
        const nextDraft = buildDraft(result.profile, result.fields);
        setFields(result.fields);
        setSaved(nextDraft);
        setDraft(nextDraft);
        const enabled = result.profile?.enabledComponents ?? [];
        setEnabledComponents(enabled);
        setSavedComponents(enabled);
        setWarnings(result.warnings);
        setCalibration(result.calibration?.state ?? null);
        onRequiresRestartChange(result.requiresRestart);
        onCalibrationRequiredChange(result.profile?.calibrationRequired ?? true);
        setHostingProfiles(result.hostingProfiles ?? []);
        setFamilyHostingProfileId(result.familyHostingProfileId ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, modelId, reloadToken, onCalibrationRequiredChange, onRequiresRestartChange]);

  // Preview the VRAM budget for the draft, independent of saving it - this is
  // what answers "what happens if I keep this" while a control is still being
  // scrubbed, and it runs on a read-only brain too. Debounced for the same
  // reason the autosave below is: a held stepper should not put one request
  // per press on the wire.
  const budgetRequestRef = useRef(0);
  useEffect(() => {
    if (!client || loading) {
      return;
    }
    const requestId = ++budgetRequestRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await client.brainModelBudget(modelId, draftToOverrides(draft));
          if (requestId !== budgetRequestRef.current) {
            return;
          }
          setBudget(result.budget);
          setMaxContext(result.maxContextThatFits);
        } catch {
          // Non-fatal: the field editors above are still usable without a verdict.
        }
      })();
    }, BUDGET_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [client, modelId, draft, loading]);

  // Autosave the draft once it settles - debounced because a stepper held
  // down would otherwise put one request per press on the wire, and each one
  // makes the brain read a GGUF header. `brainModelProfileSet` both persists
  // AND returns the fresh budget/warnings verdict, so this one call replaces
  // what used to be a read-only preview request plus a separate Save button.
  const saveRequestRef = useRef(0);
  useEffect(() => {
    if (
      !client ||
      loading ||
      !canWrite ||
      (draftsMatch(draft, saved) && enabledComponents.join("\0") === savedComponents.join("\0"))
    ) {
      return;
    }
    const requestId = ++saveRequestRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        setSaving(true);
        setError(null);
        try {
          const result = await client.brainModelProfileSet(modelId, {
            ...hostingKeysWhenChanged(draft, saved),
            enabledComponents,
          });
          // Drop a reply that a newer edit has already superseded, or the
          // panel flickers back to a value the user has moved past.
          if (requestId !== saveRequestRef.current) {
            return;
          }
          const nextDraft = buildDraft(result.profile, fields);
          setFields(result.fields);
          setSaved(nextDraft);
          setDraft(nextDraft);
          const enabled = result.profile?.enabledComponents ?? [];
          setEnabledComponents(enabled);
          setSavedComponents(enabled);
          setWarnings(result.warnings);
          setCalibration(result.calibration?.state ?? null);
          setHostingProfiles(result.hostingProfiles ?? []);
          setFamilyHostingProfileId(result.familyHostingProfileId ?? null);
          setBudget(result.budget);
          setMaxContext(result.maxContextThatFits);
          // The brain clamps out-of-range values rather than refusing the
          // write, so say what it changed instead of silently showing a
          // different number.
          if (result.adjustments.length > 0) {
            setError(result.adjustments.join("; "));
          }
          onRequiresRestartChange(result.requiresRestart);
          onCalibrationRequiredChange(result.profile?.calibrationRequired ?? true);
          onSaved();
        } catch (err) {
          if (requestId === saveRequestRef.current) {
            setError(err instanceof Error ? err.message : String(err));
          }
        } finally {
          if (requestId === saveRequestRef.current) {
            setSaving(false);
          }
        }
      })();
    }, BUDGET_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    client,
    canWrite,
    draft,
    enabledComponents,
    fields,
    loading,
    modelId,
    onSaved,
    onCalibrationRequiredChange,
    onRequiresRestartChange,
    saved,
    savedComponents,
  ]);

  const blocking = useMemo(() => warnings.find((warning) => warning.blocksStart), [warnings]);
  const visibleFields = useMemo(() => {
    const hasVisionComponent = components?.some(
      (component) => component.role === "vision_projector",
    );
    const withoutLegacyVision = hasVisionComponent
      ? fields.filter((field) => field.key !== "vision")
      : fields;
    // These two settings describe one decision. Keep the multiplier immediately
    // ahead of its context size even if a future Brain adds descriptors before it.
    return [...withoutLegacyVision].sort((a, b) => {
      const order = ["contextMultiplier", "contextSize"];
      const aIndex = order.indexOf(a.key);
      const bIndex = order.indexOf(b.key);
      return (aIndex === -1 ? order.length : aIndex) - (bIndex === -1 ? order.length : bIndex);
    });
  }, [components, fields]);
  const hasLegacyVisionField = visibleFields.some((field) => field.key === "vision");

  const bundleOptions = components?.length ? (
    <View style={isCompact ? styles.gridCompact : styles.grid}>
      {components.map((component) => {
        const enabled = enabledComponents.includes(component.id);
        return (
          <View key={component.id} style={styles.fieldRow}>
            <View style={styles.fieldLabelColumn}>
              <Text style={styles.fieldLabel}>{component.label}</Text>
              <Text style={styles.fieldUnavailable}>
                {component.available
                  ? component.description
                  : (component.unavailableReason ?? "Not downloaded")}
              </Text>
            </View>
            <Switch
              value={enabled}
              disabled={!canWrite || saving || !component.available || component.required}
              onValueChange={(value) =>
                setEnabledComponents((current) =>
                  value
                    ? [...new Set([...current, component.id])]
                    : current.filter((id) => id !== component.id),
                )
              }
              accessibilityLabel={component.label}
            />
          </View>
        );
      })}
    </View>
  ) : null;

  const handleChange = useCallback((key: string, value: DraftValue) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const handleFitContext = useCallback(() => {
    if (maxContext) {
      setDraft((current) => ({ ...current, contextSize: maxContext }));
    }
  }, [maxContext]);

  const selectedHostingProfileId =
    typeof (draft as Record<string, unknown>).hostingProfileId === "string"
      ? ((draft as Record<string, string>).hostingProfileId ?? null)
      : null;
  const selectedHostingProfile = hostingProfiles.find(
    (profile) => profile.id === selectedHostingProfileId,
  );
  const familyDefaultProfile = hostingProfiles.find(
    (profile) => profile.id === familyHostingProfileId,
  );
  // Mirror the brain's authoritative selection into both drafts at once. Writing
  // only `draft` would leave the autosave effect seeing a dirty profile and
  // immediately re-saving what the server just told us.
  const syncHostingSelection = useCallback((profile: BrainProfile | null | undefined) => {
    const selection: Draft = {
      hostingProfileId: profile?.hostingProfileId ?? null,
      hostingProfileMode: profile?.hostingProfileMode ?? "inherit",
    };
    setDraft((current) => ({ ...current, ...selection }));
    setSaved((current) => ({ ...current, ...selection }));
  }, []);
  const openNewHostingProfile = useCallback(() => {
    setEditingHostingProfile(null);
    setProfileName("");
    setProfilePrompt("");
    setProfileTemplate("");
    setProfileEditorOpen(true);
    setProfileDialogOpen(true);
  }, []);
  const openEditHostingProfile = useCallback((profile: BrainHostingProfile) => {
    setEditingHostingProfile(profile);
    setProfileName(profile.name);
    setProfilePrompt(profile.systemPromptAddendum ?? "");
    setProfileTemplate(profile.template ?? "");
    setProfileEditorOpen(true);
    setProfileDialogOpen(true);
  }, []);
  const saveHostingProfile = useCallback(() => {
    if (!client || !modelId) return;
    void (async () => {
      try {
        const result = await client.brainModelProfileSet(modelId, {
          hostingProfile: {
            id: editingHostingProfile?.id ?? "",
            name: profileName,
            // Must match what the brain files this model under. Reading it off
            // the first listed profile instead would file a new profile under a
            // sibling's family the moment `family` was not supplied.
            family: family || "generic",
            description: "",
            template: profileTemplate.trim() || null,
            systemPromptAddendum: profilePrompt.trim() || null,
            templateKwargs: editingHostingProfile?.templateKwargs ?? {},
          },
        });
        setHostingProfiles(result.hostingProfiles ?? []);
        setFamilyHostingProfileId(result.familyHostingProfileId ?? null);
        syncHostingSelection(result.profile);
        // Saving a profile returns to the library it belongs to. A newly created
        // one comes back already selected on this model, so the library shows it
        // as Selected instead of making the user reopen Manage to find it.
        setProfileEditorOpen(false);
        onRequiresRestartChange(result.requiresRestart);
        onCalibrationRequiredChange(result.profile?.calibrationRequired ?? true);
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [
    client,
    editingHostingProfile,
    family,
    modelId,
    onRequiresRestartChange,
    onCalibrationRequiredChange,
    onSaved,
    syncHostingSelection,
    profileName,
    profilePrompt,
    profileTemplate,
  ]);
  const deleteHostingProfile = useCallback(
    (profile: BrainHostingProfile) => {
      if (!client) return;
      void (async () => {
        const confirmed = await confirmDialog({
          title: `Delete ${profile.name}?`,
          message: "Models using this profile will switch to Off.",
          confirmLabel: "Delete",
          destructive: true,
        });
        if (!confirmed) return;
        try {
          const result = await client.brainModelProfileSet(modelId, {
            deleteHostingProfileId: profile.id,
          });
          setHostingProfiles(result.hostingProfiles ?? []);
          setFamilyHostingProfileId(result.familyHostingProfileId ?? null);
          syncHostingSelection(result.profile);
          onRequiresRestartChange(result.requiresRestart);
          onCalibrationRequiredChange(result.profile?.calibrationRequired ?? true);
          onSaved();
          setProfileEditorOpen(false);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [
      client,
      modelId,
      onCalibrationRequiredChange,
      onRequiresRestartChange,
      onSaved,
      syncHostingSelection,
    ],
  );
  /** `null` clears the family default, which is the only way back off it. */
  const setFamilyDefault = useCallback(
    (profileId: string | null) => {
      if (!client) return;
      void (async () => {
        try {
          const result = await client.brainModelProfileSet(modelId, {
            familyHostingProfileId: profileId,
          });
          setHostingProfiles(result.hostingProfiles ?? []);
          setFamilyHostingProfileId(result.familyHostingProfileId ?? null);
          syncHostingSelection(result.profile);
          onRequiresRestartChange(result.requiresRestart);
          onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [client, modelId, onRequiresRestartChange, onSaved, syncHostingSelection],
  );
  const selectedHostingProfileMode =
    typeof (draft as Record<string, unknown>).hostingProfileMode === "string"
      ? ((draft as Record<string, string>).hostingProfileMode ?? "inherit")
      : "inherit";
  const selectHostingProfileMode = useCallback(
    (mode: "inherit" | "off" | "custom", profileId: string | null = null) => {
      setDraft((current) => ({
        ...current,
        hostingProfileMode: mode,
        hostingProfileId: profileId,
      }));
    },
    [],
  );
  const profileDialogFooter = useMemo(
    () => (
      <View style={styles.profileFooter}>
        {profileEditorOpen ? (
          <>
            {editingHostingProfile ? (
              <Button
                variant="destructive"
                onPress={() => deleteHostingProfile(editingHostingProfile)}
              >
                Delete
              </Button>
            ) : null}
            <Button variant="secondary" onPress={() => setProfileEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              onPress={saveHostingProfile}
              disabled={!profileName.trim() || !profileTemplate.trim()}
            >
              Save profile
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onPress={() => setProfileDialogOpen(false)}>
              Close
            </Button>
            <Button variant="default" onPress={openNewHostingProfile}>
              New profile
            </Button>
          </>
        )}
      </View>
    ),
    [
      deleteHostingProfile,
      editingHostingProfile,
      openNewHostingProfile,
      profileEditorOpen,
      profileName,
      profileTemplate,
      saveHostingProfile,
    ],
  );
  const profileDialogHeader = useMemo(
    () =>
      profileEditorOpen
        ? {
            title: editingHostingProfile ? "Edit profile" : "New profile",
            subtitle: "Applies when the model reloads.",
            back: { onPress: () => setProfileEditorOpen(false), label: "Back to profiles" },
          }
        : HOSTING_PROFILE_SHEET_HEADER,
    [editingHostingProfile, profileEditorOpen],
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        <ThemedSpinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? <Alert variant="warning" description={error} /> : null}
      {!canWrite ? (
        <Alert
          variant="info"
          description="This brain does not allow remote configuration, so these fields are read-only."
        />
      ) : null}

      <View style={isCompact ? styles.gridCompact : styles.grid}>
        <BudgetPanel budget={budget} calibration={calibration} />
        {visibleFields.map((field) => (
          <Fragment key={field.key}>
            <FieldRow
              field={field}
              value={draft[field.key]}
              onChange={handleChange}
              disabled={!canWrite || saving}
              warnings={warnings}
              onFitContext={
                field.key === "contextSize" && canWrite && maxContext ? handleFitContext : undefined
              }
            />
            {field.key === (hasLegacyVisionField ? "vision" : "flashAttention")
              ? bundleOptions
              : null}
          </Fragment>
        ))}
        <View style={styles.fieldRow}>
          <View style={styles.fieldLabelColumn}>
            <Text style={styles.fieldLabel}>Prompt & template</Text>
            <Text style={styles.fieldUnavailable}>
              {hostingProfileSummary(
                selectedHostingProfileMode,
                selectedHostingProfile,
                familyDefaultProfile,
              )}
            </Text>
          </View>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => setProfileDialogOpen(true)}
            disabled={!canWrite}
          >
            Manage
          </Button>
        </View>
      </View>

      {blocking ? <Alert variant="error" description={blocking.message} /> : null}

      {saving ? <Text style={styles.savingHint}>Saving…</Text> : null}
      <AdaptiveModalSheet
        visible={profileDialogOpen}
        onClose={() => {
          setProfileDialogOpen(false);
          setProfileEditorOpen(false);
        }}
        header={profileDialogHeader}
        footer={profileDialogFooter}
        desktopMaxWidth={640}
      >
        {error ? <Alert variant="error" description={error} /> : null}
        {profileEditorOpen ? (
          <View style={styles.profileEditor}>
            <Field label="Profile name" hint="A short label visible to every model in this family.">
              <FormTextInput
                placeholder="For example: Coding with tools"
                initialValue={profileName}
                // Reset only when switching records. Including the live value
                // remounted this controlled input after every character and
                // made typing beyond one character impossible.
                resetKey={`${editingHostingProfile?.id ?? "new"}:name`}
                onChangeText={setProfileName}
              />
            </Field>
            <Field
              label="System-prompt addendum"
              hint="Optional instructions appended to Otto's system prompt. Do not paste a full chat template here."
            >
              <FormTextInput
                placeholder="For example: Be concise and preserve tool-call syntax."
                multiline
                initialValue={profilePrompt}
                resetKey={`${editingHostingProfile?.id ?? "new"}:prompt`}
                onChangeText={setProfilePrompt}
                style={styles.profileTextArea}
              />
            </Field>
            <Field
              label="Jinja chat template"
              hint="Required. Paste the complete llama.cpp-compatible Jinja template that formats messages for this model family."
            >
              <FormTextInput
                placeholder="{% for message in messages %}…{% endfor %}"
                multiline
                initialValue={profileTemplate}
                resetKey={`${editingHostingProfile?.id ?? "new"}:template`}
                onChangeText={setProfileTemplate}
                style={styles.profileTextArea}
              />
            </Field>
          </View>
        ) : (
          <View style={styles.profileLibrary}>
            <Text style={styles.profileIntro}>
              Choose the formatting this model uses. Changes take effect the next time it loads.
            </Text>
            <Text style={styles.profileSectionLabel}>This model</Text>
            <Pressable
              style={[
                styles.profileChoice,
                selectedHostingProfileMode === "inherit" && styles.profileChoiceSelected,
                !familyHostingProfileId && styles.profileChoiceDisabled,
              ]}
              disabled={!familyHostingProfileId}
              onPress={() => selectHostingProfileMode("inherit")}
            >
              <View style={styles.profileChoiceCopy}>
                <Text style={styles.profileChoiceTitle}>System default</Text>
                <Text style={styles.profileChoiceHint}>
                  {familyDefaultProfile
                    ? `Use this family’s default profile (${familyDefaultProfile.name})`
                    : "No default profile has been set for this family"}
                </Text>
              </View>
              {selectedHostingProfileMode === "inherit" ? (
                <Text style={styles.profileChoiceStatus}>Selected</Text>
              ) : null}
            </Pressable>
            <Pressable
              style={[
                styles.profileChoice,
                selectedHostingProfileMode === "off" && styles.profileChoiceSelected,
              ]}
              onPress={() => selectHostingProfileMode("off")}
            >
              <View style={styles.profileChoiceCopy}>
                <Text style={styles.profileChoiceTitle}>Off</Text>
                <Text style={styles.profileChoiceHint}>
                  Use the template embedded in this model
                </Text>
              </View>
              {selectedHostingProfileMode === "off" ? (
                <Text style={styles.profileChoiceStatus}>Selected</Text>
              ) : null}
            </Pressable>
            <Text style={styles.profileSectionLabel}>Custom profiles</Text>
            {hostingProfiles.length === 0 ? (
              <Text style={styles.profileEmpty}>No custom profiles for this model family yet.</Text>
            ) : (
              hostingProfiles.map((profile) => {
                const isSelected =
                  profile.id === selectedHostingProfileId &&
                  selectedHostingProfileMode === "custom";
                const isDefault = profile.id === familyHostingProfileId;
                return (
                  <View
                    key={profile.id}
                    style={[styles.profileChoice, isSelected && styles.profileChoiceSelected]}
                  >
                    <Pressable
                      style={styles.profileChoiceCopy}
                      onPress={() => selectHostingProfileMode("custom", profile.id)}
                    >
                      <Text style={styles.profileChoiceTitle}>{profile.name}</Text>
                      <Text style={styles.profileChoiceHint}>
                        {isDefault
                          ? "System default for this family"
                          : "Custom prompt and Jinja template"}
                      </Text>
                    </Pressable>
                    <View style={styles.profileChoiceActions}>
                      {isSelected ? <Text style={styles.profileChoiceStatus}>Selected</Text> : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onPress={() => openEditHostingProfile(profile)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onPress={() => setFamilyDefault(isDefault ? null : profile.id)}
                      >
                        {isDefault ? "Clear default" : "Set default"}
                      </Button>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}
      </AdaptiveModalSheet>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
  },
  loading: {
    paddingVertical: theme.spacing[6],
    alignItems: "center",
  },
  grid: {
    gap: theme.spacing[2],
  },
  gridCompact: {
    gap: theme.spacing[3],
  },
  fieldRow: {
    flexDirection: "row",
    // Centered, not top-aligned: every label is one line against a one-line
    // control, so aligning to the top reads as the label sitting high.
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  fieldLabelColumn: {
    flexShrink: 1,
  },
  fieldLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  fieldUnavailable: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  fieldControl: {
    alignItems: "flex-end",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  controlLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  stepperValue: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
    minWidth: 72,
    textAlign: "right",
  },
  controlDisabled: {
    opacity: 0.5,
  },
  hintText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "right",
  },
  warnText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.palette.yellow[400],
    textAlign: "right",
  },
  // The Cached KVs estimate turns red when the parked state would use at
  // least the whole installed RAM. Matches the budget panel's "over" verdict.
  errorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.palette.red[500],
    textAlign: "right",
  },
  budget: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    // surface1, not surface3: every other card on this page is a dark
    // surface1 fill with a visible border - surface3 stood out as a
    // conspicuously lighter box instead of matching the set.
    backgroundColor: theme.colors.surface1,
  },
  meterTrack: {
    height: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    // surface3, not surface2: needs to read as a track recessed into the
    // card now that the card itself is surface1.
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  // The track clips both ends (overflow hidden + full radius), so the fill
  // segments stay square at their seam - a rounded fill here would pinch a gap
  // where the on-GPU and spill segments meet.
  meterFill: {
    height: "100%",
    backgroundColor: theme.colors.accentBright,
  },
  // The purple tail is the cache that does not fit in VRAM and spills to RAM.
  meterFillSpill: {
    backgroundColor: theme.colors.palette.purple[500],
  },
  budgetVerdictGood: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.palette.green[400],
  },
  budgetVerdictBad: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.palette.red[500],
  },
  budgetVerdictNeutral: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  budgetBreakdown: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  budgetSource: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  savingHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "right",
  },
  profileLibrary: {
    gap: theme.spacing[3],
  },
  profileEditor: {
    gap: theme.spacing[4],
  },
  profileIntro: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
  },
  profileSectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
  },
  profileChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 64,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
  },
  profileChoiceSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  profileChoiceDisabled: {
    opacity: theme.opacity[50],
  },
  profileChoiceCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  profileChoiceTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  profileChoiceHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  profileChoiceStatus: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  profileChoiceActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  profileEmpty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
  },
  profileFooter: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  profileTextArea: {
    minHeight: 120,
    textAlignVertical: "top",
    fontFamily: theme.fontFamily.mono,
  },
}));
