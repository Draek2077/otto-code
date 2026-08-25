// DOM-write attribution for a performance capture.
//
// Long-frame attribution can say a frame was 90% forced style/layout inside an
// input handler; it cannot say what the app wrote to the DOM to make that
// layout expensive. This module can: while a capture runs, a MutationObserver
// on the document records every mutation batch (React commits one batch per
// render pass) with counts by kind, the attribute names touched, and the
// nearest labelled ancestors of the mutated nodes. CSSOM rule inserts are
// counted alongside, because inserting a stylesheet rule invalidates style for
// the whole document - the one write that makes a 25k-node layout pay on a
// single keystroke.
//
// Capture-scoped on purpose: observing every mutation on a large streaming
// document is not free, and the capture is the only consumer. It starts with
// `startPerformanceCapture` and stops with the save, so the always-on monitor
// keeps its "must not become the cost it hunts" invariant.

import { getGlobalSingleton } from "./global-singleton";

export interface DomWriteBatch {
  /** Epoch ms when the observer delivered the batch. */
  at: number;
  records: number;
  childList: number;
  attributes: number;
  characterData: number;
  /** Nodes added and removed across childList records. */
  nodesAdded: number;
  nodesRemoved: number;
  /** Attribute names by count, most frequent first. */
  attributeNames: Array<{ name: string; count: number }>;
  /** Nearest labelled ancestors of mutated nodes, by count, most frequent first. */
  targets: Array<{ label: string; count: number }>;
  /** CSSOM rules inserted since the previous batch. */
  cssRulesInserted: number;
}

export interface DomWriteReport {
  supported: boolean;
  /** Epoch ms the observer started, or null when it never ran. */
  observedSince: number | null;
  /** Batches delivered in total, including ones the ring dropped. */
  totalBatches: number;
  totalRecords: number;
  totalCssRulesInserted: number;
  batches: DomWriteBatch[];
}

/** Batches kept. React commits one per render pass; typing is one per key. */
export const DOM_WRITE_RING_CAPACITY = 300;
/** Records labelled per batch; the rest are counted only. Labelling walks ancestors. */
export const DOM_WRITE_LABELLED_RECORDS = 300;
export const DOM_WRITE_TOP_N = 6;
const LABEL_ANCESTOR_DEPTH = 8;

interface DomWriteRuntime {
  observer: MutationObserver | null;
  observedSince: number | null;
  ring: DomWriteBatch[];
  totalBatches: number;
  totalRecords: number;
  totalCssRulesInserted: number;
  /** insertRule calls since the last batch was recorded. */
  cssRulesSinceLastBatch: number;
  cssPatched: boolean;
}

const runtime = getGlobalSingleton<DomWriteRuntime>("otto.diagnostics.domWriteAttribution", () => ({
  observer: null,
  observedSince: null,
  ring: [],
  totalBatches: 0,
  totalRecords: 0,
  totalCssRulesInserted: 0,
  cssRulesSinceLastBatch: 0,
  cssPatched: false,
}));

function topCounts(counts: Map<string, number>, limit: number): Array<[string, number]> {
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit);
}

/**
 * A short identity for the nearest ancestor worth naming: a test id, an id,
 * or a tag with its first class token. Falls back to the mutated node itself.
 */
export function labelTarget(node: Node | null): string {
  let current: Node | null = node;
  let fallback = "";
  for (let depth = 0; current && depth < LABEL_ANCESTOR_DEPTH; depth += 1) {
    if (current.nodeType === 1) {
      const element = current as Element;
      const testId = element.getAttribute("data-testid");
      if (testId) return `[data-testid=${testId}]`;
      if (element.id) return `#${element.id}`;
      if (!fallback) {
        const cls = element.getAttribute("class")?.split(/\s+/)[0];
        fallback = cls ? `${element.tagName.toLowerCase()}.${cls}` : element.tagName.toLowerCase();
      }
    }
    current = current.parentNode;
  }
  return fallback || (node ? `#${node.nodeName.toLowerCase()}` : "(detached)");
}

/** Pure shaping of one observer delivery, testable without a live document. */
export function summarizeMutationBatch(
  records: readonly MutationRecord[],
  cssRulesInserted: number,
  at: number,
): DomWriteBatch {
  let childList = 0;
  let attributes = 0;
  let characterData = 0;
  let nodesAdded = 0;
  let nodesRemoved = 0;
  const attributeNames = new Map<string, number>();
  const targets = new Map<string, number>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.type === "childList") {
      childList += 1;
      nodesAdded += record.addedNodes.length;
      nodesRemoved += record.removedNodes.length;
    } else if (record.type === "attributes") {
      attributes += 1;
      const name = record.attributeName ?? "(unknown)";
      attributeNames.set(name, (attributeNames.get(name) ?? 0) + 1);
    } else {
      characterData += 1;
    }
    if (index < DOM_WRITE_LABELLED_RECORDS) {
      const label = labelTarget(record.target);
      targets.set(label, (targets.get(label) ?? 0) + 1);
    }
  }
  return {
    at,
    records: records.length,
    childList,
    attributes,
    characterData,
    nodesAdded,
    nodesRemoved,
    attributeNames: topCounts(attributeNames, DOM_WRITE_TOP_N).map(([name, count]) => ({
      name,
      count,
    })),
    targets: topCounts(targets, DOM_WRITE_TOP_N).map(([label, count]) => ({ label, count })),
    cssRulesInserted,
  };
}

function recordBatch(batch: DomWriteBatch): void {
  runtime.totalBatches += 1;
  runtime.totalRecords += batch.records;
  runtime.ring.push(batch);
  if (runtime.ring.length > DOM_WRITE_RING_CAPACITY) {
    runtime.ring.splice(0, runtime.ring.length - DOM_WRITE_RING_CAPACITY);
  }
}

// Counting rule inserts needs the prototype patched; done once, left in place
// (the wrapper is a counter increment when no capture is running).
function patchCssInsertRule(): void {
  if (runtime.cssPatched || typeof CSSStyleSheet === "undefined") return;
  const proto = CSSStyleSheet.prototype;
  const nativeInsertRule = proto.insertRule;
  if (typeof nativeInsertRule !== "function") return;
  proto.insertRule = function patchedInsertRule(this: CSSStyleSheet, rule: string, index?: number) {
    if (runtime.observer) {
      runtime.cssRulesSinceLastBatch += 1;
      runtime.totalCssRulesInserted += 1;
    }
    return nativeInsertRule.call(this, rule, index);
  };
  runtime.cssPatched = true;
}

export function isDomWriteAttributionSupported(): boolean {
  return typeof MutationObserver !== "undefined" && typeof document !== "undefined";
}

export function startDomWriteAttribution(): void {
  if (runtime.observer || !isDomWriteAttributionSupported()) return;
  patchCssInsertRule();
  runtime.ring = [];
  runtime.totalBatches = 0;
  runtime.totalRecords = 0;
  runtime.totalCssRulesInserted = 0;
  runtime.cssRulesSinceLastBatch = 0;
  runtime.observedSince = Date.now();
  try {
    const observer = new MutationObserver((records) => {
      const cssRules = runtime.cssRulesSinceLastBatch;
      runtime.cssRulesSinceLastBatch = 0;
      recordBatch(summarizeMutationBatch(records, cssRules, Date.now()));
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    runtime.observer = observer;
  } catch {
    runtime.observer = null;
    runtime.observedSince = null;
  }
}

export function stopDomWriteAttribution(): void {
  runtime.observer?.disconnect();
  runtime.observer = null;
}

export function getDomWriteReport(sinceMs?: number): DomWriteReport {
  return {
    supported: isDomWriteAttributionSupported(),
    observedSince: runtime.observedSince,
    totalBatches: runtime.totalBatches,
    totalRecords: runtime.totalRecords,
    totalCssRulesInserted: runtime.totalCssRulesInserted,
    batches: runtime.ring
      .filter((batch) => sinceMs === undefined || batch.at >= sinceMs)
      .map((batch) => ({
        at: batch.at,
        records: batch.records,
        childList: batch.childList,
        attributes: batch.attributes,
        characterData: batch.characterData,
        nodesAdded: batch.nodesAdded,
        nodesRemoved: batch.nodesRemoved,
        attributeNames: batch.attributeNames.map((entry) => ({
          name: entry.name,
          count: entry.count,
        })),
        targets: batch.targets.map((entry) => ({ label: entry.label, count: entry.count })),
        cssRulesInserted: batch.cssRulesInserted,
      })),
  };
}

/** Test-only. */
export function resetDomWriteAttributionForTest(): void {
  stopDomWriteAttribution();
  runtime.observedSince = null;
  runtime.ring = [];
  runtime.totalBatches = 0;
  runtime.totalRecords = 0;
  runtime.totalCssRulesInserted = 0;
  runtime.cssRulesSinceLastBatch = 0;
}
