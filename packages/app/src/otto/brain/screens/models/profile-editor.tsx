import { useStyles } from "./profile-styles";
import { useBrainSurfaceActive } from "../../lifecycle";
import { useBrainOperations } from "../context";
import { PressHighlight } from "@/components/ui/press-highlight";
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
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { withBrainTheme } from "../theme";
import type {
  BrainBudget,
  BrainInventoryModel,
  BrainHostingProfile,
  BrainProfileField,
  BrainProfileWarning,
  BrainProfilePatch,
  BrainProfileRead,
} from "../contracts/models";
import { Minus, Plus } from "../ui/icons";
import { Alert } from "@/components/ui/alert";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { BrainLoadingSpinner } from "../theme";

import { SegmentedControl } from "../ui/segmented-control";
import { stepCapForRange, useStepperHold } from "../ui/stepper-hold";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { BrainScreenTheme as Theme } from "../theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { calibrationLabel, formatGiB } from "../format";
import {
  ProfileDraftController,
  PROFILE_EDIT_DEBOUNCE_MS as BUDGET_DEBOUNCE_MS,
  profileDraftToOverrides as draftToOverrides,
  type ProfileDraft as Draft,
  type ProfileDraftValue as DraftValue,
} from "./profile-draft-controller";

const ThemedMinus = withBrainTheme(Minus);
const ThemedPlus = withBrainTheme(Plus);
const ThemedSpinner = BrainLoadingSpinner;

// Muted at rest, like every other stepper glyph in the app: the button's own
// hover fill is the affordance, not a full-strength icon in a dense grid.
const stepperIcon = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.xs,
});
const minusIcon = <ThemedMinus uniProps={stepperIcon} />;
const plusIcon = <ThemedPlus uniProps={stepperIcon} />;

const EMPTY_FIELDS: BrainProfileField[] = [];
const EMPTY_WARNINGS: BrainProfileWarning[] = [];
const EMPTY_HOSTING_PROFILES: BrainHostingProfile[] = [];
const HOSTING_PROFILE_SHEET_HEADER = {
  title: "Prompt & template profiles",
  subtitle: "Stored on this Brain and applied on reload.",
};

function profileEditorMetadata(metadata: BrainProfileRead | null) {
  return {
    fields: metadata?.fields ?? EMPTY_FIELDS,
    warnings: metadata?.warnings ?? EMPTY_WARNINGS,
    calibration: metadata?.calibration?.state ?? null,
    hostingProfiles: metadata?.hostingProfiles ?? EMPTY_HOSTING_PROFILES,
    familyHostingProfileId: metadata?.familyHostingProfileId ?? null,
    revision: metadata?.revision ?? null,
  };
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
  // A sampler reads as 0.80, not 0.8: a column of values that keep the same
  // number of decimals is scannable, and one that gains and loses them is not.
  const precision = field.precision ?? 0;
  if (precision > 0) return value.toFixed(precision);
  return value.toLocaleString();
}

/**
 * Snap a stepped value onto the field's precision.
 *
 * Binary floating point is why: 0.05 six times over is 0.30000000000000004, and
 * without this the stepper displays that, sends it, and llama-server is launched
 * with it. The brain rounds on write too - this keeps the number the user is
 * looking at honest while they are still scrubbing.
 */
function roundToPrecision(value: number, precision: number): number {
  return precision > 0 ? Number(value.toFixed(precision)) : Math.round(value);
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
  const styles = useStyles();
  const step = field.step ?? 1;
  const min = field.min ?? 0;
  const max = field.max ?? Number.MAX_SAFE_INTEGER;
  const precision = field.precision ?? 0;

  // The repeating hold closure needs the latest value without re-subscribing;
  // keep a ref mirror updated every render and optimistically on each step.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Apply one step of `magnitude` increments. Returns whether the value moved,
  // which is false at a bound and stops the hold loop there.
  const applyStep = useCallback(
    (direction: 1 | -1, magnitude: number): boolean => {
      const now = valueRef.current;
      const raw = Math.max(min, Math.min(max, now + direction * step * magnitude));
      const next = roundToPrecision(raw, precision);
      if (next === now) {
        return false;
      }
      valueRef.current = next;
      onChange(next);
      return true;
    },
    [max, min, onChange, precision, step],
  );

  const stepCap = useMemo(() => stepCapForRange(min, max, step), [max, min, step]);
  const { startHold, stopHold } = useStepperHold(applyStep, stepCap);
  const handleDecreasePressIn = useCallback(() => startHold(-1), [startHold]);
  const handleIncreasePressIn = useCallback(() => startHold(1), [startHold]);

  const containerStyle = useMemo(
    () => [styles.stepper, disabled ? styles.controlDisabled : null],
    [styles, disabled],
  );

  return (
    <View style={containerStyle}>
      <StepperButton
        icon={minusIcon}
        label={`Decrease ${field.label}`}
        edgeStyle={styles.stepperButtonLeft}
        disabled={disabled || value <= min}
        dimmed={!disabled && value <= min}
        onPressIn={handleDecreasePressIn}
        onPressOut={stopHold}
        testID={`brain-field-${field.key}-down`}
      />
      <Text style={styles.stepperValue} numberOfLines={1}>
        {formatFieldValue(field, value)}
      </Text>
      <StepperButton
        icon={plusIcon}
        label={`Increase ${field.label}`}
        edgeStyle={styles.stepperButtonRight}
        disabled={disabled || value >= max}
        dimmed={!disabled && value >= max}
        onPressIn={handleIncreasePressIn}
        onPressOut={stopHold}
        testID={`brain-field-${field.key}-up`}
      />
    </View>
  );
}

/** One end cap of the framed stepper: a flush, divider-separated icon button. */
function StepperButton({
  icon,
  label,
  edgeStyle,
  disabled,
  dimmed,
  onPressIn,
  onPressOut,
  testID,
}: {
  icon: ReactNode;
  label: string;
  edgeStyle: StyleProp<ViewStyle>;
  disabled: boolean;
  /** Dim this cap on its own. False when the whole control is already dimmed. */
  dimmed: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
  testID: string;
}) {
  const styles = useStyles();
  const renderStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.stepperButton,
      edgeStyle,
      !disabled && (hovered || pressed) ? styles.stepperButtonActive : null,
      dimmed ? styles.stepperButtonDisabled : null,
    ],
    [styles, dimmed, disabled, edgeStyle],
  );

  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={renderStyle}
      testID={testID}
    >
      {icon}
    </PressHighlight>
  );
}

function CycleField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: BrainProfileField;
  /** The stored value, uncoerced: a tri-state needs its null and its booleans. */
  value: DraftValue;
  onChange: (next: DraftValue) => void;
  disabled: boolean;
}) {
  const styles = useStyles();
  const options = useMemo(
    () =>
      field.options.map((option, index) => ({
        value: String(option),
        label: field.optionLabels[index] ?? String(option),
      })),
    [field.optionLabels, field.options],
  );

  // What each option stores, when that differs from the option itself: a
  // tri-state keeps true/false/null behind the strings "on"/"off"/"default".
  const optionValues = field.optionValues;
  const selected = useMemo(() => {
    if (!optionValues) return String(value);
    const index = optionValues.findIndex((stored) => stored === value);
    return index < 0 ? String(value) : String(field.options[index] ?? value);
  }, [field.options, optionValues, value]);

  const handleChange = useCallback(
    (next: string) => {
      // Map the string the control hands back to the ORIGINAL option, so a
      // numeric budget stays a number rather than becoming "1536" on the wire.
      const index = options.findIndex((option) => option.value === next);
      if (optionValues && index >= 0) {
        onChange(optionValues[index] ?? null);
        return;
      }
      onChange(field.options[index] ?? next);
    },
    [field.options, onChange, optionValues, options],
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
        value={selected}
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
    // Passed uncoerced: CycleField resolves the selected option against
    // `optionValues` when the field declares one, and a `null` flattened to ""
    // here would leave a tri-state showing nothing selected.
    return <CycleField field={field} value={value ?? null} onChange={onChange} disabled={locked} />;
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
function warningSeverityStyle(severity: string, styles: ReturnType<typeof useStyles>) {
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
  const styles = useStyles();
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
        {field.description ? (
          // The sentence comes from the brain with the field, so the tooltip
          // describes the setting this brain actually has rather than the one
          // the client was built against.
          <Tooltip>
            <TooltipTrigger asChild>
              <Text style={styles.fieldLabel}>{field.label}</Text>
            </TooltipTrigger>
            <TooltipContent>
              <Text style={styles.tooltipText}>{field.description}</Text>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Text style={styles.fieldLabel}>{field.label}</Text>
        )}
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
          <Text key={warning.message} style={warningSeverityStyle(warning.severity, styles)}>
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
  pending,
  error,
}: {
  budget: BrainBudget | null;
  calibration: string | null;
  pending: boolean;
  error: string | null;
}) {
  const styles = useStyles();
  if (pending || error) {
    return (
      <View style={styles.budget}>
        <Text style={styles.budgetVerdictNeutral}>
          {error ? `VRAM budget unavailable: ${error}` : "Checking VRAM budget…"}
        </Text>
      </View>
    );
  }
  if (!budget) {
    return (
      <View style={styles.budget}>
        <Text style={styles.budgetVerdictNeutral}>
          No GPU detected, so there is no VRAM budget to check.
        </Text>
      </View>
    );
  }
  return <MeasuredBudgetPanel budget={budget} calibration={calibration} />;
}

function MeasuredBudgetPanel({
  budget,
  calibration,
}: {
  budget: BrainBudget;
  calibration: string | null;
}) {
  const styles = useStyles();

  // The track scales to the whole estimate. Its purple tail is the amount
  // above the admission budget, not a measured CPU spill on unified memory.
  const spillBytes = Math.max(0, budget.totalBytes - budget.usableBytes);
  const onGpuBytes = Math.min(budget.totalBytes, budget.usableBytes);
  const scaleTotal = Math.max(budget.totalBytes, budget.usableBytes);
  const onGpuPct = scaleTotal > 0 ? (onGpuBytes / scaleTotal) * 100 : 0;
  const spillPct = scaleTotal > 0 ? (spillBytes / scaleTotal) * 100 : 0;
  const drafterBytes = Math.max(0, (budget.componentBytes ?? 0) - budget.mmprojBytes);
  const onGpuStyle = useMemo(
    () => [styles.meterFill, { width: `${onGpuPct}%` as const }],
    [styles, onGpuPct],
  );
  const spillStyle = useMemo(
    () => [styles.meterFill, styles.meterFillSpill, { width: `${spillPct}%` as const }],
    [styles, spillPct],
  );

  return (
    <View style={styles.budget}>
      <View style={styles.meterTrack}>
        <View style={onGpuStyle} />
        {spillPct > 0 ? <View style={spillStyle} /> : null}
      </View>
      <Text style={budget.fits ? styles.budgetVerdictGood : styles.budgetVerdictBad}>
        {budget.fits
          ? `Within GPU budget, ${formatGiB(budget.headroomBytes, 2)} headroom`
          : `${formatGiB(spillBytes, 2)} over the GPU budget`}
      </Text>
      <Text style={styles.budgetBreakdown}>
        {`weights ${formatGiB(budget.weightsBytes)}`}
        {budget.mmprojBytes > 0 ? ` + projector ${formatGiB(budget.mmprojBytes)}` : ""}
        {drafterBytes > 0 ? ` + drafter ${formatGiB(drafterBytes)}` : ""}
        {` + KV ${formatGiB(budget.kvBytes, 2)} + overhead ${formatGiB(budget.overheadBytes)}`}
        {(budget.drafterKvBytes ?? 0) > 0
          ? ` + drafter KV ${formatGiB(budget.drafterKvBytes, 2)}`
          : ""}
        {(budget.imageProcessingBytes ?? 0) > 0
          ? ` + image buffers ${formatGiB(budget.imageProcessingBytes)}`
          : ""}
        {` = ${formatGiB(budget.totalBytes, 2)}`}
        {` of ${formatGiB(budget.usableBytes, 2)} usable`}
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
function ProfileComponentRow({
  component,
  enabled,
  canWrite,
  onChange,
}: {
  component: NonNullable<BrainInventoryModel["components"]>[number];
  enabled: boolean;
  canWrite: boolean;
  onChange: (id: string, enabled: boolean) => void;
}) {
  const styles = useStyles();
  const handleChange = useCallback(
    (value: boolean) => onChange(component.id, value),
    [component.id, onChange],
  );
  return (
    <View style={styles.fieldRow}>
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
        disabled={!canWrite || !component.available || component.required}
        onValueChange={handleChange}
        accessibilityLabel={component.label}
      />
    </View>
  );
}

function ProfileBundleOptions({
  components,
  enabledComponents,
  canWrite,
  onChange,
}: {
  components: BrainInventoryModel["components"];
  enabledComponents: string[];
  canWrite: boolean;
  onChange: (id: string, enabled: boolean) => void;
}) {
  const styles = useStyles();
  const compact = useIsCompactFormFactor();
  if (!components?.length) return null;
  return (
    <View style={compact ? styles.gridCompact : styles.grid}>
      {components.map((component) => (
        <ProfileComponentRow
          key={component.id}
          component={component}
          enabled={enabledComponents.includes(component.id)}
          canWrite={canWrite}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

function HostingProfileRow({
  profile,
  selected,
  isDefault,
  disabled,
  onSelect,
  onEdit,
  onDefault,
}: {
  profile: BrainHostingProfile;
  selected: boolean;
  isDefault: boolean;
  disabled: boolean;
  onSelect: (mode: "inherit" | "off" | "custom", profileId?: string | null) => void;
  onEdit: (profile: BrainHostingProfile) => void;
  onDefault: (id: string | null) => void;
}) {
  const styles = useStyles();
  const select = useCallback(() => onSelect("custom", profile.id), [onSelect, profile.id]);
  const edit = useCallback(() => onEdit(profile), [onEdit, profile]);
  const setDefault = useCallback(
    () => onDefault(isDefault ? null : profile.id),
    [onDefault, isDefault, profile.id],
  );
  return (
    <View style={[styles.profileChoice, selected && styles.profileChoiceSelected]}>
      <PressHighlight style={styles.profileChoiceCopy} onPress={select}>
        <Text style={styles.profileChoiceTitle}>{profile.name}</Text>
        <Text style={styles.profileChoiceHint}>
          {isDefault ? "System default for this family" : "Custom prompt and Jinja template"}
        </Text>
      </PressHighlight>
      <View style={styles.profileChoiceActions}>
        {selected ? <Text style={styles.profileChoiceStatus}>Selected</Text> : null}
        <Button variant="ghost" size="sm" onPress={edit}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onPress={setDefault} disabled={disabled}>
          {isDefault ? "Clear default" : "Set default"}
        </Button>
      </View>
    </View>
  );
}

function ProfileSaveNotice({
  error,
  externalChange,
  saveBlocked,
  unavailable,
  saving,
  reload,
}: {
  error: string | null;
  externalChange: boolean;
  saveBlocked: boolean;
  unavailable: boolean;
  saving: boolean;
  reload: () => void;
}) {
  return (
    <>
      {error ? <Alert variant="warning" description={error} /> : null}
      {externalChange ? (
        <Alert
          variant="info"
          description="The saved profile may have changed. Reload it to review the host's current settings; the local draft has been kept."
        />
      ) : null}
      {saveBlocked || externalChange || unavailable ? (
        <Button variant="secondary" size="sm" onPress={reload} disabled={saving}>
          Reload saved profile
        </Button>
      ) : null}
    </>
  );
}

interface BrainProfileEditorProps {
  serverId: string;
  modelId: string;
  family?: string | null;
  /** Bundle-only companion artifacts. Plain models omit this surface entirely. */
  components?: BrainInventoryModel["components"];
  /** False when the brain has not opted into remote configuration. */
  canWrite: boolean;
  /**
   * Bumped when a calibration or another external operation changes the saved
   * profile. Offer an explicit reload without replacing the current draft or
   * the revision it was based on.
   */
  reloadToken?: number;
  onSaved: () => void;
  /** Whether the just-saved edit is sitting on the loaded model, unapplied. */
  onRequiresRestartChange: (requiresRestart: boolean) => void;
  /** Whether this saved profile still needs a fresh VRAM calibration. */
  onCalibrationRequiredChange: (required: boolean) => void;
}

export function BrainProfileEditor(props: BrainProfileEditorProps) {
  const view = useProfileEditor(props);
  return <ProfileEditorView view={view} />;
}

function useProfileEditor({
  modelId,
  family,
  components,
  canWrite,
  reloadToken = 0,
  onSaved,
  onRequiresRestartChange,
  onCalibrationRequiredChange,
}: BrainProfileEditorProps) {
  const styles = useStyles();
  const isCompact = useIsCompactFormFactor();
  const client = useBrainOperations();
  const active = useBrainSurfaceActive();

  const [budgetResult, setBudgetResult] = useState<{
    modelId: string;
    draft: Draft;
    budget: BrainBudget | null;
    maxContext: number | null;
    error: string | null;
  } | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [editingHostingProfile, setEditingHostingProfile] = useState<BrainHostingProfile | null>(
    null,
  );
  const [profileName, setProfileName] = useState("");
  const [profilePrompt, setProfilePrompt] = useState("");
  const [profileTemplate, setProfileTemplate] = useState("");
  const callbacks = useRef({ onSaved, onRequiresRestartChange, onCalibrationRequiredChange });
  callbacks.current = { onSaved, onRequiresRestartChange, onCalibrationRequiredChange };
  const controller = useMemo(
    () =>
      new ProfileDraftController(modelId, client, (event) => {
        callbacks.current.onRequiresRestartChange(event.result.requiresRestart);
        callbacks.current.onCalibrationRequiredChange(
          event.result.profile?.calibrationRequired ?? true,
        );
        if (event.kind === "read") {
          setBudgetResult(null);
        } else {
          setBudgetResult({
            modelId,
            draft: event.acceptedDraft,
            budget: event.result.budget,
            maxContext: event.result.maxContextThatFits,
            error: null,
          });
          callbacks.current.onSaved();
        }
      }),
    [client, modelId],
  );
  const {
    profile: metadata,
    draft,
    enabledComponents,
    loading,
    saving,
    error,
    saveBlocked,
    externalChange,
  } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { fields, warnings, calibration, hostingProfiles, familyHostingProfileId, revision } =
    profileEditorMetadata(metadata);
  // A measurement only describes the model and draft that requested it.
  const currentBudget =
    budgetResult?.modelId === modelId && budgetResult.draft === draft ? budgetResult : null;
  const budget = currentBudget?.budget ?? null;
  const maxContext = currentBudget?.maxContext ?? null;

  useEffect(() => controller.setWritable(canWrite), [canWrite, controller]);
  useEffect(() => {
    if (active) return controller.activate();
  }, [active, controller]);

  const observedReloadToken = useRef(reloadToken);
  useEffect(() => {
    if (observedReloadToken.current === reloadToken) return;
    observedReloadToken.current = reloadToken;
    controller.noteExternalChange();
  }, [controller, reloadToken]);

  const reloadProfile = useCallback(() => {
    void controller.reload(
      () =>
        confirmDialog({
          title: "Reload saved profile?",
          message:
            "This replaces the local draft with the profile currently saved on this host. Unsaved changes will be discarded.",
          confirmLabel: "Reload",
        }),
      () => {
        setProfileDialogOpen(false);
        setProfileEditorOpen(false);
      },
    );
  }, [controller]);
  const writeProfile = useCallback(
    (patch: BrainProfilePatch, confirm?: () => Promise<boolean>) => controller.save(patch, confirm),
    [controller],
  );

  // Preview the VRAM budget for the draft, independent of saving it - this is
  // what answers "what happens if I keep this" while a control is still being
  // scrubbed, and it runs on a read-only brain too. Debounced for the same
  // reason the controller debounces autosave: a held stepper should not put one request
  // per press on the wire.
  const budgetRequestRef = useRef(0);
  useEffect(() => {
    if (!active || loading) {
      return;
    }
    const requestId = ++budgetRequestRef.current;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await client.previewBudget(modelId, draftToOverrides(draft));
          if (cancelled || requestId !== budgetRequestRef.current) {
            return;
          }
          setBudgetResult({
            modelId,
            draft,
            budget: result.budget,
            maxContext: result.maxContextThatFits,
            error: null,
          });
        } catch (err) {
          if (cancelled || requestId !== budgetRequestRef.current) return;
          setBudgetResult({
            modelId,
            draft,
            budget: null,
            maxContext: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    }, BUDGET_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [active, client, modelId, draft, loading]);

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

  const handleComponentToggle = useCallback(
    (id: string, value: boolean) => controller.toggleComponent(id, value),
    [controller],
  );
  const bundleOptions = (
    <ProfileBundleOptions
      components={components}
      enabledComponents={enabledComponents}
      canWrite={canWrite}
      onChange={handleComponentToggle}
    />
  );

  const handleChange = useCallback(
    (key: string, value: DraftValue) => controller.edit({ [key]: value }),
    [controller],
  );

  const handleFitContext = useCallback(() => {
    if (maxContext) {
      controller.edit({ contextSize: maxContext });
    }
  }, [controller, maxContext]);

  const selectedHostingProfileId =
    typeof draft.hostingProfileId === "string"
      ? ((draft as Record<string, string>).hostingProfileId ?? null)
      : null;
  const selectedHostingProfile = hostingProfiles.find(
    (profile) => profile.id === selectedHostingProfileId,
  );
  const familyDefaultProfile = hostingProfiles.find(
    (profile) => profile.id === familyHostingProfileId,
  );
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
    void (async () => {
      const result = await writeProfile({
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
      // Saving a profile returns to the library it belongs to. A newly created
      // one comes back already selected on this model, so the library shows it
      // as Selected instead of making the user reopen Manage to find it.
      if (result) setProfileEditorOpen(false);
    })();
  }, [writeProfile, editingHostingProfile, family, profileName, profilePrompt, profileTemplate]);
  const deleteHostingProfile = useCallback(
    (profile: BrainHostingProfile) => {
      void (async () => {
        const result = await writeProfile({ deleteHostingProfileId: profile.id }, () =>
          confirmDialog({
            title: `Delete ${profile.name}?`,
            message: "Models using this profile will switch to Off.",
            confirmLabel: "Delete",
            destructive: true,
          }),
        );
        if (result) setProfileEditorOpen(false);
      })();
    },
    [writeProfile],
  );
  /** `null` clears the family default, which is the only way back off it. */
  const setFamilyDefault = useCallback(
    (profileId: string | null) => {
      void writeProfile({ familyHostingProfileId: profileId });
    },
    [writeProfile],
  );
  const selectedHostingProfileMode =
    typeof draft.hostingProfileMode === "string"
      ? ((draft as Record<string, string>).hostingProfileMode ?? "inherit")
      : "inherit";
  const selectHostingProfileMode = useCallback(
    (mode: "inherit" | "off" | "custom", profileId: string | null = null) => {
      controller.edit({ hostingProfileMode: mode, hostingProfileId: profileId });
    },
    [controller],
  );
  const closeProfileEditor = useCallback(() => setProfileEditorOpen(false), []);
  const closeProfileDialog = useCallback(() => setProfileDialogOpen(false), []);
  const openProfileDialog = useCallback(() => setProfileDialogOpen(true), []);
  const closeProfileSheet = useCallback(() => {
    setProfileDialogOpen(false);
    setProfileEditorOpen(false);
  }, []);
  const deleteEditingProfile = useCallback(() => {
    if (editingHostingProfile) deleteHostingProfile(editingHostingProfile);
  }, [deleteHostingProfile, editingHostingProfile]);
  const selectInheritedProfile = useCallback(
    () => selectHostingProfileMode("inherit"),
    [selectHostingProfileMode],
  );
  const selectOffProfile = useCallback(
    () => selectHostingProfileMode("off"),
    [selectHostingProfileMode],
  );
  const profileDialogFooter = useMemo(
    () => (
      <View style={styles.profileFooter}>
        {profileEditorOpen ? (
          <>
            {editingHostingProfile ? (
              <Button
                variant="destructive"
                onPress={deleteEditingProfile}
                disabled={saving || saveBlocked}
              >
                Delete
              </Button>
            ) : null}
            <Button variant="secondary" onPress={closeProfileEditor}>
              Cancel
            </Button>
            <Button
              variant="default"
              onPress={saveHostingProfile}
              disabled={saving || saveBlocked || !profileName.trim() || !profileTemplate.trim()}
            >
              Save profile
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onPress={closeProfileDialog}>
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
      styles,
      deleteEditingProfile,
      closeProfileEditor,
      closeProfileDialog,
      editingHostingProfile,
      openNewHostingProfile,
      saving,
      saveBlocked,
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
            back: { onPress: closeProfileEditor, label: "Back to profiles" },
          }
        : HOSTING_PROFILE_SHEET_HEADER,
    [closeProfileEditor, editingHostingProfile, profileEditorOpen],
  );

  return {
    styles,
    isCompact,
    loading,
    saving,
    error,
    externalChange,
    saveBlocked,
    revision,
    reloadProfile,
    canWrite,
    budget,
    calibration,
    currentBudget,
    visibleFields,
    draft,
    handleChange,
    warnings,
    maxContext,
    handleFitContext,
    hasLegacyVisionField,
    bundleOptions,
    selectedHostingProfileMode,
    selectedHostingProfile,
    familyDefaultProfile,
    openProfileDialog,
    blocking,
    profileDialogOpen,
    closeProfileSheet,
    profileDialogHeader,
    profileDialogFooter,
    profileEditorOpen,
    profileName,
    editingHostingProfile,
    setProfileName,
    profilePrompt,
    setProfilePrompt,
    profileTemplate,
    setProfileTemplate,
    familyHostingProfileId,
    selectInheritedProfile,
    selectOffProfile,
    hostingProfiles,
    selectedHostingProfileId,
    selectHostingProfileMode,
    openEditHostingProfile,
    setFamilyDefault,
  };
}

type ProfileEditorViewState = ReturnType<typeof useProfileEditor>;

function ProfileEditorView({ view }: { view: ProfileEditorViewState }) {
  const {
    styles,
    loading,
    saving,
    error,
    externalChange,
    saveBlocked,
    revision,
    reloadProfile,
    canWrite,
    blocking,
  } = view;
  if (loading) {
    return (
      <View style={styles.loading}>
        <ThemedSpinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ProfileSaveNotice
        error={error}
        externalChange={externalChange}
        saveBlocked={saveBlocked}
        unavailable={revision === null}
        saving={saving}
        reload={reloadProfile}
      />
      {!canWrite ? (
        <Alert
          variant="info"
          description="This brain does not allow remote configuration, so these fields are read-only."
        />
      ) : null}

      <ProfileEditorFields view={view} />

      {blocking ? <Alert variant="error" description={blocking.message} /> : null}

      {saving ? <Text style={styles.savingHint}>Saving…</Text> : null}
      <ProfileHostingDialog view={view} />
    </View>
  );
}

function ProfileEditorFields({ view }: { view: ProfileEditorViewState }) {
  const {
    styles,
    isCompact,
    canWrite,
    budget,
    calibration,
    currentBudget,
    visibleFields,
    draft,
    handleChange,
    warnings,
    maxContext,
    handleFitContext,
    hasLegacyVisionField,
    bundleOptions,
    selectedHostingProfileMode,
    selectedHostingProfile,
    familyDefaultProfile,
    openProfileDialog,
  } = view;
  return (
    <View style={isCompact ? styles.gridCompact : styles.grid}>
      <BudgetPanel
        budget={budget}
        calibration={calibration}
        pending={currentBudget === null}
        error={currentBudget?.error ?? null}
      />
      {visibleFields.map((field) => (
        <Fragment key={field.key}>
          <FieldRow
            field={field}
            value={draft[field.key]}
            onChange={handleChange}
            disabled={!canWrite}
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
        <Button variant="secondary" size="sm" onPress={openProfileDialog} disabled={!canWrite}>
          Manage
        </Button>
      </View>
    </View>
  );
}

function ProfileHostingDialog({ view }: { view: ProfileEditorViewState }) {
  const {
    styles,
    saving,
    error,
    saveBlocked,
    selectedHostingProfileMode,
    familyDefaultProfile,
    profileDialogOpen,
    closeProfileSheet,
    profileDialogHeader,
    profileDialogFooter,
    profileEditorOpen,
    profileName,
    editingHostingProfile,
    setProfileName,
    profilePrompt,
    setProfilePrompt,
    profileTemplate,
    setProfileTemplate,
    familyHostingProfileId,
    selectInheritedProfile,
    selectOffProfile,
    hostingProfiles,
    selectedHostingProfileId,
    selectHostingProfileMode,
    openEditHostingProfile,
    setFamilyDefault,
  } = view;
  return (
    <AdaptiveModalSheet
      visible={profileDialogOpen}
      onClose={closeProfileSheet}
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
          <PressHighlight
            style={[
              styles.profileChoice,
              selectedHostingProfileMode === "inherit" && styles.profileChoiceSelected,
              !familyHostingProfileId && styles.profileChoiceDisabled,
            ]}
            disabled={!familyHostingProfileId}
            onPress={selectInheritedProfile}
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
          </PressHighlight>
          <PressHighlight
            style={[
              styles.profileChoice,
              selectedHostingProfileMode === "off" && styles.profileChoiceSelected,
            ]}
            onPress={selectOffProfile}
          >
            <View style={styles.profileChoiceCopy}>
              <Text style={styles.profileChoiceTitle}>Off</Text>
              <Text style={styles.profileChoiceHint}>Use the template embedded in this model</Text>
            </View>
            {selectedHostingProfileMode === "off" ? (
              <Text style={styles.profileChoiceStatus}>Selected</Text>
            ) : null}
          </PressHighlight>
          <Text style={styles.profileSectionLabel}>Custom profiles</Text>
          {hostingProfiles.length === 0 ? (
            <Text style={styles.profileEmpty}>No custom profiles for this model family yet.</Text>
          ) : (
            hostingProfiles.map((profile) => (
              <HostingProfileRow
                key={profile.id}
                profile={profile}
                selected={
                  profile.id === selectedHostingProfileId && selectedHostingProfileMode === "custom"
                }
                isDefault={profile.id === familyHostingProfileId}
                disabled={saving || saveBlocked}
                onSelect={selectHostingProfileMode}
                onEdit={openEditHostingProfile}
                onDefault={setFamilyDefault}
              />
            ))
          )}
        </View>
      )}
    </AdaptiveModalSheet>
  );
}
