import { useStyles } from "./styles";

import { PressHighlight } from "@/components/ui/press-highlight";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, View, type StyleProp, type TextStyle } from "react-native";
import { withBrainTheme } from "../theme";
import type { BrainJob } from "../contracts/models";
import type {
  BrainEvals,
  RankedRow,
  VarianceRow,
  RunTask,
  RunProfile,
  RunSuite,
  LatestRun,
} from "../contracts/benchmark";
import { Medal, X } from "../ui/icons";

import { Button } from "@/components/ui/button";
import { BrainLoadingSpinner } from "../theme";
import { useWebScrollViewScrollbar } from "../ui/scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import type { BrainScreenTheme as Theme } from "../theme";
import { useBrainLayoutStore } from "../layout-store";
import { BrainSplitter } from "../ui/splitter";
import { timeSeverity } from "./time-severity";
import {
  ONE_LINE,
  RUNS_HIDE_BELOW,
  GRADE_HIDE_BELOW,
  SPREAD_HIDE_BELOW,
  COUNT_HIDE_BELOW,
  RAN_HIDE_BELOW,
  rankWidth,
} from "./geometry";
export const ThemedSpinner = BrainLoadingSpinner;
const ThemedMedal = withBrainTheme(Medal);
const ThemedX = withBrainTheme(X);

const dangerIcon = (theme: Theme) => ({
  color: theme.colors.palette.red[500],
  size: theme.iconSize.sm,
});
const cancelIcon = <ThemedX uniProps={dangerIcon} />;

// Shared by the pinned header and the rows below it. The grade column is sized
// for "Unusable" plus its medal on one line: 56px forced every grade past
// "weak" to wrap, which is what broke the row rhythm. Everything else is held
// to what its widest value needs, so the slack lands on `name`, the only column
// whose content actually runs long.
//
// The fixed columns carry `flexShrink: 0` so the header (outside the row scroll
// region) and the rows (inside it) never drift apart column by column - the same
// lesson the Models table already learned. Only `name` gives ground.

type MedalTier = "gold" | "silver" | "bronze" | "none";

const GRADE_TIERS: Record<string, { label: string; tier: MedalTier }> = {
  excellent: { label: "Excellent", tier: "gold" },
  strong: { label: "Strong", tier: "silver" },
  usable: { label: "Usable", tier: "bronze" },
  weak: { label: "Weak", tier: "none" },
  unusable: { label: "Unusable", tier: "none" },
};

// Metal is a literal, not a theme role, so these are fixed hexes rather than
// tokens - but each scheme needs its own step: the dark golds wash out to
// near-white on a light surface, and the light ones sink into a dark one. Every
// value here clears 4.5:1 against its scheme's `surface1`.
//
// Silver is pushed away from neutral on both schemes because its neighbour is
// the grey no-medal tier. A literal silver sits right on `foregroundMuted` and
// the second and fourth rows stop being distinguishable at a glance.
const MEDAL_COLORS = {
  dark: { gold: "#e8b73a", silver: "#dfe6f2", bronze: "#cf8b4c" },
  light: { gold: "#a97400", silver: "#5f6b7d", bronze: "#9a5a22" },
} as const;

function medalMapping(tier: Exclude<MedalTier, "none">) {
  return (theme: Theme) => ({
    size: theme.iconSize.md,
    color: MEDAL_COLORS[theme.colorScheme][tier],
  });
}

// Module scope on purpose: `uniProps` is read every render, and a mapping built
// inline would be a new identity each time.
const MEDAL_ICON_MAPPING: Record<MedalTier, (theme: Theme) => { size: number; color: string }> = {
  gold: medalMapping("gold"),
  silver: medalMapping("silver"),
  bronze: medalMapping("bronze"),
  none: (theme) => ({ size: theme.iconSize.md, color: theme.colors.foregroundMuted }),
};

// The grade label's tier color has to be resolved the same way as the medal
// icon above: through a `uniProps` mapping, not a `theme.colorScheme`-keyed
// lookup baked into the themed stylesheet below. On web, `StyleSheet.create`'s
// factory runs against a CSS-variable-reference proxy rather than the real
// theme object, so `MEDAL_COLORS[theme.colorScheme]` there resolves to
// `undefined` and throws on the following property read (docs/unistyles.md).
// `uniProps` mappings run with the real, React-resolved theme, so the same
// `MEDAL_COLORS[theme.colorScheme][tier]` lookup that works in `medalMapping`
// above is safe here too - but `uniProps` can only pass plain component PROPS,
// not a `style` array (Text has no such prop in its `withUnistyles` mapping
// type), so the color rides in as a `color` prop and `GradeLabelText` below
// turns it into style itself, the same way `ThemedSwitchTrack` takes plain
// color props rather than a style array.
function medalLabelMapping(tier: MedalTier) {
  return (theme: Theme) =>
    tier === "none" ? {} : { color: MEDAL_COLORS[theme.colorScheme][tier] };
}

const MEDAL_LABEL_MAPPING: Record<MedalTier, (theme: Theme) => { color?: string }> = {
  gold: medalLabelMapping("gold"),
  silver: medalLabelMapping("silver"),
  bronze: medalLabelMapping("bronze"),
  none: medalLabelMapping("none"),
};

function GradeLabelText({
  color,
  numberOfLines,
  children,
}: {
  color?: string;
  numberOfLines?: number;
  children: ReactNode;
}) {
  const styles = useStyles();
  const style = useMemo(() => [styles.gradeLabel, color ? { color } : null], [styles, color]);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

const ThemedGradeLabel = withBrainTheme(GradeLabelText);

export function readRankings(evals: BrainEvals | null): RankedRow[] {
  return [...(evals?.rankings ?? [])].sort((a, b) => a.rank - b.rank || b.overall - a.overall);
}

export function readVariance(evals: BrainEvals | null): VarianceRow[] {
  return evals?.variance ?? [];
}

/** One graded task inside a stored run. */

function taskSecondsByKey(run: LatestRun): ReadonlyMap<string, number | null> {
  return new Map(run.tasks.map((task) => [task.key, task.seconds]));
}

/** The settings a run was measured under - a score means nothing without them. */

/**
 * How the run was set up, as opposed to how it was configured (schema 2+).
 *
 * The gap between the two is where bad scores come from: the brain will cut a
 * profile's context down to whatever fits the GPU and run anyway, so a record
 * without this block can say a model scored 41% at 128k context when it was
 * really measured at 16k.
 */

/** Which suite graded the run (schema 2+). Different tasks, different meaning. */

/** One stored benchmark run (`results.RunRecord`), as this tab reads it. */

/**
 * `evals.latest` is the most recent run per model+config, not every run: an
 * earlier run of the same setup is superseded, so showing it would invite a
 * comparison between a measurement and the measurement that replaced it.
 */
export function readLatestRuns(evals: BrainEvals | null): LatestRun[] {
  return evals?.latest ?? [];
}

/**
 * Whether a stored run belongs to a leaderboard row.
 *
 * The ranking groups by `id || displayName`, so a row's `id` is the display name
 * whenever every run behind it lacked one. Comparing ids only when BOTH sides
 * really have one keeps that fallback from matching a run's id against another
 * model's name.
 */
export function runBelongsTo(
  run: { modelId: string | null; modelName: string },
  row: RankedRow,
): boolean {
  if (run.modelId && row.id !== row.name) {
    return run.modelId === row.id;
  }
  return run.modelName === row.name;
}

function formatPercent(fraction: number | null): string {
  return fraction === null ? "-" : `${(fraction * 100).toFixed(1)}%`;
}

function formatSpread(std: number | null): string {
  return std === null ? "-" : `± ${(std * 100).toFixed(1)}`;
}

function formatSeconds(seconds: number | null): string | null {
  if (seconds === null) {
    return null;
  }
  return seconds >= 90 ? `${(seconds / 60).toFixed(1)} min` : `${seconds.toFixed(1)}s`;
}

function formatGiB(bytes: number | null): string | null {
  return bytes === null ? null : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatRanAt(iso: string | null): string {
  if (!iso) {
    return "Unknown date";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** The same instant without the year, for a table cell that has 92px to say it. */
function formatRanAtShort(iso: string | null): string {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * The context line: the native window, plus the RoPE factor only when the run
 * stretched past it - a score at an extrapolated context is not comparable to
 * one at the native window, so the stretch has to be visible on the row.
 */
function contextLine(profile: RunProfile): string | null {
  if (profile.contextSize === null) return null;
  const rope =
    profile.contextMultiplier !== null && profile.contextMultiplier > 1
      ? ` (x${profile.contextMultiplier})`
      : "";
  return `${profile.contextSize.toLocaleString()} ctx${rope}`;
}

/**
 * -1 is llama.cpp's "spend as much as you like", which is the failure mode the
 * sweep exists to cap - it is worth naming rather than printing raw.
 */
function reasoningLine(profile: RunProfile): string | null {
  if (profile.reasoningBudget === null) return null;
  return profile.reasoningBudget < 0
    ? "unlimited reasoning"
    : `${profile.reasoningBudget.toLocaleString()} reasoning budget`;
}

/**
 * The sampler is one line, and only the values the user moved: an untouched
 * profile stores llama.cpp's defaults verbatim, and printing six of them on
 * every row would bury the settings that actually explain a score.
 */
function samplerLine(profile: RunProfile): string | null {
  const sampler: Array<[string, number | null, number]> = [
    ["temp", profile.temperature, 0.8],
    ["topP", profile.topP, 0.95],
    ["topK", profile.topK, 40],
    ["minP", profile.minP, 0.05],
    ["pres", profile.presencePenalty, 0],
    ["rep", profile.repeatPenalty, 1],
  ];
  const deviated = sampler
    .filter(([, value, def]) => value !== null && value !== def)
    .map(([name, value]) => `${name} ${value}`);
  return deviated.length > 0 ? deviated.join(", ") : null;
}

/** Tri-state: true/false as chosen, null reads as "the template decides". */
function preserveReasoningLine(profile: RunProfile): string | null {
  if (profile.preserveReasoning === true) return "reasoning preserved";
  if (profile.preserveReasoning === false) return "reasoning trimmed";
  return null;
}

/** Serving-size lines, each only when it says something non-default. */
function servingLines(profile: RunProfile): string[] {
  const parts: string[] = [];
  if (profile.parallelSlots !== null && profile.parallelSlots > 1) {
    parts.push(`${profile.parallelSlots} slots`);
  }
  if (profile.cachedChats !== null && profile.cachedChats > 0) {
    parts.push(`${profile.cachedChats} cached`);
  }
  return parts;
}

/**
 * The settings that produced a run, spelled out. `configKey` is the grouping
 * identity (`ctx8192_kvf16-f16_rb2048_novision`) and reads as machine output, so
 * it is only the fallback for a run stored without its profile.
 */
function formatConfig(run: LatestRun): string {
  const profile = run.profile;
  if (!profile) {
    return run.configKey ?? "Unknown configuration";
  }
  const parts: string[] = [];
  const context = contextLine(profile);
  if (context !== null) parts.push(context);
  if (profile.cacheTypeK && profile.cacheTypeV) {
    parts.push(`KV ${profile.cacheTypeK}/${profile.cacheTypeV}`);
  }
  const reasoning = reasoningLine(profile);
  if (reasoning !== null) parts.push(reasoning);
  const preserve = preserveReasoningLine(profile);
  if (preserve !== null) parts.push(preserve);
  if (profile.flashAttention !== null) {
    parts.push(profile.flashAttention ? "flash attention" : "no flash attention");
  }
  parts.push(...servingLines(profile));
  const sampler = samplerLine(profile);
  if (sampler !== null) parts.push(sampler);
  if (profile.batchSize !== null) {
    parts.push(`batch ${profile.batchSize.toLocaleString()}`);
  }
  if (profile.ubatchSize !== null) {
    parts.push(`ubatch ${profile.ubatchSize.toLocaleString()}`);
  }
  if (profile.vision) {
    parts.push("vision");
  }
  if (profile.hostingProfileId) {
    parts.push("hosting profile");
  }
  if (parts.length > 0) return parts.join(" · ");
  return run.configKey ?? "Unknown configuration";
}

/** Which suite graded the run. Different tasks are a different measurement. */
function formatSuite(suite: RunSuite | null): string | null {
  if (!suite) {
    return null;
  }
  const parts: string[] = [suite.mined ? "Tasks mined from a repo" : "Standard suite"];
  if (suite.only) {
    parts.push(`only ${suite.only.join(", ")}`);
  }
  if (suite.concurrency !== null) {
    parts.push(`${suite.concurrency} concurrent`);
  }
  if (suite.depths) {
    parts.push(`depths ${suite.depths.map((depth) => depth.toLocaleString()).join("/")}`);
  }
  if (suite.execute === false) {
    parts.push("code syntax-checked, not run");
  }
  return parts.join(" · ");
}

/** A setup problem worth naming, and whether it is a fault or just context. */
interface SetupIssue {
  key: string;
  tone: "warn" | "info";
  text: string;
}

/**
 * The known ways a local model underperforms for reasons that are not the model.
 *
 * This list is the reason the settings are recorded at all. Each check reads
 * values the run actually stored - none of it is inferred from the score - and
 * each names one thing that makes a number misleading: measured at a context it
 * never asked for, on a VRAM budget nobody verified, with layers left on the
 * CPU, or against a reasoning budget it can spend entirely on thinking. A run
 * from before setup capture (schema 1) stores none of it, so every check simply
 * returns null and the card shows no diagnosis rather than a false clean bill.
 *
 * Add a new failure mode as another entry here, not as a branch inside one.
 */
type SetupCheck = (run: LatestRun) => SetupIssue | null;

const SETUP_CHECKS: SetupCheck[] = [
  function contextCutToFit(run) {
    const setup = run.setup;
    if (!setup?.adjusted) {
      return null;
    }
    const requested = setup.requestedContextSize;
    const effective = run.profile?.contextSize ?? null;
    return {
      key: "adjusted",
      tone: "warn",
      text:
        setup.adjustReason ??
        (requested !== null && effective !== null
          ? `Context was cut from ${requested.toLocaleString()} to ${effective.toLocaleString()} to fit VRAM.`
          : "The profile was cut down to fit VRAM before this run."),
    };
  },

  function vramBudgetEstimated(run) {
    if (run.setup?.kvSource !== "theoretical") {
      return null;
    }
    // The formula is a bound, not a measurement, and it overestimates by up to
    // 4x on architectures that keep a full cache on only some layers - so this
    // usually means the run got LESS context than the card could have held.
    return {
      key: "kv-theoretical",
      tone: "warn",
      text: "VRAM was budgeted from the formula, not measured. Calibrate this model for a truer fit.",
    };
  },

  function kvCostInherited(run) {
    if (!run.setup?.kvInherited) {
      return null;
    }
    return {
      key: "kv-inherited",
      tone: "info",
      text: "KV cost was inherited from a model with the same attention geometry, not measured on this file.",
    };
  },

  function partialGpuOffload(run) {
    const gpuLayers = run.profile?.gpuLayers ?? null;
    const blockCount = run.blockCount;
    if (gpuLayers === null || blockCount === null || gpuLayers >= blockCount) {
      return null;
    }
    return {
      key: "partial-offload",
      tone: "warn",
      text: `Only ${gpuLayers} of ${blockCount} layers ran on the GPU. The rest ran on the CPU, which dominates every timing below.`,
    };
  },

  function contextAboveNative(run) {
    const contextSize = run.profile?.contextSize ?? null;
    const native = run.nativeContextLength;
    if (contextSize === null || native === null || contextSize <= native) {
      return null;
    }
    return {
      key: "over-native-context",
      tone: "warn",
      text: `Context was set to ${contextSize.toLocaleString()}, above the model's native ${native.toLocaleString()}.`,
    };
  },

  function contextSplitAcrossSlots(run) {
    const slots = run.profile?.parallelSlots ?? null;
    const contextSize = run.profile?.contextSize ?? null;
    if (slots === null || slots <= 1 || contextSize === null) {
      return null;
    }
    // llama-server divides -c between slots, so the window a single request
    // sees is a fraction of the configured context.
    return {
      key: "slot-split",
      tone: "info",
      text: `Context was split across ${slots} slots, so each request saw about ${Math.floor(
        contextSize / slots,
      ).toLocaleString()} tokens.`,
    };
  },

  function unboundedReasoningBudget(run) {
    const budget = run.profile?.reasoningBudget ?? null;
    if (budget === null || budget >= 0) {
      return null;
    }
    return {
      key: "unbounded-reasoning",
      tone: "warn",
      text: "The reasoning budget was unlimited. A thinking model can spend the whole allowance reasoning and return no content, which scores as a failure.",
    };
  },

  function contextExtendedPastNative(run) {
    const multiplier = run.profile?.contextMultiplier ?? null;
    if (multiplier === null || multiplier <= 1) {
      return null;
    }
    return {
      key: "rope-extended",
      tone: "warn",
      text: `Context was stretched past the native window with YaRN (x${multiplier} RoPE scaling). A score at an extrapolated context is not directly comparable to one at the model's native window.`,
    };
  },

  function cachedChatsUnmeasured(run) {
    const chats = run.profile?.cachedChats ?? null;
    if (chats === null || chats <= 0) {
      return null;
    }
    if (run.setup?.kvSource === "measured") {
      return null;
    }
    return {
      key: "cached-chats-unmeasured",
      tone: "info",
      text: `${chats} chat(s) were meant to park in system RAM, but without a measured KV cost llama.cpp's own cache limit applied instead.`,
    };
  },

  function extraArgsInEffect(run) {
    const extraArgs = run.profile?.extraArgs ?? [];
    if (extraArgs.length === 0) {
      return null;
    }
    return {
      key: "extra-args",
      tone: "info",
      text: `Extra llama-server arguments were in effect: ${extraArgs.join(" ")}`,
    };
  },
];

function describeSetupIssues(run: LatestRun): SetupIssue[] {
  return SETUP_CHECKS.map((check) => check(run)).filter(
    (issue): issue is SetupIssue => issue !== null,
  );
}

/** Everything about a run that is not a score: where and how it was measured. */
function formatRunMeta(run: LatestRun): string | null {
  const parts: string[] = [];
  const duration = formatSeconds(run.seconds);
  if (duration) {
    parts.push(duration);
  }
  const vram = formatGiB(run.vramBytes);
  if (vram) {
    parts.push(`${vram} VRAM`);
  }
  const load = formatSeconds(run.loadSeconds);
  if (load) {
    parts.push(`${load} to load`);
  }
  if (run.runtime) {
    parts.push(run.runtime);
  }
  if (run.gpuName) {
    parts.push(run.gpuName);
  }
  if (run.executedCode !== null) {
    parts.push(run.executedCode ? "ran code" : "no code executed");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The medal and its label, unsized - both the table cell and the badge use it. */
function GradeContent({ grade, numberOfLines }: { grade: string; numberOfLines?: number }) {
  // An unknown grade still renders rather than blanking: the bench can add a
  // tier before this table knows about it, and a grey medal is the honest
  // rendering of "ranked, but not on a rung we recognise".
  const known = GRADE_TIERS[grade.toLowerCase()];
  const label = known?.label ?? grade;
  const tier = known?.tier ?? "none";
  return (
    <>
      <ThemedMedal uniProps={MEDAL_ICON_MAPPING[tier]} />
      <ThemedGradeLabel uniProps={MEDAL_LABEL_MAPPING[tier]} numberOfLines={numberOfLines}>
        {label}
      </ThemedGradeLabel>
    </>
  );
}

function GradeCell({ grade }: { grade: string | null }) {
  const styles = useStyles();
  if (!grade) {
    return <Text style={styles.cellGradeEmpty}>-</Text>;
  }
  return (
    <View style={styles.cellGrade}>
      <GradeContent grade={grade} numberOfLines={1} />
    </View>
  );
}

function GradeBadge({ grade }: { grade: string | null }) {
  const styles = useStyles();
  if (!grade) {
    return null;
  }
  return (
    <View style={styles.gradeBadge}>
      <GradeContent grade={grade} numberOfLines={1} />
    </View>
  );
}

interface VisibleColumns {
  runs: boolean;
  grade: boolean;
}

function LeaderboardRow({
  row,
  selected,
  onSelect,
  columns,
  rankStyle,
}: {
  row: RankedRow;
  selected: boolean;
  onSelect: (id: string) => void;
  columns: VisibleColumns;
  /** Built once by the table so every row and the header share one width. */
  rankStyle: StyleProp<TextStyle>;
}) {
  const styles = useStyles();
  const handlePress = useCallback(() => onSelect(row.id), [onSelect, row.id]);
  const rowStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      selected && styles.rowSelected,
    ],
    [styles, selected],
  );
  return (
    <PressHighlight
      style={rowStyle}
      onPress={handlePress}
      testID={`brain-leaderboard-row-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={row.name}
    >
      <Text style={rankStyle}>{row.rank}</Text>
      <Text style={styles.cellName} numberOfLines={ONE_LINE}>
        {row.name}
      </Text>
      <Text style={styles.cellScore}>{formatPercent(row.overall)}</Text>
      {columns.runs ? <Text style={styles.cellRuns}>{row.runs}</Text> : null}
      {columns.grade ? <GradeCell grade={row.grade} /> : null}
    </PressHighlight>
  );
}

function LeaderboardTable({
  rows,
  selectedId,
  onSelect,
  fill = false,
}: {
  rows: RankedRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Desktop's split sidebar gives both tables equal remaining height. */
  fill?: boolean;
}) {
  const styles = useStyles();
  const tableScrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(tableScrollRef);
  const [tableWidth, setTableWidth] = useState(0);
  const handleLayout = useCallback((event: { nativeEvent: { layout: { width: number } } }) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setTableWidth(width);
  }, []);
  // Unmeasured (first paint) shows every column rather than flashing a narrow
  // layout first.
  const columns: VisibleColumns = useMemo(
    () => ({
      runs: tableWidth === 0 || tableWidth >= RUNS_HIDE_BELOW,
      grade: tableWidth === 0 || tableWidth >= GRADE_HIDE_BELOW,
    }),
    [tableWidth],
  );
  // One width, applied to the header and to every row, so the column cannot
  // drift across the boundary between the pinned header and the scroll region.
  const width = rankWidth(rows.length);
  const headerRankStyle = useMemo(() => [styles.headerRank, { width }], [styles, width]);
  const cellRankStyle = useMemo(() => [styles.cellRank, { width }], [styles, width]);

  return (
    <View
      style={[styles.table, fill && styles.tableFill]}
      testID="brain-leaderboard"
      onLayout={handleLayout}
    >
      {/* Pinned header, outside the scroll region below it. */}
      <View style={styles.headerRow}>
        <Text style={headerRankStyle} numberOfLines={ONE_LINE}>
          #
        </Text>
        <Text style={styles.headerName} numberOfLines={ONE_LINE}>
          Model
        </Text>
        <Text style={styles.headerScore} numberOfLines={ONE_LINE}>
          Score
        </Text>
        {columns.runs ? (
          <Text style={styles.headerRuns} numberOfLines={ONE_LINE}>
            Runs
          </Text>
        ) : null}
        {columns.grade ? (
          <Text style={styles.headerGrade} numberOfLines={ONE_LINE}>
            Grade
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.tableScrollRegion,
          fill ? styles.tableScrollRegionFill : styles.tableScrollRegionCapped,
        ]}
      >
        <ScrollView
          ref={tableScrollRef}
          style={styles.tableScroll}
          onLayout={scrollbar.onLayout}
          onScroll={scrollbar.onScroll}
          onContentSizeChange={scrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={isNative}
        >
          {rows.map((row) => (
            <LeaderboardRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
              columns={columns}
              rankStyle={cellRankStyle}
            />
          ))}
        </ScrollView>
        {scrollbar.overlay}
      </View>
    </View>
  );
}

/** A run paired with the spread of every run that shares its configuration. */
export interface RunListEntry {
  run: LatestRun;
  spread: VarianceRow | null;
}

interface VisibleRunColumns {
  model: boolean;
  ran: boolean;
  count: boolean;
  spread: boolean;
}

function RunListRow({
  entry,
  selected,
  isLatest,
  onSelect,
  columns,
}: {
  entry: RunListEntry;
  selected: boolean;
  /** The newest run of its model, and so the one the right pane always shows. */
  isLatest: boolean;
  onSelect: (run: LatestRun) => void;
  columns: VisibleRunColumns;
}) {
  const styles = useStyles();
  const { run, spread } = entry;
  const handlePress = useCallback(() => onSelect(run), [onSelect, run]);
  const rowStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      selected && styles.rowSelected,
    ],
    [styles, selected],
  );
  return (
    <PressHighlight
      style={rowStyle}
      onPress={handlePress}
      testID={`brain-run-${run.key}`}
      accessibilityRole="button"
      accessibilityLabel={`${run.modelName}, ${formatConfig(run)}`}
    >
      {columns.model ? (
        <Text style={styles.runCellModel} numberOfLines={ONE_LINE}>
          {run.modelName}
        </Text>
      ) : null}
      <View style={styles.runCellConfig}>
        <Text style={styles.runCellConfigText} numberOfLines={ONE_LINE}>
          {formatConfig(run)}
        </Text>
        {/* Named on the row, not just implied by ordering: the right pane always
            shows this run, so it is the one every other row is measured against. */}
        {isLatest ? (
          <Text style={styles.runCellLatest} numberOfLines={ONE_LINE}>
            Latest
          </Text>
        ) : null}
      </View>
      {columns.ran ? (
        <Text style={styles.runCellRan} numberOfLines={ONE_LINE}>
          {formatRanAtShort(run.ranAt)}
        </Text>
      ) : null}
      <Text style={styles.runCellScore} numberOfLines={ONE_LINE}>
        {formatPercent(run.overall)}
      </Text>
      {columns.count ? (
        <Text style={styles.runCellCount} numberOfLines={ONE_LINE}>
          {spread?.count ?? 1}
        </Text>
      ) : null}
      {columns.spread ? (
        <Text style={styles.runCellSpread} numberOfLines={ONE_LINE}>
          {formatSpread(spread?.std ?? null)}
        </Text>
      ) : null}
    </PressHighlight>
  );
}

/** A bench job is a run in progress, so it belongs beside the completed runs. */
function RunningBenchmarkRow({
  job,
  showModel,
  columns,
  onCancel,
}: {
  job: BrainJob;
  showModel: boolean;
  columns: VisibleRunColumns;
  onCancel: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.row} testID="brain-running-bench-row">
      {showModel ? <Text style={styles.runCellModel}>Benchmark</Text> : null}
      <View style={styles.runCellConfig}>
        <ThemedSpinner size={10} />
        <Text style={styles.runCellConfigText} numberOfLines={ONE_LINE}>
          {job.message ? `Running: ${job.message}` : "Running..."}
        </Text>
      </View>
      {columns.ran ? <Text style={styles.runCellRan}>Now</Text> : null}
      <View style={styles.runCellAction}>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={cancelIcon}
          onPress={onCancel}
          accessibilityLabel="Cancel benchmark"
          testID="brain-bench-cancel"
        />
      </View>
      {columns.count ? <Text style={styles.runCellCount}>—</Text> : null}
      {columns.spread ? <Text style={styles.runCellSpread}>—</Text> : null}
    </View>
  );
}

/**
 * Every run, or one model's runs, with its configuration spelled out.
 *
 * `Runs` and `Spread` are the old variance table folded in. They belong on the
 * run they describe: a spread is the answer to "was this measurement typical",
 * and that question is only ever asked about a specific row.
 */
function RunsTable({
  entries,
  showModel,
  selectedKey,
  latestKey,
  runningJob,
  onCancelRunning,
  onSelect,
  fill = false,
}: {
  entries: RunListEntry[];
  showModel: boolean;
  selectedKey: string | null;
  /** The run the detail pane pins, so the list can mark it. */
  latestKey: string | null;
  runningJob: BrainJob | null;
  onCancelRunning: () => void;
  onSelect: (run: LatestRun) => void;
  /** Desktop's split sidebar gives both tables equal remaining height. */
  fill?: boolean;
}) {
  const styles = useStyles();
  const tableScrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(tableScrollRef);
  const [tableWidth, setTableWidth] = useState(0);
  const handleLayout = useCallback((event: { nativeEvent: { layout: { width: number } } }) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setTableWidth(width);
  }, []);
  const columns: VisibleRunColumns = useMemo(
    () => ({
      model: showModel,
      ran: tableWidth === 0 || tableWidth >= RAN_HIDE_BELOW,
      count: tableWidth === 0 || tableWidth >= COUNT_HIDE_BELOW,
      spread: tableWidth === 0 || tableWidth >= SPREAD_HIDE_BELOW,
    }),
    [showModel, tableWidth],
  );

  return (
    <View
      style={[styles.table, fill && styles.tableFill]}
      testID="brain-runs"
      onLayout={handleLayout}
    >
      <View style={styles.headerRow}>
        {columns.model ? (
          <Text style={styles.runHeaderModel} numberOfLines={ONE_LINE}>
            Model
          </Text>
        ) : null}
        <Text style={styles.runHeaderConfig} numberOfLines={ONE_LINE}>
          Configuration
        </Text>
        {columns.ran ? (
          <Text style={styles.runHeaderRan} numberOfLines={ONE_LINE}>
            Ran
          </Text>
        ) : null}
        <Text style={styles.runHeaderScore} numberOfLines={ONE_LINE}>
          Score
        </Text>
        {columns.count ? (
          <Text style={styles.runHeaderCount} numberOfLines={ONE_LINE}>
            Runs
          </Text>
        ) : null}
        {columns.spread ? (
          <Text style={styles.runHeaderSpread} numberOfLines={ONE_LINE}>
            Spread
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.tableScrollRegion,
          fill ? styles.tableScrollRegionFill : styles.tableScrollRegionCapped,
        ]}
      >
        <ScrollView
          ref={tableScrollRef}
          style={styles.tableScroll}
          onLayout={scrollbar.onLayout}
          onScroll={scrollbar.onScroll}
          onContentSizeChange={scrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={isNative}
        >
          {runningJob ? (
            <RunningBenchmarkRow
              job={runningJob}
              showModel={showModel}
              columns={columns}
              onCancel={onCancelRunning}
            />
          ) : null}
          {entries.map((entry) => (
            <RunListRow
              key={entry.run.key}
              entry={entry}
              selected={entry.run.key === selectedKey}
              isLatest={entry.run.key === latestKey}
              onSelect={onSelect}
              columns={columns}
            />
          ))}
        </ScrollView>
        {scrollbar.overlay}
      </View>
    </View>
  );
}

/**
 * One graded task's row inside a run: what it scored, and what it cost.
 *
 * `narrow` drops Weight only. Time stays visible in comparisons because paired
 * task durations reveal performance outliers that a score alone cannot.
 */
function TaskRow({
  task,
  narrow,
  comparedSeconds,
}: {
  task: RunTask;
  narrow: boolean;
  comparedSeconds: number | null;
}) {
  const styles = useStyles();
  // A task that errored still carries whatever summary the grader wrote, but the
  // error is the thing that explains the score, so it takes the line.
  const note = task.error ?? task.summary;
  const noteStyle = task.error ? styles.taskError : styles.taskSummary;
  // The colour scale calls attention to weak scores and exceptional scores,
  // leaving the broad 50–95% middle band neutral.
  let scoreTone;
  if (task.score !== null && task.score < 0.25) {
    scoreTone = styles.taskScoreCritical;
  } else if (task.score !== null && task.score < 0.5) {
    scoreTone = styles.taskScoreWarning;
  } else if (task.score !== null && task.score > 0.95) {
    scoreTone = styles.taskScoreExcellent;
  }
  const durationTone = timeSeverity(task.seconds, comparedSeconds);
  return (
    <View style={[styles.taskRow, narrow && styles.taskRowCompared]}>
      <View style={styles.taskName}>
        <Text style={styles.taskCategory} numberOfLines={1}>
          {task.category}
        </Text>
        {note ? (
          <Text style={noteStyle} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
      </View>
      {narrow ? null : (
        <Text style={styles.taskWeight}>{task.weight === null ? "-" : `×${task.weight}`}</Text>
      )}
      <Text style={[styles.taskScore, scoreTone]}>{formatPercent(task.score)}</Text>
      <Text
        style={[
          styles.taskSeconds,
          durationTone === "success" && styles.taskSecondsExcellent,
          durationTone === "warning" && styles.taskSecondsWarning,
          durationTone === "critical" && styles.taskSecondsCritical,
        ]}
      >
        {formatSeconds(task.seconds) ?? "-"}
      </Text>
    </View>
  );
}

/** How a compared run scored against the latest one, in points of overall. */
function formatDelta(delta: number): string {
  const points = delta * 100;
  const rounded = Math.abs(points) < 0.05 ? 0 : points;
  if (rounded === 0) {
    return "Same score as the latest run";
  }
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} points vs the latest run`;
}

/**
 * One configuration's most recent run: the settings, what it cost, and every
 * task it was graded on. This is the whole reason a row is selectable - the
 * leaderboard can only ever say how good a model is, not where it lost points.
 *
 * Two of these sit side by side while comparing, so every section is in the same
 * order in both and a difference is a horizontal glance rather than a hunt.
 */
function RunCard({
  run,
  spread,
  label,
  comparing,
  comparisonTaskSeconds,
}: {
  run: LatestRun;
  spread: VarianceRow | null;
  label: string;
  comparing: boolean;
  comparisonTaskSeconds: ReadonlyMap<string, number | null> | null;
}) {
  const styles = useStyles();
  const meta = formatRunMeta(run);
  const suite = formatSuite(run.suite);
  const issues = useMemo(() => describeSetupIssues(run), [run]);
  return (
    <View style={comparing ? styles.runCardCompared : styles.runCard}>
      <Text style={styles.runLabel}>{label}</Text>
      <View style={styles.runHeader}>
        <Text style={styles.runScore}>{formatPercent(run.overall)}</Text>
        <GradeBadge grade={run.grade} />
        <Text style={styles.runDate} numberOfLines={1}>
          {formatRanAt(run.ranAt)}
        </Text>
      </View>
      <Text style={styles.runConfig}>{formatConfig(run)}</Text>
      {meta ? <Text style={styles.runMeta}>{meta}</Text> : null}
      {suite ? <Text style={styles.runMeta}>{suite}</Text> : null}
      {/* Why a score may not be the model's fault. Above the task table on
          purpose: a partial GPU offload explains every timing below it. */}
      {issues.length > 0 ? (
        <View style={styles.issues} testID="brain-run-setup-issues">
          {issues.map((issue) => (
            <Text
              key={issue.key}
              style={issue.tone === "warn" ? styles.issueWarn : styles.issueInfo}
            >
              {issue.text}
            </Text>
          ))}
        </View>
      ) : null}
      {run.setup && run.setup.args.length > 0 ? (
        // The argv is the only true statement of what ran, and it is what makes
        // a run reproducible by hand - so it is selectable, not just readable.
        <Text style={styles.runArgs} selectable>
          {run.setup.args.join(" ")}
        </Text>
      ) : null}
      {/* A single run against the average of every run of the same setup: the
          one comparison that says whether this measurement was typical. */}
      {spread && spread.count > 1 ? (
        <Text style={styles.runMeta}>
          {`${spread.count} runs of this configuration · mean ${formatPercent(
            spread.mean,
          )} · ${formatSpread(spread.std)}`}
        </Text>
      ) : null}
      {run.tasks.length > 0 ? (
        <View style={styles.taskTable}>
          <View style={styles.taskHeaderRow}>
            <Text style={styles.taskHeaderName}>Task</Text>
            {comparing ? null : <Text style={styles.taskHeaderWeight}>Weight</Text>}
            <Text style={styles.taskHeaderScore}>Score</Text>
            <Text style={styles.taskHeaderSeconds}>Time</Text>
          </View>
          {run.tasks.map((task) => (
            <TaskRow
              key={task.key}
              task={task}
              narrow={comparing}
              comparedSeconds={comparisonTaskSeconds?.get(task.key) ?? null}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.runMeta}>This run stored no per-task results.</Text>
      )}
    </View>
  );
}

/**
 * The leaderboard and the selected model's results, side by side.
 *
 * Compact has no room for both, so selecting a row replaces the list, the way
 * every other list-and-detail surface here does.
 */
/**
 * Leaderboard over run list on the left, the run detail on the right.
 *
 * Compact has no room for two columns, so selecting a model replaces the
 * leaderboard with the run list and its detail - the way every other
 * list-and-detail surface here does. The run list is what a compact reader needs
 * next, so it stays visible above the cards rather than being another level down.
 */
export function LeaderboardPanes({
  runCount,
  canRun,
  starting,
  running,
  runningJob,
  onCancelRunning,
  onRun,
  rows,
  runEntries,
  selected,
  latest,
  compared,
  selectedRunKey,
  spreadFor,
  onSelectModel,
  onSelectRun,
  onBack,
}: {
  runCount: number;
  canRun: boolean;
  starting: boolean;
  running: boolean;
  runningJob: BrainJob | null;
  onCancelRunning: () => void;
  onRun: () => void;
  rows: RankedRow[];
  runEntries: RunListEntry[];
  selected: RankedRow | null;
  latest: RunListEntry | null;
  compared: RunListEntry | null;
  selectedRunKey: string | null;
  spreadFor: (run: LatestRun) => VarianceRow | null;
  onSelectModel: (id: string) => void;
  onSelectRun: (run: LatestRun) => void;
  onBack: () => void;
}) {
  const styles = useStyles();
  const isCompact = useIsCompactFormFactor();
  const benchmarksSplitRatio = useBrainLayoutStore((state) => state.benchmarksSplitRatio);
  const setBenchmarksSplitRatio = useBrainLayoutStore((state) => state.setBenchmarksSplitRatio);
  const benchmarkTablesSplitRatio = useBrainLayoutStore((state) => state.benchmarkTablesSplitRatio);
  const setBenchmarkTablesSplitRatio = useBrainLayoutStore(
    (state) => state.setBenchmarkTablesSplitRatio,
  );
  const leaderboard = (
    <LeaderboardTable
      rows={rows}
      selectedId={selected?.id ?? null}
      onSelect={onSelectModel}
      fill={!isCompact}
    />
  );
  const runs = (
    <RunsTable
      entries={runEntries}
      // Redundant once the list is already one model's runs.
      showModel={selected === null}
      selectedKey={selectedRunKey}
      // Only meaningful once the list is one model's: across every model the
      // newest row is just the newest benchmark anybody ran, not a reference.
      latestKey={selected ? (latest?.run.key ?? null) : null}
      runningJob={runningJob}
      onCancelRunning={onCancelRunning}
      onSelect={onSelectRun}
      fill={!isCompact}
    />
  );
  const detail = selected ? (
    <ModelDetail
      row={selected}
      latest={latest}
      compared={compared}
      spreadFor={spreadFor}
      stacked={isCompact}
    />
  ) : null;

  if (isCompact) {
    if (!detail) {
      return (
        <View style={styles.compactStack}>
          {leaderboard}
          <RunsHeader canRun={canRun} starting={starting} running={running} onRun={onRun} />
          {runs}
        </View>
      );
    }
    return (
      <View style={styles.compactStack}>
        <Button variant="ghost" size="sm" onPress={onBack} testID="brain-leaderboard-back">
          Back to the leaderboard
        </Button>
        <RunsHeader canRun={canRun} starting={starting} running={running} onRun={onRun} />
        {runs}
        {detail}
      </View>
    );
  }

  return (
    <BrainSplitter
      direction="horizontal"
      ratio={benchmarksSplitRatio}
      onRatioChange={setBenchmarksSplitRatio}
      testID="brain-benchmarks-splitter"
    >
      <View style={styles.listPane}>
        <BenchmarkToolbar runCount={runCount} />
        <BrainSplitter
          direction="vertical"
          ratio={benchmarkTablesSplitRatio}
          onRatioChange={setBenchmarkTablesSplitRatio}
          testID="brain-benchmark-tables-splitter"
          showRule={false}
        >
          {leaderboard}
          <View style={styles.runsPane}>
            <RunsHeader canRun={canRun} starting={starting} running={running} onRun={onRun} />
            {runs}
          </View>
        </BrainSplitter>
      </View>
      <BenchmarkDetailPane>
        {detail ?? (
          <View style={styles.centered}>
            <Text style={styles.empty}>Select a model</Text>
            <Text style={styles.emptyHint}>
              Its latest run shows up here, and picking a run compares it against that one.
            </Text>
          </View>
        )}
      </BenchmarkDetailPane>
    </BrainSplitter>
  );
}

function BenchmarkToolbar({ runCount }: { runCount: number }) {
  const styles = useStyles();
  return (
    <View style={styles.toolbar}>
      <Text style={styles.meta}>
        {runCount > 0
          ? `${runCount} ${runCount === 1 ? "run" : "runs"} recorded`
          : "No runs recorded"}
      </Text>
    </View>
  );
}

function RunsHeader({
  canRun,
  starting,
  running,
  onRun,
}: {
  canRun: boolean;
  starting: boolean;
  running: boolean;
  onRun: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionLabel}>Runs</Text>
      {canRun ? (
        <Button
          variant="secondary"
          size="sm"
          onPress={onRun}
          loading={starting}
          disabled={starting || running}
          testID="brain-bench-run"
        >
          Run the suite
        </Button>
      ) : null}
    </View>
  );
}

/** The desktop result pane owns its scroll region, matching the model detail pane. */
function BenchmarkDetailPane({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const scrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(scrollRef);

  return (
    <View style={styles.detailPane}>
      <ScrollView
        ref={scrollRef}
        style={styles.detailScroll}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={isNative}
      >
        <View style={styles.detailContent}>{children}</View>
      </ScrollView>
      {scrollbar.overlay}
    </View>
  );
}

/**
 * The selected model, its latest run, and the run being compared against it.
 *
 * The latest run is never replaced by the selection - it is the fixed reference
 * every other run is read against, so selecting adds a second card rather than
 * swapping the first. Selecting the latest run itself compares nothing, which is
 * why the caller resolves that case to a null `compared`.
 */
function ModelDetail({
  row,
  latest,
  compared,
  spreadFor,
  stacked,
}: {
  row: RankedRow;
  latest: RunListEntry | null;
  compared: RunListEntry | null;
  spreadFor: (run: LatestRun) => VarianceRow | null;
  /** Compact has no room for two columns, so the cards stack instead. */
  stacked: boolean;
}) {
  const styles = useStyles();
  const comparing = compared !== null;
  const delta =
    compared && compared.run.overall !== null && latest?.run.overall !== null
      ? compared.run.overall - (latest?.run.overall ?? 0)
      : null;
  const latestComparisonTaskSeconds = compared ? taskSecondsByKey(compared.run) : null;
  const selectedComparisonTaskSeconds = latest ? taskSecondsByKey(latest.run) : null;

  return (
    <View style={styles.detail} testID="brain-leaderboard-detail">
      <View style={styles.detailHeader}>
        <Text style={styles.detailTitle} numberOfLines={2}>
          {row.name}
        </Text>
        <GradeBadge grade={row.grade} />
      </View>
      {/* The stats line and the comparison verdict share this row: both are one
          short sentence about the same model, and stacked they left a band of
          empty gutter down the middle of the pane. The row is rendered whether
          or not there is a delta, and reserves the delta's line height, so
          selecting a run to compare never shifts the cards below - that is the
          job the standalone delta strip used to do. */}
      <View style={styles.detailSummaryRow}>
        <Text style={styles.detailSummary}>
          {`Rank ${row.rank} · ${formatPercent(row.overall)} across ${row.runs} ${
            row.runs === 1 ? "run" : "runs"
          }${row.std === null ? "" : ` · ${formatSpread(row.std)}`}`}
        </Text>
        {/* `latest` gates this: with no latest run there is nothing to be "vs",
            and the delta below computes against 0 rather than going null. */}
        {latest === null || delta === null ? null : (
          <Text style={delta >= 0 ? styles.deltaUp : styles.deltaDown} numberOfLines={1}>
            {formatDelta(delta)}
          </Text>
        )}
      </View>
      {latest === null ? (
        <Text style={styles.detailEmpty}>
          No stored results for this model. Its rank comes from runs whose records are no longer on
          this host.
        </Text>
      ) : (
        /* The verdict on the comparison rides in the summary row above, not
              inside a card: it is about both runs, and a line living in one of
              them pushed that card's every section a row out of step with its
              twin. */
        <View style={comparing && !stacked ? styles.compareRow : styles.compareStack}>
          <RunCard
            run={latest.run}
            spread={spreadFor(latest.run)}
            label="Latest run"
            comparing={comparing && !stacked}
            comparisonTaskSeconds={latestComparisonTaskSeconds}
          />
          {compared ? (
            <RunCard
              run={compared.run}
              spread={spreadFor(compared.run)}
              label="Selected run"
              comparing={!stacked}
              comparisonTaskSeconds={selectedComparisonTaskSeconds}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
