import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from "@codemirror/view";
import type { EditorDiagnosticSeverity, EditorThemeSpec } from "./editor-contract";
import { compareDiagnosticSeverity, eachDiagnosticPosition } from "./editor-diagnostics";
import {
  isRulerScrollable,
  RULER_MARK_HEIGHT_PX,
  rulerBandRect,
  rulerBucket,
  rulerMarkTop,
  rulerScrollTopForTrackY,
  rulerThumbRect,
  type RulerMetrics,
} from "./editor-overview-ruler.math";

/**
 * The overview ruler: a full-height lane down the right edge that answers two
 * questions at a glance and takes one gesture.
 *
 * Where am I - the viewport thumb. Where is everything I care about - problem
 * marks, search hits and the caret, drawn at the position they occupy in the
 * WHOLE document rather than in the part currently rendered. Click or drag the
 * lane and the document scrolls there.
 *
 * It replaces the vertical scrollbar rather than sitting beside it. The lane is
 * the scrollbar: an IDE that draws both spends 26px of the right edge saying the
 * same thing twice, and a thumb that hides the marks it overlaps is worse than a
 * thumb that is translucent over them.
 *
 * Marks come from state the editor already holds - the diagnostics field, the
 * search query, the selection - so there is no new data channel and nothing to
 * keep in sync. Git-changed lines are the obvious fourth lane and are deliberately
 * absent: the editor is not told what the file looked like at HEAD.
 *
 * No React, no app-store imports: this module is bundled into the native webview,
 * where a DOM pointer gesture works exactly as it does on web (the platform rule
 * against pointer events applies to React Native views, not to a webview document).
 */

/**
 * Search hits stop being collected here. Past a few hundred marks in a lane the
 * bucket collapse has already turned them into a solid bar, so counting further
 * only costs a regex walk of the rest of the file on every redraw.
 */
const MAX_MARKED_MATCHES = 2000;

/** Same reasoning, for a server having a very bad day about a generated file. */
const MAX_MARKED_DIAGNOSTICS = 4000;

/**
 * Selection bands drawn per redraw. Multi-cursor is the only way to exceed a
 * handful, and a document with 400 simultaneous ranges is one where the bands
 * have already merged into a solid column.
 */
const MAX_SELECTION_BANDS = 400;

/** The active hit's step up in size. Two pixels taller is visible; four is a blob. */
const ACTIVE_MATCH_MARK_HEIGHT_PX = RULER_MARK_HEIGHT_PX + 2;

type RulerLane = "problem" | "match";

interface RulerMark {
  /** Painted offset from the top of the track, px. */
  top: number;
  lane: RulerLane;
  severity?: EditorDiagnosticSeverity;
  /**
   * The hit the user is standing on. Marked out by SIZE, not by another colour:
   * in the dark themes `statusWarningStrong` and `statusWarning` are the same
   * amber, so a second token would differentiate nothing - while a full-width,
   * taller mark reads as "this one" in every theme.
   */
  active?: boolean;
  /** Native tooltip text - the server's own words, or undefined for a search hit. */
  title?: string;
}

export interface OverviewRulerOptions {
  /**
   * Read at draw time rather than captured, so a theme switch reaches the lane
   * without rebuilding the extension - the same getter idiom the diagnostics and
   * hover extensions use.
   */
  readTheme: () => EditorThemeSpec;
}

export function createOverviewRulerExtension(options: OverviewRulerOptions) {
  return ViewPlugin.define((view) => new OverviewRuler(view, options.readTheme));
}

class OverviewRuler implements PluginValue {
  private readonly view: EditorView;
  private readonly readTheme: () => EditorThemeSpec;
  private readonly track: HTMLElement;
  private readonly selectionLayer: HTMLElement;
  private readonly marksLayer: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly cursorMark: HTMLElement;
  private readonly resizeObserver: ResizeObserver | null = null;

  /**
   * Track height, cached from the observer instead of read per draw. The thumb
   * moves on every scroll event, and measuring the element there would make each
   * one a forced layout of the whole editor.
   */
  private trackHeight = 0;
  private frame: number | null = null;
  private marksDirty = true;
  private dragging = false;

  constructor(view: EditorView, readTheme: () => EditorThemeSpec) {
    this.view = view;
    this.readTheme = readTheme;

    this.track = document.createElement("div");
    this.track.className = "cm-otto-overview";
    // Not a control anyone should land on with Tab: the keyboard already has
    // Page Up/Down and go-to-line, which do this better than a scrub gesture.
    this.track.setAttribute("aria-hidden", "true");

    // First child, so selection bands sit BEHIND the marks: a selection is
    // context for what it contains, and it must never hide an error inside it.
    this.selectionLayer = document.createElement("div");
    this.selectionLayer.className = "cm-otto-overview-selections";
    this.track.appendChild(this.selectionLayer);

    this.marksLayer = document.createElement("div");
    this.marksLayer.className = "cm-otto-overview-marks";
    this.track.appendChild(this.marksLayer);

    this.cursorMark = document.createElement("div");
    this.cursorMark.className = "cm-otto-overview-cursor";
    this.track.appendChild(this.cursorMark);

    // Last child, so it paints over the marks - and is translucent, so the marks
    // under the viewport stay readable.
    this.thumb = document.createElement("div");
    this.thumb.className = "cm-otto-overview-thumb";
    this.track.appendChild(this.thumb);

    // A sibling of `.cm-scroller` inside `.cm-editor`, which CM6 positions
    // relative. The lane it occupies is reserved by the theme's padding on the
    // scroller (see editor-core), so it never covers text.
    view.dom.appendChild(this.track);

    this.track.addEventListener("pointerdown", this.onPointerDown);
    this.track.addEventListener("pointermove", this.onPointerMove);
    this.track.addEventListener("pointerup", this.onPointerUp);
    this.track.addEventListener("pointercancel", this.onPointerUp);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });

    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.track);
    }
    this.trackHeight = this.track.clientHeight;
    this.schedule(true);
  }

  update(update: ViewUpdate): void {
    // `geometryChanged` covers the case that matters most and is least obvious:
    // CM6 replacing a height ESTIMATE with a measurement as you scroll into
    // unrendered territory moves every mark below it.
    const structural =
      update.docChanged ||
      update.geometryChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      // Diagnostics arrive as an effect, as do search-query and panel changes.
      // Rare next to typing, so testing for any effect at all is cheaper than
      // importing three modules' worth of effect types to tell them apart.
      update.transactions.some((transaction) => transaction.effects.length > 0);
    this.schedule(structural);
  }

  destroy(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.resizeObserver?.disconnect();
    this.track.removeEventListener("pointerdown", this.onPointerDown);
    this.track.removeEventListener("pointermove", this.onPointerMove);
    this.track.removeEventListener("pointerup", this.onPointerUp);
    this.track.removeEventListener("pointercancel", this.onPointerUp);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.track.remove();
  }

  private readonly onResize = (entries: readonly ResizeObserverEntry[]): void => {
    const height = entries[entries.length - 1]?.contentRect.height;
    if (height === undefined || Math.abs(height - this.trackHeight) < 0.5) {
      return;
    }
    this.trackHeight = height;
    // Every mark's position is a fraction of this, so a resize redraws all of them.
    this.schedule(true);
  };

  private readonly onScroll = (): void => {
    this.schedule(false);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    // Primary button only; a right-click on the lane should reach nothing rather
    // than teleport the document.
    if (event.button !== 0) {
      return;
    }
    this.dragging = true;
    this.track.setPointerCapture(event.pointerId);
    this.scrubTo(event);
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    this.scrubTo(event);
    event.preventDefault();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    if (this.track.hasPointerCapture(event.pointerId)) {
      this.track.releasePointerCapture(event.pointerId);
    }
  };

  /**
   * Scroll so the pointed-at part of the document is centred.
   *
   * Deliberately scroll-only: the caret does not move and focus does not leave
   * whatever had it. This is a "let me look over there" gesture, and a version of
   * it that also retargeted the caret would lose the user's place every time they
   * glanced at an error.
   */
  private scrubTo(event: PointerEvent): void {
    const metrics = this.metrics();
    if (!isRulerScrollable(metrics)) {
      return;
    }
    const trackY = event.clientY - this.track.getBoundingClientRect().top;
    this.view.scrollDOM.scrollTop = rulerScrollTopForTrackY(trackY, metrics);
  }

  private metrics(): RulerMetrics {
    const scroller = this.view.scrollDOM;
    return {
      trackHeight: this.trackHeight,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    };
  }

  /**
   * One rAF for everything. Scrolling asks for a thumb move only; anything that
   * can shift a mark raises `marksDirty` so the pending frame does both.
   */
  private schedule(marksDirty: boolean): void {
    if (marksDirty) {
      this.marksDirty = true;
    }
    if (this.frame !== null || typeof requestAnimationFrame !== "function") {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  private draw(): void {
    const width = this.readTheme().overviewRulerWidth;
    if (width <= 0) {
      this.track.style.display = "none";
      return;
    }
    this.track.style.display = "";
    this.track.style.width = `${width}px`;

    const metrics = this.metrics();
    if (metrics.trackHeight <= 0) {
      // Laid out at zero height - mounted but not yet measured. The observer
      // will call back with a real height and redraw.
      return;
    }

    const scrollable = isRulerScrollable(metrics);
    if (scrollable) {
      const rect = rulerThumbRect(this.view.scrollDOM.scrollTop, metrics);
      this.thumb.style.display = "";
      this.thumb.style.height = `${rect.height}px`;
      this.thumb.style.transform = `translateY(${rect.top}px)`;
    } else {
      // A thumb spanning the whole track carries no information.
      this.thumb.style.display = "none";
    }

    if (this.marksDirty) {
      this.marksDirty = false;
      this.drawSelections(metrics);
      this.drawMarks(metrics);
      this.drawCursor(metrics);
    }
  }

  /**
   * Selected ranges as bands, so a selection you have scrolled away from is still
   * findable - and so "how much of this file did I just select" has an answer
   * that does not involve scrolling to both ends of it.
   *
   * Empty ranges are skipped: a bare caret is already drawn by `drawCursor`, and a
   * multi-cursor's extra carets are not a selection.
   */
  private drawSelections(metrics: RulerMetrics): void {
    const fragment = document.createDocumentFragment();
    let drawn = 0;
    for (const range of this.view.state.selection.ranges) {
      if (range.empty) {
        continue;
      }
      if (drawn >= MAX_SELECTION_BANDS) {
        break;
      }
      drawn += 1;
      const rect = rulerBandRect(
        this.contentTopAt(range.from),
        this.contentBottomAt(range.to),
        metrics,
      );
      const band = document.createElement("div");
      band.className = "cm-otto-overview-band";
      band.style.transform = `translateY(${rect.top}px)`;
      band.style.height = `${rect.height}px`;
      fragment.appendChild(band);
    }
    this.selectionLayer.replaceChildren(fragment);
  }

  private drawMarks(metrics: RulerMetrics): void {
    const marks = this.collectMarks(metrics);
    const fragment = document.createDocumentFragment();
    for (const mark of marks) {
      fragment.appendChild(renderMark(mark));
    }
    // Replaced wholesale rather than diffed. The set is bounded by the bucket
    // collapse - one element per few pixels of track - so this is a few dozen
    // nodes on a real file, and a diff would cost more to maintain than to skip.
    this.marksLayer.replaceChildren(fragment);
  }

  private drawCursor(metrics: RulerMetrics): void {
    const state = this.view.state;
    const head = state.selection.main.head;
    const top = rulerMarkTop(this.contentTopAt(head), metrics);
    this.cursorMark.style.transform = `translateY(${top}px)`;
  }

  /**
   * Collect one mark per (lane, band). Worst severity wins a problem band, so a
   * warning can never hide the error three lines under it.
   */
  private collectMarks(metrics: RulerMetrics): RulerMark[] {
    const state = this.view.state;
    const byBand = new Map<string, RulerMark>();

    let seenDiagnostics = 0;
    eachDiagnosticPosition(state, (from, diagnostic) => {
      if (seenDiagnostics >= MAX_MARKED_DIAGNOSTICS) {
        return;
      }
      seenDiagnostics += 1;
      const top = rulerMarkTop(this.contentTopAt(from), metrics);
      const key = `problem:${rulerBucket(top)}`;
      const existing = byBand.get(key);
      if (
        existing?.severity !== undefined &&
        compareDiagnosticSeverity(existing.severity, diagnostic.severity) <= 0
      ) {
        return;
      }
      byBand.set(key, {
        top,
        lane: "problem",
        severity: diagnostic.severity,
        title: diagnostic.message,
      });
    });

    // Gated on the panel being open, not on the query being non-empty: closing
    // find leaves the last query in state, and marks for a search the user has
    // dismissed are marks for something that is no longer highlighted anywhere.
    if (searchPanelOpen(state)) {
      const query = getSearchQuery(state);
      if (query.search && query.valid) {
        const cursor = query.getCursor(state) as Iterator<{ from: number; to: number }>;
        const { main } = state.selection;
        let seen = 0;
        for (let step = cursor.next(); !step.done; step = cursor.next()) {
          seen += 1;
          if (seen > MAX_MARKED_MATCHES) {
            break;
          }
          // The hit the selection is sitting exactly on is the one find is
          // "at" - the same test the match counter in the status strip uses.
          const active = step.value.from === main.from && step.value.to === main.to;
          const top = rulerMarkTop(this.contentTopAt(step.value.from), metrics);
          const key = `match:${rulerBucket(top)}`;
          const existing = byBand.get(key);
          // The active hit takes its band from an ordinary one it shares with:
          // stepping through results has to move a visible marker, and it cannot
          // if the neighbour three lines up already claimed the band.
          if (existing === undefined || (active && existing.active !== true)) {
            byBand.set(key, { top, lane: "match", active });
          }
        }
      }
    }

    return [...byBand.values()];
  }

  /**
   * Scroll-space offset of the line containing `pos`.
   *
   * `lineBlockAt` is the height map, which is the only source that agrees with
   * `scrollTop` for lines that have never been rendered - a `coordsAtPos` would
   * be exact for the viewport and null for the 90% of a long file that is not in it.
   */
  private contentTopAt(pos: number): number {
    return this.view.lineBlockAt(this.clampToDoc(pos)).top;
  }

  /** The BOTTOM of the line containing `pos` - a selection's last line is included in it. */
  private contentBottomAt(pos: number): number {
    return this.view.lineBlockAt(this.clampToDoc(pos)).bottom;
  }

  private clampToDoc(pos: number): number {
    return Math.max(0, Math.min(pos, this.view.state.doc.length));
  }
}

function markClassName(mark: RulerMark): string {
  if (mark.lane === "problem") {
    return `cm-otto-overview-mark cm-otto-overview-mark-problem cm-otto-overview-mark-${mark.severity}`;
  }
  const base = "cm-otto-overview-mark cm-otto-overview-mark-match";
  return mark.active === true ? `${base} cm-otto-overview-mark-match-active` : base;
}

function renderMark(mark: RulerMark): HTMLElement {
  const element = document.createElement("div");
  element.className = markClassName(mark);
  element.style.transform = `translateY(${mark.top}px)`;
  element.style.height = `${
    mark.active === true ? ACTIVE_MATCH_MARK_HEIGHT_PX : RULER_MARK_HEIGHT_PX
  }px`;
  if (mark.title !== undefined) {
    // The platform tooltip, not a CM6 one: CM6 tooltips are positioned in
    // document coordinates and this element is outside the content. `title` is
    // also the one explanation that costs no layout and works in the webview.
    element.title = mark.title;
  }
  return element;
}
