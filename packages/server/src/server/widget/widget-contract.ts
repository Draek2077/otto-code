import { WIDGET_ICON_NAMES } from "@otto-code/protocol/widgets/icons";
import { WIDGET_MAX_CODE_CHARS } from "@otto-code/protocol/widgets/types";

/**
 * The host contract a widget fragment is written against.
 *
 * Claude's equivalent (`read_me` on its `visualize` server) is ~99K characters
 * across 1,189 lines. Otto does not copy that size. Most of it is aesthetic
 * doctrine — colour philosophy, prose style, words to avoid — and Otto is a
 * token-cost-conscious fork (docs/token-economy.md). What is kept is the half a
 * model cannot guess: the variable names, the globals, the sandbox limits.
 *
 * The modular shape IS copied, because that is what makes a contract document
 * affordable: the stub below is what a model reads first, and a module is
 * fetched only when the widget being written needs it.
 */

export const WIDGET_CONTRACT_MODULES = [
  "diagram",
  "chart",
  "interactive",
  "mockup",
  "art",
] as const;

export type WidgetContractModule = (typeof WIDGET_CONTRACT_MODULES)[number];

const CORE = `# Otto widget contract

A widget is a fragment of HTML or SVG rendered inline in the conversation,
inside a sandboxed frame. Write the fragment into \`show_widget\`'s
\`widget_code\`. Mode is detected from the code: starting with \`<svg\` means SVG,
anything else means HTML.

## Structure

- Fragments only. No DOCTYPE, no \`<html>\`, \`<head>\` or \`<body>\`. Content starts
  immediately. (A whole document is unwrapped to its body, but do not rely on it.)
- The container is \`display: block; width: 100%\`. Do not add a wrapper for it.
- Height is content-driven — the frame measures your content and sizes itself.
  Never \`position: fixed\`, and never set a height on \`html\`/\`body\`: both collapse
  the frame. For a modal or phone mockup, draw a normal-flow box that LOOKS like
  a viewport.
- No inner scrolling. The chat scrolls; the widget does not. \`overflow-x: auto\`
  on a wide table or code block is the one exception.
- The outer background is transparent. The host supplies the page background.
- Open an HTML widget with a visually-hidden one-sentence summary:
  \`<h2 class="sr-only">…</h2>\`. For SVG use \`role="img"\` with \`<title>\` and
  \`<desc>\`.
- Budget: ${WIDGET_MAX_CODE_CHARS.toLocaleString("en-US")} characters. Past that the fragment is cut.

## Theming — use these, never hard-coded colors

The widget must be correct in light AND dark. Every variable below is supplied
by the host and re-skinned when the user changes theme, so a hard-coded \`#fff\`
is a bug that only shows up for half the users.

Surfaces: \`--surface-0\` (base) \`--surface-1\` (subtle) \`--surface-2\` (elevated)
Role fills: \`--bg-accent\` \`--bg-danger\` \`--bg-success\` \`--bg-warning\`
Text: \`--text-primary\` \`--text-secondary\` \`--text-muted\`
Role text: \`--text-accent\` \`--text-danger\` \`--text-success\` \`--text-warning\`
Borders: \`--border\` \`--border-strong\` \`--border-stronger\`
Role borders: \`--border-accent\` \`--border-danger\` \`--border-success\` \`--border-warning\`
Type: \`--font-sans\` \`--font-mono\` \`--font-voice\` (serif)
Layout: \`--radius\` \`--radius-sm\` \`--pad-sm|md|lg|xl\` \`--gap-xs|sm|md|lg|xl\`

Categorical palette, for charts and diagrams — eight hues that stay legible in
both modes: \`--c-blue\` \`--c-teal\` \`--c-amber\` \`--c-red\` \`--c-green\`
\`--c-purple\` \`--c-pink\` \`--c-gray\`.

In SVG use the shorthand classes instead of writing \`fill="…"\`:
\`.c-blue\` … \`.c-gray\` set fill, \`.s-blue\` … \`.s-gray\` set stroke, and
\`.t\` / \`.ts\` / \`.th\` are the primary / secondary / muted text fills.

## Icons

\`<i class="ti ti-check"></i>\`, sized in \`em\`, inheriting \`currentColor\`. The set
is curated, not the full Tabler font — these names exist and nothing else does:

${WIDGET_ICON_NAMES.join(", ")}

## Talking back to the chat

- \`sendPrompt(text)\` sends a message to the chat as if the user typed it. Use it
  when the next step needs Claude to think. Do NOT use it for filtering,
  sorting, or arithmetic you can do in local JavaScript — a round trip the user
  pays for should buy reasoning, not a calculation.
- \`openLink(url)\` opens a URL through Otto's link confirmation. Plain
  \`<a href>\` clicks are routed the same way automatically.

Both are rate-limited and length-capped, and only work while the chat is on
screen. A widget cannot type into a conversation the user is not looking at.

## No network. None.

There is no CDN, no Google Fonts, no \`fetch\`, no XHR. Chart.js and D3 are NOT
available. Everything must be inline HTML, CSS, SVG and plain JavaScript, plus
\`data:\` images. This is not a limitation to work around with a clever loader —
the CSP blocks it, and a blocked resource renders as a visible error.

Charts are hand-rolled SVG. Read the \`chart\` module; it is genuinely not hard.

## Rendering

The fragment renders once, complete. Scripts run after it is in the DOM. Order
your code \`<style>\` → content → \`<script>\`; put SVG \`<defs>\` first.

## Modules

Call \`widget_contract\` again with a module name for detail:
${WIDGET_CONTRACT_MODULES.join(", ")}.
`;

const DIAGRAM = `# Module: diagram

Flowcharts, architectures, sequences, trees, state machines. Always SVG.

- Set \`viewBox\` and let width be 100%: \`<svg viewBox="0 0 720 360" width="100%"
  role="img" aria-labelledby="t d">\`, with \`<title id="t">\` and \`<desc id="d">\`.
- Fix the coordinate system first and lay out on a grid — nodes on multiples of
  20, one text baseline per row. Diagrams read as sloppy when boxes are 3px out.
- Node: \`<rect rx="8" class="c-gray" fill-opacity="0.10" stroke="currentColor"/>\`
  is a weak default. Prefer \`fill="var(--surface-2)" stroke="var(--border-strong)"\`
  and reserve the palette classes for meaning, not decoration.
- Labels: \`<text class="t" font-size="13" text-anchor="middle"
  dominant-baseline="middle">\`. Never rely on a font metric you cannot measure —
  keep labels short and give boxes generous padding.
- Edges: one \`<defs>\` marker, reused.
  \`<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6"
  markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z"
  fill="var(--border-stronger)"/></marker>\`
  then \`<path d="…" fill="none" stroke="var(--border-stronger)" marker-end="url(#a)"/>\`.
- Orthogonal edges (\`M x0 y0 H mx V y1 H x1\`) read better than diagonals for
  architecture; curves suit sequence and flow.
- Legend only when colour carries meaning. If there are three colours and no
  legend, the colours are decoration — use one.
- Dark mode is free if you only use the variables. Check that any
  \`fill-opacity\` you use still separates on \`--surface-0\` in both modes.
`;

const CHART = `# Module: chart

No Chart.js, no D3. Hand-rolled SVG — the shapes below cover almost everything.

Compute in JavaScript, emit SVG. Keep the maths in the template, not in
attributes, so the numbers stay readable.

## Bar chart

Pick a plot box, then map values into it:

\`\`\`
var W = 640, H = 280, P = { t: 16, r: 16, b: 28, l: 44 };
var iw = W - P.l - P.r, ih = H - P.t - P.b;
var max = Math.max.apply(null, data.map(function (d) { return d.value; }));
var bw = iw / data.length * 0.68;
var x = function (i) { return P.l + (i + 0.5) * (iw / data.length); };
var y = function (v) { return P.t + ih - (v / max) * ih; };
\`\`\`

Bars are \`<rect x={x(i)-bw/2} y={y(d.value)} width={bw} height={P.t+ih-y(d.value)}
rx="3" class="c-blue"/>\`. Baseline: one \`<line>\` at \`P.t + ih\` in \`--border\`.

## Line / area

\`points.map(function (p, i) { return (i ? "L" : "M") + x(i) + " " + y(p); }).join(" ")\`
for the line; append \`L\` back along the baseline and \`Z\` for the area, filled
at \`fill-opacity="0.15"\`. Stroke width 2, \`stroke-linejoin="round"\`,
\`fill="none"\` on the line itself.

## Axes and ticks

Four or five ticks, not ten. \`<text class="th" font-size="11">\` for labels,
\`text-anchor="end"\` on the y axis with \`dx="-6"\`, \`dominant-baseline="middle"\`.
Gridlines in \`--border\` at 0.5 opacity, horizontal only. Start the y axis at
zero for bars; a truncated bar axis misleads.

## Donut / progress

\`stroke-dasharray\` on a circle is the whole trick:
\`var c = 2 * Math.PI * r;\` then \`stroke-dasharray={c} stroke-dashoffset={c * (1 - pct)}\`
with \`transform="rotate(-90 cx cy)"\` and \`stroke-linecap="round"\`.

## Rules

- Colour encodes a series, never decoration. One series = one colour = \`--c-blue\`.
- Label the value directly on the mark when there are fewer than ~12 of them;
  it beats making the reader trace back to an axis.
- Number formatting is your job: \`toLocaleString\`, consistent decimal places.
- A table is often the better answer. If there are five numbers, draw a table.
`;

const INTERACTIVE = `# Module: interactive

Widgets that respond — filters, toggles, calculators, steppers, pickers.

- Handle it locally when it is filtering, sorting, formatting, or arithmetic.
  Call \`sendPrompt(text)\` only when the next step needs actual reasoning.
- Wire events in the trailing \`<script>\`, after the DOM exists. Delegate from a
  container rather than binding per row.
- Every control must show its state without hover: a selected button gets
  \`background: var(--bg-accent); border-color: var(--border-accent); color:
  var(--text-accent)\`, not just a shadow.
- Hit targets 32px minimum — widgets are read on phones.
- Focus is visible: \`outline: 2px solid var(--text-accent); outline-offset: 2px\`.
  Do not remove outlines.
- Do not hide content behind tabs, accordions or carousels. If it matters, show
  it; the widget has no scrollbar and the chat is already a scrolling surface.
- No \`alert\`, \`confirm\` or \`prompt\`.
- Growth is fine: the frame re-measures when your script changes the DOM, so a
  "show all" button that adds rows works. Avoid animating height — it makes the
  chat jump.

Example of the one call that earns a round trip:

\`\`\`
button.addEventListener("click", function () {
  sendPrompt("Explain why " + row.name + " regressed in Q3.");
});
\`\`\`
`;

const MOCKUP = `# Module: mockup

UI mockups, screen designs, before/after comparisons.

- A "screen" is a normal-flow \`<div>\` with a fixed width, a border, \`--radius\`
  and \`overflow: hidden\`. Never \`position: fixed\` — it collapses the frame.
- Phone frame: an outer div at ~300px wide with \`border-radius: 28px\` and
  \`padding: 8px\`, an inner screen at \`--surface-0\`. Draw a status bar row;
  it does more for realism than any shadow.
- Side-by-side comparisons: CSS grid, \`grid-template-columns: 1fr 1fr\`,
  \`gap: var(--gap-lg)\`, and a caption above each half in \`--text-muted\`.
- Use real copy, not lorem ipsum. Fake data should be plausible and specific.
- Depth comes from surface steps and borders, not shadows. \`--surface-0\` behind,
  \`--surface-1\` for a panel, \`--surface-2\` for a control on that panel.
- Annotate with numbered callouts (a small circle in \`--bg-accent\` with
  \`--text-accent\` text) and a legend under the mockup.
- Do not mimic a specific product's branding. Mock the layout, not the logo.
`;

const ART = `# Module: art

Logos, wordmarks, illustrations, decorative SVG.

- SVG only, with an explicit \`viewBox\` and \`role="img"\` plus \`<title>\`/\`<desc>\`.
- Build from geometry: \`<path>\`, \`<circle>\`, \`<rect rx>\`, \`<polygon>\`. Keep the
  path data on a grid you chose (a 100- or 120-unit box divides cleanly).
- \`<defs>\` first: gradients, clip paths, masks, reused symbols. Reference with
  \`url(#id)\`. Give ids a prefix — several widgets can share a page.
- Monochrome first. A mark that only works in colour is a weak mark; get it
  right in \`currentColor\`, then add the palette.
- For anything that must sit on both themes, use \`currentColor\` or the \`--c-*\`
  variables rather than fixed hex. Test mentally against \`--surface-0\` light and
  dark.
- Optical alignment beats mathematical alignment: a circle next to a square
  needs to be slightly larger to look the same size, and text baselines usually
  want nudging by a unit or two.
- Keep it under a few hundred path commands. This is a fragment in a chat, not
  an asset pipeline.
`;

const MODULE_TEXT: Record<WidgetContractModule, string> = {
  diagram: DIAGRAM,
  chart: CHART,
  interactive: INTERACTIVE,
  mockup: MOCKUP,
  art: ART,
};

export function readWidgetContract(module?: string | null): string {
  const requested = module?.trim().toLowerCase();
  if (!requested) {
    return CORE;
  }
  const known = WIDGET_CONTRACT_MODULES.find((candidate) => candidate === requested);
  if (!known) {
    return `Unknown module "${requested}". Available: ${WIDGET_CONTRACT_MODULES.join(", ")}.\n\n${CORE}`;
  }
  return MODULE_TEXT[known];
}
