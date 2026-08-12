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
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  BrainBudget,
  BrainInventoryModel,
  BrainProfile,
  BrainProfileField,
  BrainProfileWarning,
} from "@otto-code/protocol/messages";
import { Minus, Plus } from "@/components/icons/material-icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
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

type DraftValue = string | number | boolean;
type Draft = Record<string, DraftValue>;

function readDraftValue(profile: BrainProfile | null, key: string): DraftValue | undefined {
  const value = (profile as Record<string, unknown> | null)?.[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function buildDraft(profile: BrainProfile | null, fields: BrainProfileField[]): Draft {
  const draft: Draft = {};
  for (const field of fields) {
    const value = readDraftValue(profile, field.key);
    if (value !== undefined) {
      draft[field.key] = value;
    }
  }
  return draft;
}

/** Query-string form of the draft, for the budget preview endpoint. */
function draftToOverrides(draft: Draft): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft)) {
    overrides[key] = String(value);
  }
  return overrides;
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

  // 999 GPU layers means "all of them", which is what the flag actually does.
  const display =
    field.key === "gpuLayers" && value >= (field.max ?? 999) ? "All" : value.toLocaleString();

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
          <Text
            key={warning.message}
            style={warning.severity === "warn" ? styles.warnText : styles.hintText}
          >
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

  const utilization = Math.max(0, Math.min(1, budget.utilization));
  const overBy = budget.totalBytes - budget.usableBytes;

  return (
    <View style={styles.budget}>
      <View style={styles.meterTrack}>
        <View
          style={[
            styles.meterFill,
            !budget.fits && styles.meterFillDanger,
            { width: `${utilization * 100}%` as const },
          ]}
        />
      </View>
      <Text style={budget.fits ? styles.budgetVerdictGood : styles.budgetVerdictBad}>
        {budget.fits
          ? `Fits entirely on the GPU, ${formatGiB(budget.headroomBytes)} to spare`
          : `Exceeds VRAM by ${formatGiB(overBy)}`}
      </Text>
      <Text style={styles.budgetBreakdown}>
        {`weights ${formatGiB(budget.weightsBytes)}`}
        {budget.mmprojBytes > 0 ? ` + projector ${formatGiB(budget.mmprojBytes)}` : ""}
        {` + KV ${formatGiB(budget.kvBytes)} + overhead ${formatGiB(budget.overheadBytes)}`}
        {` = ${formatGiB(budget.totalBytes)} of ${formatGiB(budget.usableBytes)} usable`}
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

export function BrainProfileEditor({
  serverId,
  modelId,
  components,
  canWrite,
  onSaved,
  onRequiresRestartChange,
}: {
  serverId: string;
  modelId: string;
  /** Bundle-only companion artifacts. Plain models omit this surface entirely. */
  components?: BrainInventoryModel["components"];
  /** False when the brain has not opted into remote configuration. */
  canWrite: boolean;
  onSaved: () => void;
  /** Whether the just-saved edit is sitting on the loaded model, unapplied. */
  onRequiresRestartChange: (requiresRestart: boolean) => void;
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

  // Load the profile and its descriptors whenever the selected model changes.
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
  }, [client, modelId, onRequiresRestartChange]);

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
            ...draft,
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
          setBudget(result.budget);
          setMaxContext(result.maxContextThatFits);
          // The brain clamps out-of-range values rather than refusing the
          // write, so say what it changed instead of silently showing a
          // different number.
          if (result.adjustments.length > 0) {
            setError(result.adjustments.join("; "));
          }
          onRequiresRestartChange(result.requiresRestart);
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
    onRequiresRestartChange,
    saved,
    savedComponents,
  ]);

  const blocking = useMemo(() => warnings.find((warning) => warning.blocksStart), [warnings]);
  const visibleFields = useMemo(() => {
    const hasVisionComponent = components?.some(
      (component) => component.role === "vision_projector",
    );
    return hasVisionComponent ? fields.filter((field) => field.key !== "vision") : fields;
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
        {visibleFields.map((field) => (
          <Fragment key={field.key}>
            {field.key === "contextSize" ? (
              <BudgetPanel budget={budget} calibration={calibration} />
            ) : null}
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
      </View>

      {blocking ? <Alert variant="error" description={blocking.message} /> : null}

      {saving ? <Text style={styles.savingHint}>Saving…</Text> : null}
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
  meterFill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accentBright,
  },
  meterFillDanger: {
    backgroundColor: theme.colors.palette.red[500],
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
}));
