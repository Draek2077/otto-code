import {
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  showTooltip,
  type DecorationSet,
  type Tooltip,
} from "@codemirror/view";
import type {
  EditorDiagnostic,
  EditorDiagnosticSeverity,
  EditorThemeSpec,
} from "./editor-contract";

/**
 * Problem markers in the editor: the squiggle, the gutter glyph, and the explanation.
 *
 * Deliberately hand-rolled rather than `@codemirror/lint`. That package assumes it owns the
 * lint lifecycle (a source function it polls) where ours is a push from the daemon, and it
 * installs its own `hoverTooltip` — which would fight the language-server hover already on
 * this editor for the same pointer rest, producing two cards for one gesture. Here the
 * diagnostic is rendered *into* that one card instead (see `renderDiagnosticList`, called
 * from editor-core's hover source).
 *
 * Positions are mapped through document changes, so a squiggle follows the text it marks
 * while you type rather than staying pinned to a stale offset until the server republishes.
 * It is still a claim about an older version of the buffer — the honest alternative would be
 * to clear every marker on the first keystroke, which flickers the gutter constantly.
 *
 * No React, no app-store imports: this module is bundled into the native webview.
 */

/** Replace the whole problem set. Never a delta — see the store's note on why. */
export const setEditorDiagnostics = StateEffect.define<readonly EditorDiagnostic[]>();

const SEVERITY_RANK: Readonly<Record<EditorDiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

interface DiagnosticRange {
  from: number;
  to: number;
  diagnostic: EditorDiagnostic;
}

/**
 * 1-based line/column to a document offset, clamped.
 *
 * Clamping is not defensive padding: diagnostics describe the buffer as the server last saw
 * it, and between the publish and the render the user may have deleted the line entirely. An
 * unclamped offset throws inside CM6 and takes the whole editor down with it.
 */
function offsetAt(state: EditorState, line: number, column: number): number {
  const lineNumber = Math.max(1, Math.min(line, state.doc.lines));
  const target = state.doc.line(lineNumber);
  return Math.min(target.from + Math.max(0, column - 1), target.to);
}

function toRanges(state: EditorState, items: readonly EditorDiagnostic[]): DiagnosticRange[] {
  const ranges: DiagnosticRange[] = [];

  for (const diagnostic of items) {
    const from = offsetAt(state, diagnostic.line, diagnostic.column);
    const to = offsetAt(state, diagnostic.endLine, diagnostic.endColumn);
    // A marker with no extent cannot be drawn or hovered. The daemon already widens
    // zero-width server ranges; this catches the ones collapsed by clamping above.
    ranges.push({ from, to: to > from ? to : Math.min(from + 1, state.doc.length), diagnostic });
  }

  return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
}

function buildDecorations(state: EditorState, items: readonly EditorDiagnostic[]): DecorationSet {
  const ranges = toRanges(state, items);
  return Decoration.set(
    ranges
      // A zero-length range survives only in an empty document, where there is
      // nothing to underline at all.
      .filter((range) => range.to > range.from)
      .map((range) =>
        Decoration.mark({
          // One class, not a shared base plus a severity modifier: the theme carries the
          // whole underline per severity so the colour cannot go missing.
          class: `cm-otto-diagnostic-${range.diagnostic.severity}`,
          // Carried on the spec so hover can recover the diagnostic from the mapped
          // range rather than re-deriving positions that have since moved.
          diagnostic: range.diagnostic,
        }).range(range.from, range.to),
      ),
    true,
  );
}

const diagnosticsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setEditorDiagnostics)) {
        next = buildDecorations(transaction.state, effect.value);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Diagnostics whose range covers this offset, worst first.
 *
 * Read from the mapped decoration set rather than the original list, so this stays correct
 * after edits have shifted everything.
 */
export function diagnosticsAtPos(state: EditorState, pos: number): EditorDiagnostic[] {
  const found: EditorDiagnostic[] = [];

  state.field(diagnosticsField).between(pos, pos, (_from, _to, value) => {
    const diagnostic = (value.spec as { diagnostic?: EditorDiagnostic }).diagnostic;
    if (diagnostic !== undefined) {
      found.push(diagnostic);
    }
  });

  return found.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/**
 * Every mapped diagnostic in the document, in document order.
 *
 * A visitor rather than an array: the overview ruler walks the whole set on every
 * redraw and only keeps one mark per few pixels, so materialising a list of a few
 * thousand problems just to throw it away is pure garbage.
 *
 * Reads the field optionally — the ruler is a separate extension, and an editor
 * assembled with one and not the other must draw an empty lane, not throw.
 */
export function eachDiagnosticPosition(
  state: EditorState,
  visit: (from: number, diagnostic: EditorDiagnostic) => void,
): void {
  const field = state.field(diagnosticsField, false);
  if (field === undefined) {
    return;
  }
  field.between(0, state.doc.length, (from, _to, value) => {
    const diagnostic = (value.spec as { diagnostic?: EditorDiagnostic }).diagnostic;
    if (diagnostic !== undefined) {
      visit(from, diagnostic);
    }
  });
}

/** Worst first, for callers ranking a set they collected themselves. */
export function compareDiagnosticSeverity(
  a: EditorDiagnosticSeverity,
  b: EditorDiagnosticSeverity,
): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

/** Every diagnostic touching the line that contains `offset`, worst first. */
function diagnosticsOnLine(state: EditorState, offset: number): EditorDiagnostic[] {
  const line = state.doc.lineAt(offset);
  const found: EditorDiagnostic[] = [];

  state.field(diagnosticsField).between(line.from, line.to, (_from, _to, value) => {
    const diagnostic = (value.spec as { diagnostic?: EditorDiagnostic }).diagnostic;
    if (diagnostic !== undefined) {
      found.push(diagnostic);
    }
  });

  return found.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

class DiagnosticGutterMarker extends GutterMarker {
  private readonly severity: EditorDiagnosticSeverity;

  constructor(severity: EditorDiagnosticSeverity) {
    super();
    this.severity = severity;
  }

  eq(other: DiagnosticGutterMarker): boolean {
    return other.severity === this.severity;
  }

  toDOM(): Node {
    const dot = document.createElement("div");
    dot.className = `cm-otto-diagnostic-dot cm-otto-diagnostic-dot-${this.severity}`;
    return dot;
  }
}

/** Invisible, and the reason the gutter does not change width when the first error lands. */
class DiagnosticSpacer extends GutterMarker {
  toDOM(): Node {
    const spacer = document.createElement("div");
    spacer.className = "cm-otto-diagnostic-dot";
    return spacer;
  }
}

/** One marker per line, taking the worst severity on it. */
function gutterMarkers(view: EditorView): RangeSet<GutterMarker> {
  const builder: { from: number; value: GutterMarker }[] = [];
  const seenLines = new Set<number>();
  const worstByLine = new Map<number, EditorDiagnosticSeverity>();

  for (const { from, to } of view.visibleRanges) {
    view.state.field(diagnosticsField).between(from, to, (start, _end, value) => {
      const diagnostic = (value.spec as { diagnostic?: EditorDiagnostic }).diagnostic;
      if (diagnostic === undefined) {
        return;
      }
      const lineStart = view.state.doc.lineAt(start).from;
      const current = worstByLine.get(lineStart);
      if (current === undefined || SEVERITY_RANK[diagnostic.severity] < SEVERITY_RANK[current]) {
        worstByLine.set(lineStart, diagnostic.severity);
      }
      seenLines.add(lineStart);
    });
  }

  for (const lineStart of [...seenLines].sort((a, b) => a - b)) {
    const severity = worstByLine.get(lineStart);
    if (severity !== undefined) {
      builder.push({ from: lineStart, value: new DiagnosticGutterMarker(severity) });
    }
  }

  return RangeSet.of(
    builder.map((entry) => entry.value.range(entry.from)),
    true,
  );
}

/** Which line's gutter the pointer is resting on, or null. */
const setGutterHover = StateEffect.define<number | null>();

export interface DiagnosticsExtensionOptions {
  /**
   * Read at render time rather than captured, so a theme switch reaches tooltips
   * created afterwards — same reason the hover tooltip takes a getter.
   */
  readTheme: () => EditorThemeSpec;
}

/**
 * Hovering a gutter glyph explains it. `hoverTooltip` only covers the content area, so the
 * gutter needs its own — and it is what the user reaches for when the squiggle is on a line
 * they are not pointing at.
 */
function gutterTooltipField(readTheme: () => EditorThemeSpec): Extension {
  const field = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, transaction) {
      let next = value;
      for (const effect of transaction.effects) {
        if (!effect.is(setGutterHover)) {
          continue;
        }
        if (effect.value === null) {
          next = null;
          continue;
        }
        const items = diagnosticsOnLine(transaction.state, effect.value);
        next =
          items.length === 0
            ? null
            : {
                pos: transaction.state.doc.lineAt(effect.value).from,
                above: false,
                strictSide: false,
                arrow: false,
                create: () => ({ dom: renderDiagnosticList(items, readTheme()) }),
              };
      }
      return next;
    },
    provide: (self) => showTooltip.from(self),
  });

  return field;
}

export function createDiagnosticsExtension(options: DiagnosticsExtensionOptions): Extension {
  /** Last line the pointer was reported over, so a move within one line is not a redraw. */
  let hoveredLine: number | null = null;

  return [
    diagnosticsField,
    gutterTooltipField(options.readTheme),
    gutter({
      class: "cm-otto-diagnostic-gutter",
      markers: gutterMarkers,
      initialSpacer: () => new DiagnosticSpacer(),
      domEventHandlers: {
        // `mousemove`, because a gutter marker is not text and `hoverTooltip` only covers
        // the content area. Guarded on the line actually changing: the raw event fires per
        // pixel of travel, and a transaction per pixel is a redraw per pixel.
        mousemove: (view, line) => {
          if (line.from === hoveredLine) {
            return false;
          }
          hoveredLine = line.from;
          view.dispatch({ effects: setGutterHover.of(line.from) });
          return false;
        },
        mouseleave: (view) => {
          hoveredLine = null;
          view.dispatch({ effects: setGutterHover.of(null) });
          return false;
        },
        // Clicking a marker selects what it is about, which is the fastest way to
        // act on it — the caret lands exactly on the offending span.
        mousedown: (view, line) => {
          const items = diagnosticsOnLine(view.state, line.from);
          if (items.length === 0) {
            return false;
          }
          const first = items[0];
          view.dispatch({
            selection: {
              anchor: offsetAt(view.state, first.line, first.column),
              head: offsetAt(view.state, first.endLine, first.endColumn),
            },
            userEvent: "select.pointer",
          });
          view.focus();
          return true;
        },
      },
    }),
  ];
}

/**
 * The explanation itself — the point of the whole feature. A red squiggle that cannot say
 * why is decoration; this is the compiler's or linter's own words.
 *
 * Three parts per entry, because that is what the servers actually send: the message, an
 * optional `help:` continuation (oxc's diagnostics carry a suggested fix that way), and the
 * attribution — which linter and which rule, with a link to the rule's documentation when
 * the server provided one.
 */
export function renderDiagnosticList(
  items: readonly EditorDiagnostic[],
  spec: EditorThemeSpec,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "cm-otto-hover cm-otto-diagnostic-card";

  items.forEach((item, index) => {
    if (index > 0) {
      const divider = document.createElement("div");
      divider.className = "cm-otto-hover-divider";
      root.appendChild(divider);
    }
    root.appendChild(renderDiagnostic(item, spec));
  });

  return root;
}

function renderDiagnostic(item: EditorDiagnostic, spec: EditorThemeSpec): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "cm-otto-diagnostic-entry";

  const { headline, help } = splitHelp(item.message);

  const row = document.createElement("div");
  row.className = "cm-otto-diagnostic-headline";

  const badge = document.createElement("span");
  badge.className = "cm-otto-diagnostic-badge";
  badge.style.backgroundColor = spec.diagnostic[item.severity];
  row.appendChild(badge);

  const text = document.createElement("span");
  text.textContent = headline;
  row.appendChild(text);
  wrapper.appendChild(row);

  if (help !== null) {
    const hint = document.createElement("div");
    hint.className = "cm-otto-diagnostic-help";
    hint.textContent = help;
    wrapper.appendChild(hint);
  }

  wrapper.appendChild(renderAttribution(attributionOf(item), item.codeHref));

  return wrapper;
}

function renderAttribution(label: string, href: string | undefined): HTMLElement {
  if (href === undefined) {
    const plain = document.createElement("div");
    plain.className = "cm-otto-diagnostic-source";
    plain.textContent = label;
    return plain;
  }

  const link = document.createElement("a");
  link.className = "cm-otto-diagnostic-source cm-otto-diagnostic-link";
  link.textContent = label;
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  return link;
}

/**
 * oxc-family servers put the suggested fix in the message after a newline, prefixed
 * `help:`. Splitting it out is presentation, not protocol — the wire keeps the message the
 * server sent, so a client that does not know the convention still shows all of it.
 */
function splitHelp(message: string): { headline: string; help: string | null } {
  const match = /\n\s*help:\s*/.exec(message);
  if (match === null) {
    return { headline: message.trim(), help: null };
  }
  return {
    headline: message.slice(0, match.index).trim(),
    help: message.slice(match.index + match[0].length).trim(),
  };
}

/**
 * `Error · oxc · eslint(no-unused-vars)`.
 *
 * The severity leads, and it is named rather than left to the colour. tsserver emits
 * hint-severity suggestions by the dozen on plain JavaScript, and a user looking at a grey
 * underline has no way to tell "the compiler is offering advice" from "the colour is wrong".
 * Saying which it is costs one word.
 */
function attributionOf(item: EditorDiagnostic): string {
  const parts = [SEVERITY_LABEL[item.severity], item.source, item.code].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.join(" · ");
}

const SEVERITY_LABEL: Readonly<Record<EditorDiagnosticSeverity, string>> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
  hint: "Hint",
};
