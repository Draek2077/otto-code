/**
 * The Benchmarks tab: pick a model, pick a run, compare it against the latest.
 *
 * Two stacked tables on the left, one detail pane on the right. Both tables are
 * TABLES for the same reason the Models tab's is: their entire job is comparison
 * between rows. The leaderboard picks a model; the run list under it picks which
 * of that model's runs to put beside the newest one.
 *
 * **The right pane shows the latest run by default, and exactly two runs when a
 * run is selected.** That is the whole shape of the question this page answers -
 * not "what did this model score" (the leaderboard already said) but "what
 * changed between the setup that scored 71% and the one that scored 43%". Two
 * cards side by side with identical structure make that a scan down the column;
 * a stack of every configuration makes it a memory test.
 *
 * The run list carries its own spread stats, folded in from `evals.variance`.
 * They used to live in a separate full-width table, which meant the number that
 * says whether a run was typical sat nowhere near the run it judged.
 *
 * `evals.latest` is the most recent run per model+config, tasks and all, so a
 * "run" in this file is always one configuration's newest measurement.
 *
 * Running the suite still goes through the job RPCs (`brain.bench`), which shell
 * out to the CLI, because a benchmark is a long local job over the local model
 * store. Only the reads moved to the proxied management API.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { BrainEvals, BrainJob } from "@otto-code/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { Medal, X } from "@/components/icons/material-icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { useBrainLayoutStore } from "./brain-layout-store";
import { BrainSplitter } from "./brain-splitter";
import { timeSeverity } from "./benchmark-time-severity";

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedMedal = withUnistyles(Medal);
const ThemedX = withUnistyles(X);

const dangerIcon = (theme: Theme) => ({
  color: theme.colors.palette.red[500],
  size: theme.iconSize.sm,
});
const cancelIcon = <ThemedX uniProps={dangerIcon} />;

const EVALS_POLL_MS = 10_000;
const JOBS_POLL_MS = 2000;

// Shared by the pinned header and the rows below it. The grade column is sized
// for "Unusable" plus its medal on one line: 56px forced every grade past
// "weak" to wrap, which is what broke the row rhythm. Everything else is held
// to what its widest value needs, so the slack lands on `name`, the only column
// whose content actually runs long.
//
// The fixed columns carry `flexShrink: 0` so the header (outside the row scroll
// region) and the rows (inside it) never drift apart column by column - the same
// lesson the Models table already learned. Only `name` gives ground.
const COLUMN = {
  // Width is a floor only - `rankWidth()` below sizes this column to the widest
  // rank actually on screen, and both the header and the rows take that number.
  // A fixed 3-digit box on a list of nine models is 17px of slack sitting
  // between the rank and the name it numbers, and slack inside a left-aligned
  // box reads as a wider gap than the gap itself.
  rank: { width: 10, flexShrink: 0 as const },
  name: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  // Every fixed column is the wider of its value and its HEADER, plus a hair. A
  // column wider than both spends the surplus as a gap the eye reads as one; a
  // column narrower than its header wraps it ("Run/s"), which is worse than any
  // gap. So: "100.0%" and a 3-digit count at `fontSize.code` mono against
  // "Score" and "Runs" at `fontSize.xs`, and the grade's 16px medal plus a 6px
  // gap plus "Unusable" at `fontSize.sm`.
  score: { width: 48, flexShrink: 0 as const, textAlign: "right" as const },
  runs: { width: 34, flexShrink: 0 as const, textAlign: "right" as const },
  // No `textAlign` here: the grade cell is a View (medal + label), so the right
  // edge is won with `justifyContent` below and `textAlign` on the Text uses.
  grade: { width: 86, flexShrink: 0 as const },
} as const;

// `numberOfLines={1}` is not single-line truncation on web. It compiles to
// `-webkit-line-clamp`, which still WRAPS the text first - and CSS breaks lines
// at hyphens, so "gemma-4-E4B-it-Q4_K_M" clamps at a hyphen well short of the
// column edge and leaves the rest of the cell empty. Model ids are nothing but
// hyphens, so every name in this table hit it.
//
// So web truncates in CSS instead and never asks for the clamp: `nowrap` keeps
// it one line, and the ellipsis lands at the real box edge. (`display: block`
// would belong here too, but the RN style types reject it - the cell is a flex
// item, so it is blockified anyway and `text-overflow` applies.) Native has no
// line-clamp and truncates at the box edge already, so it keeps the prop.
const SINGLE_LINE_TRUNCATE = isWeb
  ? ({ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" } as const)
  : null;

/**
 * The `numberOfLines` half of the pair above: 1 on native, where it is the only
 * way to stop a wrap, and undefined on web, where asking for it is the bug.
 *
 * Column headers take both as well. A header is a fixed label in a fixed box -
 * if it does not fit, the answer is a wider column, never a second line.
 */
const ONE_LINE = isWeb ? undefined : 1;

// 10px, not `theme.spacing[3]` (12): there is no 10px spacing token, and the
// header and the rows have to carry the identical value or the two drift apart.
const COLUMN_GAP = 10;

/**
 * The rank column, sized to the widest rank the list can show.
 *
 * A ranked list of nine and a ranked list of two hundred do not deserve the same
 * gutter, and a box wide enough for the second one puts a channel of dead space
 * between "1" and the model it belongs to. Ranks run 1..n, so the row count is
 * the widest value.
 *
 * It stays a single number for the whole table rather than per row: the header
 * sits outside the row scroll region, so anything that sizes to its own content
 * drifts out of line with the rows below it.
 */
const RANK_DIGIT_WIDTH = 8; // A digit at `fontSize.code` mono, rounded up.

function rankWidth(rowCount: number): number {
  return Math.max(COLUMN.rank.width, String(Math.max(rowCount, 1)).length * RANK_DIGIT_WIDTH);
}

// Narrower than this and a column stops earning its keep, dropped least-useful
// first. Both live on in the detail pane, so losing them from a squeezed list
// costs nothing. Widths above plus a 10px gap each, 32px of row padding, a
// two-digit rank and the name's 100px floor: everything fits in ~356px, and
// dropping Runs makes it ~312px. Re-derive these whenever a width above moves.
const RUNS_HIDE_BELOW = 356;
const GRADE_HIDE_BELOW = 312;

// The run list under the leaderboard. `config` is the one column that runs long
// (a spelled-out profile), so it takes the slack; `model` only appears when the
// list is not already scoped to one, and gets less room than the config it
// qualifies.
// `ran` holds "Aug 3, 09:13 PM" - 15 proportional characters at `fontSize.xs`,
// which needs ~108px. It was 92, so every row truncated a timestamp that had
// nothing optional left in it. A fixed column has to be sized for its widest
// value or the ellipsis stops being a fallback and becomes the rendering.
const RUN_COLUMN = {
  model: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  config: { flexGrow: 2, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  ran: { width: 108, flexShrink: 0 as const, textAlign: "right" as const },
  score: { width: 56, flexShrink: 0 as const, textAlign: "right" as const },
  count: { width: 40, flexShrink: 0 as const, textAlign: "right" as const },
  spread: { width: 56, flexShrink: 0 as const, textAlign: "right" as const },
} as const;

// Same least-useful-first rule as the leaderboard. Spread goes before the run
// count because a spread with no count beside it is the less readable half, and
// both are repeated on the card the row opens. Widths above plus a 10px gap
// each, 32px of row padding and the config column's 120px floor: everything
// fits in ~452px, dropping Spread makes it ~386px, and dropping Runs ~336px.
// Re-derive these whenever a width above moves.
const SPREAD_HIDE_BELOW = 460;
const COUNT_HIDE_BELOW = 395;
const RAN_HIDE_BELOW = 345;

// The delta line above the compared cards. Stated rather than inherited, and
// shared by the reserved box and the text inside it, because the two must agree
// exactly: the box is what stops the cards moving when a comparison opens, and
// it can only do that if it is the same height the text would have taken.
const DELTA_LINE_HEIGHT = 16;

/**
 * The bench's five grades (`packages/brain/src/bench/index.ts`), best first.
 *
 * The top three take a gold, silver and bronze medal; the two below them take
 * the same medal in the muted foreground. That is deliberate - a grade is a
 * position on a fixed ladder, not a colour scale, so the failing tiers get the
 * shape without the reward rather than a red badge that reads as an error.
 */
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
  const style = useMemo(() => [styles.gradeLabel, color ? { color } : null], [color]);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

const ThemedGradeLabel = withUnistyles(GradeLabelText);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNumber(source: Record<string, unknown> | null, key: string): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(source: Record<string, unknown> | null, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return null;
}

function readBoolean(source: Record<string, unknown> | null, key: string): boolean | null {
  const value = source?.[key];
  return typeof value === "boolean" ? value : null;
}

interface RankedRow {
  id: string;
  name: string;
  overall: number;
  runs: number;
  /** Sample std across this model's runs; what says whether the rank is backed. */
  std: number | null;
  grade: string | null;
  rank: number;
}

function readRankings(evals: BrainEvals | null): RankedRow[] {
  if (!evals) {
    return [];
  }
  return evals.rankings
    .map((raw, index): RankedRow => {
      const record = asRecord(raw);
      const name = readString(record, "displayName", "id") ?? "Unknown model";
      return {
        id: readString(record, "id") ?? name,
        name,
        // `overall` is reported as a 0..1 fraction.
        overall: readNumber(record, "overall") ?? 0,
        runs: readNumber(record, "runs") ?? 0,
        std: readNumber(record, "std"),
        grade: readString(record, "grade"),
        rank: readNumber(record, "rank") ?? index + 1,
      };
    })
    .sort((a, b) => a.rank - b.rank || b.overall - a.overall);
}

interface VarianceRow {
  key: string;
  modelId: string | null;
  /** Named to match `LatestRun` so both can be matched to a leaderboard row. */
  modelName: string;
  configKey: string | null;
  count: number;
  mean: number | null;
  std: number | null;
}

function readVariance(evals: BrainEvals | null): VarianceRow[] {
  if (!evals) {
    return [];
  }
  return evals.variance.map((raw, index): VarianceRow => {
    const record = asRecord(raw);
    const model = asRecord(record?.model);
    const overall = asRecord(record?.overall);
    const name = readString(model, "displayName") ?? readString(record, "model") ?? "Unknown model";
    const configKey = readString(record, "configKey");
    return {
      key: `${name}:${configKey ?? index}`,
      modelId: readString(model, "id"),
      modelName: name,
      configKey,
      count: readNumber(record, "count") ?? 0,
      mean: readNumber(overall, "mean"),
      std: readNumber(overall, "std"),
    };
  });
}

/** One graded task inside a stored run. */
interface RunTask {
  key: string;
  category: string;
  summary: string | null;
  weight: number | null;
  score: number | null;
  seconds: number | null;
  error: string | null;
}

function taskSecondsByKey(run: LatestRun): ReadonlyMap<string, number | null> {
  return new Map(run.tasks.map((task) => [task.key, task.seconds]));
}

/** The settings a run was measured under - a score means nothing without them. */
interface RunProfile {
  contextSize: number | null;
  cacheTypeK: string | null;
  cacheTypeV: string | null;
  reasoningBudget: number | null;
  vision: boolean | null;
  flashAttention: boolean | null;
  gpuLayers: number | null;
  parallelSlots: number | null;
  batchSize: number | null;
  ubatchSize: number | null;
  extraArgs: string[];
}

/**
 * How the run was set up, as opposed to how it was configured (schema 2+).
 *
 * The gap between the two is where bad scores come from: the brain will cut a
 * profile's context down to whatever fits the GPU and run anyway, so a record
 * without this block can say a model scored 41% at 128k context when it was
 * really measured at 16k.
 */
interface RunSetup {
  args: string[];
  adjusted: boolean;
  requestedContextSize: number | null;
  adjustReason: string | null;
  kvSource: string | null;
  kvInherited: boolean;
  kvBytesPerToken: number | null;
  theoreticalKvBytesPerToken: number | null;
  predictedVramBytes: number | null;
  headroomBytes: number | null;
}

/** Which suite graded the run (schema 2+). Different tasks, different meaning. */
interface RunSuite {
  execute: boolean | null;
  concurrency: number | null;
  depths: number[] | null;
  only: string[] | null;
  mined: boolean;
}

/** One stored benchmark run (`results.RunRecord`), as this tab reads it. */
interface LatestRun {
  key: string;
  modelId: string | null;
  modelName: string;
  configKey: string | null;
  ranAt: string | null;
  overall: number | null;
  grade: string | null;
  seconds: number | null;
  executedCode: boolean | null;
  vramBytes: number | null;
  loadSeconds: number | null;
  runtime: string | null;
  gpuName: string | null;
  /** GGUF geometry: the ceiling a context size has to sit under to make sense. */
  nativeContextLength: number | null;
  blockCount: number | null;
  profile: RunProfile | null;
  setup: RunSetup | null;
  suite: RunSuite | null;
  tasks: RunTask[];
}

function readTasks(raw: unknown): RunTask[] {
  return asArray(raw).map((entry, index): RunTask => {
    const task = asRecord(entry);
    const id = readString(task, "id");
    return {
      key: id ?? `task-${index}`,
      category: readString(task, "category") ?? id ?? "Task",
      summary: readString(task, "summary"),
      weight: readNumber(task, "weight"),
      score: readNumber(task, "score"),
      seconds: readNumber(task, "seconds"),
      error: readString(task, "error"),
    };
  });
}

function readStringArray(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

function readNumberArray(value: unknown): number[] {
  return asArray(value).filter(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry),
  );
}

function readProfile(raw: unknown): RunProfile | null {
  const profile = asRecord(raw);
  if (!profile) {
    return null;
  }
  return {
    contextSize: readNumber(profile, "contextSize"),
    cacheTypeK: readString(profile, "cacheTypeK"),
    cacheTypeV: readString(profile, "cacheTypeV"),
    reasoningBudget: readNumber(profile, "reasoningBudget"),
    vision: readBoolean(profile, "vision"),
    flashAttention: readBoolean(profile, "flashAttention"),
    // Schema 2 onwards. A schema 1 record simply did not store these, which is
    // not the same as the run having had no value for them - hence null, and a
    // display that omits the line rather than printing a confident "0".
    gpuLayers: readNumber(profile, "gpuLayers"),
    parallelSlots: readNumber(profile, "parallelSlots"),
    batchSize: readNumber(profile, "batchSize"),
    ubatchSize: readNumber(profile, "ubatchSize"),
    extraArgs: readStringArray(profile.extraArgs),
  };
}

function readSetup(raw: unknown): RunSetup | null {
  const setup = asRecord(raw);
  if (!setup) {
    return null;
  }
  return {
    args: readStringArray(setup.args),
    adjusted: readBoolean(setup, "adjusted") ?? false,
    requestedContextSize: readNumber(setup, "requestedContextSize"),
    adjustReason: readString(setup, "adjustReason"),
    kvSource: readString(setup, "kvSource"),
    kvInherited: readBoolean(setup, "kvInherited") ?? false,
    kvBytesPerToken: readNumber(setup, "kvBytesPerToken"),
    theoreticalKvBytesPerToken: readNumber(setup, "theoreticalKvBytesPerToken"),
    predictedVramBytes: readNumber(setup, "predictedVramBytes"),
    headroomBytes: readNumber(setup, "headroomBytes"),
  };
}

function readSuite(raw: unknown): RunSuite | null {
  const suite = asRecord(raw);
  if (!suite) {
    return null;
  }
  const depths = readNumberArray(suite.depths);
  const only = readStringArray(suite.only);
  return {
    execute: readBoolean(suite, "execute"),
    concurrency: readNumber(suite, "concurrency"),
    depths: depths.length > 0 ? depths : null,
    only: only.length > 0 ? only : null,
    mined: readBoolean(suite, "mined") ?? false,
  };
}

/**
 * `evals.latest` is the most recent run per model+config, not every run: an
 * earlier run of the same setup is superseded, so showing it would invite a
 * comparison between a measurement and the measurement that replaced it.
 */
function readLatestRuns(evals: BrainEvals | null): LatestRun[] {
  if (!evals) {
    return [];
  }
  return evals.latest.map((raw, index): LatestRun => {
    const record = asRecord(raw);
    const model = asRecord(record?.model);
    const gpu = asRecord(record?.gpu);
    const modelName = readString(model, "displayName") ?? "Unknown model";
    const configKey = readString(record, "configKey");
    return {
      key: readString(record, "file") ?? `${modelName}:${configKey ?? index}`,
      modelId: readString(model, "id"),
      modelName,
      configKey,
      ranAt: readString(record, "ranAt"),
      overall: readNumber(record, "overall"),
      grade: readString(record, "grade"),
      seconds: readNumber(record, "seconds"),
      executedCode: readBoolean(record, "executedCode"),
      vramBytes: readNumber(record, "vramBytes"),
      loadSeconds: readNumber(record, "loadSeconds"),
      runtime: readString(record, "runtime"),
      gpuName: readString(gpu, "name"),
      nativeContextLength: readNumber(model, "contextLength"),
      blockCount: readNumber(model, "blockCount"),
      profile: readProfile(record?.profile),
      setup: readSetup(record?.setup),
      suite: readSuite(record?.suite),
      tasks: readTasks(record?.tasks),
    };
  });
}

/**
 * Whether a stored run belongs to a leaderboard row.
 *
 * The ranking groups by `id || displayName`, so a row's `id` is the display name
 * whenever every run behind it lacked one. Comparing ids only when BOTH sides
 * really have one keeps that fallback from matching a run's id against another
 * model's name.
 */
function runBelongsTo(run: { modelId: string | null; modelName: string }, row: RankedRow): boolean {
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
  if (profile.contextSize !== null) {
    parts.push(`${profile.contextSize.toLocaleString()} ctx`);
  }
  if (profile.cacheTypeK && profile.cacheTypeV) {
    parts.push(`KV ${profile.cacheTypeK}/${profile.cacheTypeV}`);
  }
  if (profile.reasoningBudget !== null) {
    // -1 is llama.cpp's "spend as much as you like", which is the failure mode
    // the sweep exists to cap - it is worth naming rather than printing raw.
    parts.push(
      profile.reasoningBudget < 0
        ? "unlimited reasoning"
        : `${profile.reasoningBudget.toLocaleString()} reasoning budget`,
    );
  }
  if (profile.flashAttention !== null) {
    parts.push(profile.flashAttention ? "flash attention" : "no flash attention");
  }
  if (profile.parallelSlots !== null && profile.parallelSlots > 1) {
    parts.push(`${profile.parallelSlots} slots`);
  }
  if (profile.batchSize !== null) {
    parts.push(`batch ${profile.batchSize.toLocaleString()}`);
  }
  if (profile.ubatchSize !== null) {
    parts.push(`ubatch ${profile.ubatchSize.toLocaleString()}`);
  }
  if (profile.vision) {
    parts.push("vision");
  }
  return parts.length > 0 ? parts.join(" · ") : (run.configKey ?? "Unknown configuration");
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
  const handlePress = useCallback(() => onSelect(row.id), [onSelect, row.id]);
  const rowStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      selected && styles.rowSelected,
    ],
    [selected],
  );
  return (
    <Pressable
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
    </Pressable>
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
  const tableScrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(tableScrollRef);
  const [tableWidth, setTableWidth] = useState(0);
  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) =>
      setTableWidth(event.nativeEvent.layout.width),
    [],
  );
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
  const headerRankStyle = useMemo(() => [styles.headerRank, { width }], [width]);
  const cellRankStyle = useMemo(() => [styles.cellRank, { width }], [width]);

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
interface RunListEntry {
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
  const { run, spread } = entry;
  const handlePress = useCallback(() => onSelect(run), [onSelect, run]);
  const rowStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      selected && styles.rowSelected,
    ],
    [selected],
  );
  return (
    <Pressable
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
    </Pressable>
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
  const tableScrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(tableScrollRef);
  const [tableWidth, setTableWidth] = useState(0);
  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) =>
      setTableWidth(event.nativeEvent.layout.width),
    [],
  );
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
function LeaderboardPanes({
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
          <Text style={styles.sectionLabel}>Runs</Text>
          {runs}
        </View>
      );
    }
    return (
      <View style={styles.compactStack}>
        <Button variant="ghost" size="sm" onPress={onBack} testID="brain-leaderboard-back">
          Back to the leaderboard
        </Button>
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
        <BenchmarkToolbar
          runCount={runCount}
          canRun={canRun}
          starting={starting}
          running={running}
          onRun={onRun}
        />
        <BrainSplitter
          direction="vertical"
          ratio={benchmarkTablesSplitRatio}
          onRatioChange={setBenchmarkTablesSplitRatio}
          testID="brain-benchmark-tables-splitter"
          showRule={false}
        >
          {leaderboard}
          <View style={styles.runsPane}>
            <Text style={styles.sectionLabel}>Runs</Text>
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

function BenchmarkToolbar({
  runCount,
  canRun,
  starting,
  running,
  onRun,
}: {
  runCount: number;
  canRun: boolean;
  starting: boolean;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <View style={styles.toolbar}>
      <Text style={styles.meta}>
        {runCount > 0
          ? `${runCount} ${runCount === 1 ? "run" : "runs"} recorded`
          : "No runs recorded"}
      </Text>
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
        <>
          {/* The verdict on the comparison rides in the summary row above, not
              inside a card: it is about both runs, and a line living in one of
              them pushed that card's every section a row out of step with its
              twin. */}
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
        </>
      )}
    </View>
  );
}

export function BrainBenchmarksTab({
  serverId,
  isConnected,
  canRunJobs,
}: {
  serverId: string;
  isConnected: boolean;
  /** False for a remote brain until it serves remote job operations. */
  canRunJobs: boolean;
}) {
  const client = useHostRuntimeClient(serverId);
  const manageSupported = useHostFeature(serverId, "brainManage");
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);

  const evalsQuery = useFetchQuery({
    queryKey: ["brain-console-evals", serverId] as const,
    enabled: isConnected && Boolean(client),
    dataShape: "value",
    staleTimeMs: EVALS_POLL_MS,
    refetchInterval: EVALS_POLL_MS,
    queryFn: async () => {
      if (!client) {
        throw new Error("This host is not connected.");
      }
      return client.brainEvalsGet();
    },
  });

  // A bench run is a tracked job, so its progress comes from the job list rather
  // than from the evals read, which only changes once the run has finished.
  const jobsQuery = useFetchQuery({
    queryKey: ["brain-console-bench-jobs", serverId] as const,
    enabled: isConnected && manageSupported && canRunJobs && Boolean(client),
    dataShape: "value",
    staleTimeMs: JOBS_POLL_MS,
    refetchInterval: JOBS_POLL_MS,
    queryFn: async () => {
      if (!client) {
        throw new Error("This host is not connected.");
      }
      return client.brainJobsList();
    },
  });

  const evals = evalsQuery.data ?? null;
  const rankings = useMemo(() => readRankings(evals), [evals]);
  const variance = useMemo(() => readVariance(evals), [evals]);
  const latestRuns = useMemo(() => readLatestRuns(evals), [evals]);
  const runningBench = useMemo(
    () =>
      (jobsQuery.data ?? []).find(
        (job: BrainJob) => job.kind === "bench" && job.status === "running",
      ) ?? null,
    [jobsQuery.data],
  );

  const selected = useMemo(
    () => rankings.find((row) => row.id === selectedId) ?? null,
    [rankings, selectedId],
  );

  // The spread of every run sharing a run's model+config - the brain groups by
  // exactly this key (`ops/results.ts` `grouped()`), so the two sides line up.
  const spreadByKey = useMemo(() => {
    const map = new Map<string, VarianceRow>();
    for (const entry of variance) {
      if (entry.configKey) {
        map.set(`${entry.modelName}::${entry.configKey}`, entry);
      }
    }
    return map;
  }, [variance]);
  const spreadFor = useCallback(
    (run: LatestRun) =>
      run.configKey ? (spreadByKey.get(`${run.modelName}::${run.configKey}`) ?? null) : null,
    [spreadByKey],
  );

  // Newest first: a run list whose top row is the run the detail pane already
  // pins reads as one ordering rather than two.
  const runEntries = useMemo(() => {
    const scoped = selected ? latestRuns.filter((run) => runBelongsTo(run, selected)) : latestRuns;
    return scoped
      .map((run): RunListEntry => ({ run, spread: spreadFor(run) }))
      .sort((a, b) => (b.run.ranAt ?? "").localeCompare(a.run.ranAt ?? ""));
  }, [latestRuns, selected, spreadFor]);

  // The reference card. Newest by when it ran, not by what it scored: "latest"
  // has to mean the same thing here as it does in the run list beside it.
  const latest = runEntries[0] ?? null;
  const compared = useMemo(() => {
    if (!selectedRunKey || selectedRunKey === latest?.run.key) {
      return null;
    }
    return runEntries.find((entry) => entry.run.key === selectedRunKey) ?? null;
  }, [latest, runEntries, selectedRunKey]);

  const handleSelectModel = useCallback((id: string) => {
    setSelectedId(id);
    // A run of the model being left says nothing about the one being entered.
    setSelectedRunKey(null);
  }, []);

  const handleSelectRun = useCallback(
    (run: LatestRun) => {
      const owner = rankings.find((row) => runBelongsTo(run, row)) ?? null;
      // Picking a run from the unscoped list is also how a model gets picked.
      if (owner && owner.id !== selectedId) {
        setSelectedId(owner.id);
        setSelectedRunKey(run.key);
        return;
      }
      // Re-picking the compared run drops back to the latest run alone.
      setSelectedRunKey((previous) => (previous === run.key ? null : run.key));
    },
    [rankings, selectedId],
  );

  const handleRun = useCallback(() => {
    void (async () => {
      if (!client) {
        return;
      }
      setStarting(true);
      setStartError(null);
      try {
        await client.brainBench(null);
        await jobsQuery.refetch?.();
      } catch (err) {
        setStartError(err instanceof Error ? err.message : String(err));
      } finally {
        setStarting(false);
      }
    })();
  }, [client, jobsQuery]);

  const handleCancelBench = useCallback(() => {
    if (!client || !runningBench) {
      return;
    }
    setStartError(null);
    void client
      .brainJobsCancel(runningBench.id)
      .catch((err) => setStartError(err instanceof Error ? err.message : String(err)));
  }, [client, runningBench]);

  const handleBack = useCallback(() => {
    setSelectedId(null);
    setSelectedRunKey(null);
  }, []);

  if (evalsQuery.isLoading && !evals) {
    return (
      <View style={styles.centered}>
        <ThemedSpinner size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {startError ? <Alert variant="error" description={startError} /> : null}
      <LeaderboardPanes
        runCount={evals?.runCount ?? 0}
        canRun={manageSupported && canRunJobs}
        starting={starting}
        running={runningBench !== null}
        runningJob={runningBench}
        onRun={handleRun}
        onCancelRunning={handleCancelBench}
        rows={rankings}
        runEntries={runEntries}
        selected={selected}
        latest={latest}
        compared={compared}
        selectedRunKey={selectedRunKey}
        spreadFor={spreadFor}
        onSelectModel={handleSelectModel}
        onSelectRun={handleSelectRun}
        onBack={handleBack}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    gap: theme.spacing[3],
    minHeight: 0,
  },
  centered: {
    paddingVertical: theme.spacing[12],
    alignItems: "center",
    gap: theme.spacing[2],
  },
  empty: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  emptyHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  listPane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: theme.spacing[2],
    minHeight: 0,
    padding: theme.spacing[4],
  },
  runsPane: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
  detailPane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    position: "relative",
  },
  compactStack: {
    gap: theme.spacing[2],
  },
  sectionLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    paddingTop: theme.spacing[1],
  },
  // Two cards, equal width, so the same section of each lands at the same height
  // and a difference between them is a horizontal glance.
  compareRow: {
    flexDirection: "row",
    // Stretch the cards as a pair. A shorter result must not end early just
    // because its counterpart has a wrapped task summary: the empty tail is a
    // useful visual signal that this run had less detail, not a broken grid.
    alignItems: "stretch",
    gap: theme.spacing[3],
  },
  compareStack: {
    gap: theme.spacing[3],
  },
  table: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    // surface1, not surface2: see the same fix in models-tab.tsx's `table` -
    // surface2 and the border token are nearly identical on this theme.
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
    position: "relative",
  },
  tableFill: {
    flex: 1,
    minHeight: 0,
  },
  // Two tables share the left pane now, so each gets a lower ceiling than the
  // Models table's 420: at 420 apiece the run list starts below the fold on a
  // laptop, and the run list is half the point of the layout.
  tableScroll: {
    flex: 1,
    minHeight: 0,
  },
  tableScrollRegion: {
    minHeight: 0,
    position: "relative",
  },
  tableScrollRegionCapped: {
    maxHeight: 280,
  },
  tableScrollRegionFill: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: COLUMN_GAP,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: COLUMN_GAP,
    paddingHorizontal: theme.spacing[4],
    // The medal makes the row taller than a text-only one; matching that height
    // in the padding keeps the ink centred instead of top-heavy.
    paddingVertical: theme.spacing[2],
    minHeight: 40,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface3,
  },
  rowSelected: {
    backgroundColor: theme.colors.surface3,
  },
  // Every header carries the no-wrap treatment, not just the ones that have
  // wrapped so far: a label that breaks across two lines ("Run/s") doubles the
  // header's height and knocks the whole table's rhythm out. If one ever needs
  // more room than this, widen the column in COLUMN above.
  headerRank: {
    ...COLUMN.rank,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerName: {
    ...COLUMN.name,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerScore: {
    ...COLUMN.score,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerRuns: {
    ...COLUMN.runs,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerGrade: {
    ...COLUMN.grade,
    ...SINGLE_LINE_TRUNCATE,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  cellRank: {
    ...COLUMN.rank,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  cellName: {
    ...COLUMN.name,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  cellScore: {
    ...COLUMN.score,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
  },
  cellRuns: {
    ...COLUMN.runs,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  cellGrade: {
    ...COLUMN.grade,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1.5],
  },
  cellGradeEmpty: {
    ...COLUMN.grade,
    textAlign: "right",
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  gradeLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  gradeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    flexShrink: 1,
  },
  runHeaderModel: {
    ...RUN_COLUMN.model,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runHeaderConfig: {
    ...RUN_COLUMN.config,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runHeaderRan: {
    ...RUN_COLUMN.ran,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runHeaderScore: {
    ...RUN_COLUMN.score,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runHeaderCount: {
    ...RUN_COLUMN.count,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runHeaderSpread: {
    ...RUN_COLUMN.spread,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runCellModel: {
    ...RUN_COLUMN.model,
    // Same hyphen-clamp trap as `cellName`: this cell carries model ids too.
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  runCellConfig: {
    ...RUN_COLUMN.config,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  runCellConfigText: {
    // The config string is the one cell with no fixed width, so it is the one
    // that gives way: `flexShrink` lets the badge beside it keep its size and
    // the ellipsis land where the text actually runs out of room.
    flexShrink: 1,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  runCellLatest: {
    flexShrink: 0,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  runCellRan: {
    ...RUN_COLUMN.ran,
    ...SINGLE_LINE_TRUNCATE,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runCellScore: {
    ...RUN_COLUMN.score,
    ...SINGLE_LINE_TRUNCATE,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
  },
  runCellAction: {
    ...RUN_COLUMN.score,
    alignItems: "flex-end",
  },
  runCellCount: {
    ...RUN_COLUMN.count,
    ...SINGLE_LINE_TRUNCATE,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  runCellSpread: {
    ...RUN_COLUMN.spread,
    ...SINGLE_LINE_TRUNCATE,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  detail: {
    gap: theme.spacing[3],
  },
  detailScroll: {
    flex: 1,
    minHeight: 0,
  },
  detailContent: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  detailTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  // `flexWrap` plus the delta's `flexGrow` below is what keeps the pair honest
  // at any width: side by side while both fit, and the delta on its own line -
  // still right-aligned, because it grows to fill that line - when they do not.
  detailSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexWrap: "wrap",
    minHeight: DELTA_LINE_HEIGHT,
  },
  detailSummary: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  detailEmpty: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  runCard: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  // The same card, sharing a row. `flexBasis: 0` rather than an intrinsic width:
  // the two runs' content differs (one may have an extra setup warning, a longer
  // argv), and without it the wordier card would claim more of the row and break
  // the alignment that makes the comparison readable.
  runCardCompared: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  runLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  // A fixed one-line box, always present. `minHeight` rather than letting the
  // text size it: an empty View collapses to zero, and the cards below would
  // jump by a line every time a comparison is opened or dropped.
  deltaUp: {
    flexGrow: 1,
    fontSize: theme.fontSize.xs,
    lineHeight: DELTA_LINE_HEIGHT,
    textAlign: "right",
    color: theme.colors.statusSuccess,
  },
  deltaDown: {
    flexGrow: 1,
    fontSize: theme.fontSize.xs,
    lineHeight: DELTA_LINE_HEIGHT,
    textAlign: "right",
    color: theme.colors.statusWarning,
  },
  runHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  runScore: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  runDate: {
    flexGrow: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textAlign: "right",
  },
  runConfig: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  runMeta: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  issues: {
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },
  issueWarn: {
    fontSize: theme.fontSize.xs,
    // The semantic token, not a raw amber: it is calibrated per scheme, and
    // these lines have to stay legible on both surfaces.
    color: theme.colors.statusWarning,
  },
  issueInfo: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  runArgs: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface3,
  },
  taskTable: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  taskHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
  },
  // Compared rows reserve room for the task name and two summary lines. The
  // summaries themselves still wrap naturally, but no longer move every task
  // that follows out of horizontal alignment with the other run.
  taskRowCompared: {
    minHeight: theme.spacing[16],
  },
  taskHeaderName: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  taskHeaderWeight: {
    width: 48,
    flexShrink: 0,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  taskHeaderScore: {
    width: 56,
    flexShrink: 0,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  taskHeaderSeconds: {
    width: 56,
    flexShrink: 0,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  taskName: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: theme.spacing[1],
  },
  taskCategory: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  taskSummary: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  taskError: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.palette.red[300],
  },
  taskWeight: {
    width: 48,
    flexShrink: 0,
    textAlign: "right",
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  taskScore: {
    width: 56,
    flexShrink: 0,
    textAlign: "right",
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
  },
  taskScoreExcellent: {
    color: theme.colors.statusSuccess,
  },
  taskScoreWarning: {
    color: theme.colors.statusWarning,
  },
  taskScoreCritical: {
    color: theme.colors.statusDanger,
  },
  taskSeconds: {
    width: 56,
    flexShrink: 0,
    textAlign: "right",
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  taskSecondsWarning: {
    color: theme.colors.statusWarning,
  },
  taskSecondsExcellent: {
    color: theme.colors.statusSuccess,
  },
  taskSecondsCritical: {
    color: theme.colors.statusDanger,
  },
}));
