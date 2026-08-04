import { FONT_SIZE, SPACING } from "@/styles/theme";

// The shape of the resource strip, and the rules for what survives as the window
// narrows. Split out from the component so the fitting logic is a pure function
// with a test, rather than a pile of ternaries inside JSX.
//
// Three levers, applied in order, so the strip gives up the least valuable thing
// first:
//   1. full labels -> acronyms ("unobserved" -> "unob"), which buys ~40% back
//      without losing a single reading
//   2. drop whole groups, least diagnostic first (see DROP_ORDER)
//   3. compact form factor skips all of that and shows one curated group
//
// Horizontal scrolling stays as the safety valve underneath: if the estimate is
// optimistic the strip still scrolls, exactly as it did before any of this.

export type ResourceLabelMode = "full" | "short";

export interface ResourceFieldDef {
  /** Stable id - the component maps this to a formatted metric value. */
  id: string;
  label: string;
  /** Acronym used once the strip has to economize. */
  short: string;
  /**
   * Nominal rendered length of the VALUE, in characters, for width estimation.
   * Defaults to `NOMINAL_VALUE_CHARS`. Override only where a field is known to
   * run long ("sessions.length +1.2k/h") - using the live value here instead
   * would make the tier flap every time a number crossed a digit boundary.
   */
  valueChars?: number;
}

export interface ResourceGroupDef {
  id: string;
  title: string;
  shortTitle: string;
  fields: ResourceFieldDef[];
}

const FIELDS = {
  fps: { id: "fps", label: "fps", short: "fps" },
  p95: { id: "p95", label: "p95", short: "p95" },
  worst: { id: "worst", label: "worst", short: "wst" },
  longFrames: { id: "longFrames", label: "long", short: "lng" },
  heap: { id: "heap", label: "js heap", short: "js" },
  domNodes: { id: "domNodes", label: "dom nodes", short: "dom" },
  queries: { id: "queries", label: "queries", short: "qry" },
  unobserved: { id: "unobserved", label: "unobserved", short: "unob" },
  observers: { id: "observers", label: "observers", short: "obs" },
  intervals: { id: "intervals", label: "intervals", short: "int" },
  timeouts: { id: "timeouts", label: "timeouts", short: "to" },
  messages: { id: "messages", label: "messages", short: "msg" },
  bytes: { id: "bytes", label: "bytes", short: "byt" },
  handler: { id: "handler", label: "handler", short: "hnd" },
  ofSession: { id: "ofSession", label: "of session", short: "%ses" },
  streamItems: { id: "streamItems", label: "stream items", short: "itm" },
  agents: { id: "agents", label: "agents", short: "agt" },
  workspaces: { id: "workspaces", label: "workspaces", short: "wsp" },
  observed: { id: "observed", label: "observed", short: "time" },
  samples: { id: "samples", label: "samples", short: "smp" },
  growth: { id: "growth", label: "fastest growth", short: "growth", valueChars: 20 },
} as const satisfies Record<string, ResourceFieldDef>;

// Left-to-right IS the diagnosis order - how smooth is it, how much is retained,
// how loud is the daemon connection, and finally what is growing fastest. Groups
// are dropped from this list, never reordered.
export const RESOURCE_GROUPS: ResourceGroupDef[] = [
  {
    id: "frames",
    title: "Frames",
    shortTitle: "Frames",
    fields: [FIELDS.fps, FIELDS.p95, FIELDS.worst, FIELDS.longFrames],
  },
  {
    id: "memory",
    title: "Memory",
    shortTitle: "Mem",
    fields: [FIELDS.heap, FIELDS.domNodes],
  },
  {
    id: "cache",
    title: "Cache",
    shortTitle: "Cache",
    fields: [FIELDS.queries, FIELDS.unobserved, FIELDS.observers],
  },
  {
    id: "timers",
    title: "Timers",
    shortTitle: "Tmrs",
    fields: [FIELDS.intervals, FIELDS.timeouts],
  },
  {
    id: "traffic",
    title: "Daemon traffic",
    shortTitle: "Traffic",
    fields: [FIELDS.messages, FIELDS.bytes, FIELDS.handler, FIELDS.ofSession],
  },
  {
    id: "chat",
    title: "Chat state",
    shortTitle: "Chat",
    fields: [FIELDS.streamItems, FIELDS.agents, FIELDS.workspaces],
  },
  {
    id: "session",
    title: "Session",
    shortTitle: "Sess",
    fields: [FIELDS.observed, FIELDS.samples, FIELDS.growth],
  },
];

// The one group a phone gets. Not any of the seven above: on a screen this narrow
// the useful question is only "is it smooth, and is it holding too much", so this
// pairs the frame timings with the heap figure and leaves the rest to a wider
// window. Same field ids, so it reads the same value map.
export const COMPACT_RESOURCE_GROUP: ResourceGroupDef = {
  id: "compact",
  title: "Performance",
  shortTitle: "Perf",
  fields: [FIELDS.fps, FIELDS.p95, FIELDS.worst, FIELDS.heap],
};

// Least diagnostic first. Timers and Cache are leak-hunting detail you go looking
// for deliberately; Frames is the reading the strip exists for and is never
// dropped, so it is absent from this list.
const DROP_ORDER: readonly string[] = ["timers", "cache", "chat", "traffic", "session", "memory"];

// Width estimation. Approximate on purpose - measuring text in React Native means
// a second layout pass, and the cost of being wrong here is a strip that scrolls
// (which it already did). Character widths are ratios of the BASE font sizes;
// `applyAppearance` can scale the live theme up, which makes the estimate
// optimistic and lands the user back on scrolling rather than on clipped text.
const LABEL_CHAR_WIDTH = FONT_SIZE.xs * 0.55;
const VALUE_CHAR_WIDTH = FONT_SIZE.code * 0.62; // mono runs wider than the label face
const NOMINAL_VALUE_CHARS = 6; // "120.5ms", "1.2k", "48.3MB"
const FIELD_GAP = SPACING[3];
const GROUP_SEPARATOR = SPACING[4] * 2 + 1; // divider margins + the 1px rule

function fieldWidth(field: ResourceFieldDef, labelMode: ResourceLabelMode): number {
  const label = labelMode === "short" ? field.short : field.label;
  const valueWidth = (field.valueChars ?? NOMINAL_VALUE_CHARS) * VALUE_CHAR_WIDTH;
  return Math.max(label.length * LABEL_CHAR_WIDTH, valueWidth);
}

export function estimateGroupWidth(group: ResourceGroupDef, labelMode: ResourceLabelMode): number {
  const title = labelMode === "short" ? group.shortTitle : group.title;
  const fieldsWidth =
    group.fields.reduce((total, field) => total + fieldWidth(field, labelMode), 0) +
    FIELD_GAP * Math.max(0, group.fields.length - 1);
  return Math.max(title.length * LABEL_CHAR_WIDTH, fieldsWidth);
}

export function estimateStripWidth(
  groups: readonly ResourceGroupDef[],
  labelMode: ResourceLabelMode,
): number {
  if (groups.length === 0) {
    return 0;
  }
  const content = groups.reduce((total, group) => total + estimateGroupWidth(group, labelMode), 0);
  return content + GROUP_SEPARATOR * (groups.length - 1);
}

export interface ResourceBarLayout {
  groups: ResourceGroupDef[];
  labelMode: ResourceLabelMode;
}

/**
 * What the strip shows at this width. `availableWidth` is the bar's measured
 * inner width (already net of its horizontal padding); pass 0 before the first
 * layout, which yields the full strip - the same thing the bar rendered before
 * it measured anything, so the first frame never flashes a degraded version.
 */
export function resolveResourceBarLayout(input: {
  availableWidth: number;
  isCompact: boolean;
}): ResourceBarLayout {
  if (input.isCompact) {
    return { groups: [COMPACT_RESOURCE_GROUP], labelMode: "short" };
  }
  if (input.availableWidth <= 0) {
    return { groups: RESOURCE_GROUPS, labelMode: "full" };
  }
  if (estimateStripWidth(RESOURCE_GROUPS, "full") <= input.availableWidth) {
    return { groups: RESOURCE_GROUPS, labelMode: "full" };
  }

  // Acronyms first: every reading survives, so this is always worth doing before
  // taking a whole group away.
  let kept = RESOURCE_GROUPS;
  for (const dropId of [null, ...DROP_ORDER]) {
    if (dropId !== null) {
      kept = kept.filter((group) => group.id !== dropId);
    }
    if (estimateStripWidth(kept, "short") <= input.availableWidth) {
      return { groups: kept, labelMode: "short" };
    }
  }
  // Narrower than even the frame timings alone: keep them and let the strip
  // scroll rather than showing nothing.
  return { groups: kept, labelMode: "short" };
}
