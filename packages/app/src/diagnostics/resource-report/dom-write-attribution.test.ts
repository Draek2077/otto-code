import { describe, expect, test, vi } from "vitest";

import {
  DOM_WRITE_TOP_N,
  labelTarget,
  summarizeMutationBatch,
  startDomWriteAttribution,
  stopDomWriteAttribution,
  getDomWriteReport,
  resetDomWriteAttributionForTest,
} from "./dom-write-attribution";

function element(
  tag: string,
  attrs: Record<string, string> = {},
  parent: Node | null = null,
): Element {
  const node = {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    tagName: tag.toUpperCase(),
    id: attrs.id ?? "",
    parentNode: parent,
    getAttribute: (name: string) => attrs[name] ?? null,
  };
  return node as unknown as Element;
}

function record(
  type: MutationRecord["type"],
  target: Node,
  extra: Partial<MutationRecord> = {},
): MutationRecord {
  return {
    type,
    target,
    addedNodes: [] as unknown as NodeList,
    removedNodes: [] as unknown as NodeList,
    attributeName: null,
    ...extra,
  } as MutationRecord;
}

describe("labelTarget", () => {
  test("prefers a test id, then an id, then the first labelled tag on the way up", () => {
    const root = element("div", { id: "root" });
    const pane = element("section", { "data-testid": "composer" }, root);
    const span = element("span", { class: "css-1 css-2" }, pane);
    const text = { nodeType: 3, nodeName: "#text", parentNode: span } as unknown as Node;

    expect(labelTarget(text)).toBe("[data-testid=composer]");
    expect(labelTarget(element("p", {}, root))).toBe("#root");
    expect(labelTarget(element("em", { class: "x" }, element("b", {}, null)))).toBe("em.x");
    expect(labelTarget(null)).toBe("(detached)");
  });
});

describe("summarizeMutationBatch", () => {
  test("counts kinds, nodes, attribute names, and ancestor labels", () => {
    const root = element("div", { id: "root" });
    const textarea = element("textarea", { "data-testid": "composer-input" }, root);
    const records = [
      record("characterData", textarea),
      record("attributes", textarea, { attributeName: "style" }),
      record("attributes", root, { attributeName: "class" }),
      record("attributes", root, { attributeName: "style" }),
      record("childList", root, {
        addedNodes: [element("p")] as unknown as NodeList,
        removedNodes: [element("p"), element("p")] as unknown as NodeList,
      }),
    ];

    const batch = summarizeMutationBatch(records, 2, 1_000);

    expect(batch).toMatchObject({
      at: 1_000,
      records: 5,
      childList: 1,
      attributes: 3,
      characterData: 1,
      nodesAdded: 1,
      nodesRemoved: 2,
      cssRulesInserted: 2,
    });
    expect(batch.attributeNames).toEqual([
      { name: "style", count: 2 },
      { name: "class", count: 1 },
    ]);
    expect(batch.targets).toEqual([
      { label: "#root", count: 3 },
      { label: "[data-testid=composer-input]", count: 2 },
    ]);
  });

  test("keeps only the top labels", () => {
    const records = Array.from({ length: DOM_WRITE_TOP_N + 4 }, (_, index) =>
      record("attributes", element("div", { id: `n${index}` }), { attributeName: "class" }),
    );
    expect(summarizeMutationBatch(records, 0, 0).targets).toHaveLength(DOM_WRITE_TOP_N);
  });
});

test("drains pending mutations at stop and reports summarization overhead", () => {
  let deliver!: (records: MutationRecord[]) => void;
  let pending: MutationRecord[] = [];
  class Observer {
    constructor(callback: typeof deliver) {
      deliver = callback;
    }
    observe() {}
    disconnect() {}
    takeRecords() {
      const result = pending;
      pending = [];
      return result;
    }
  }
  vi.stubGlobal("MutationObserver", Observer);
  vi.stubGlobal("document", { documentElement: element("html") });
  try {
    startDomWriteAttribution();
    deliver([record("attributes", element("div"), { attributeName: "style" })]);
    pending = [record("characterData", element("span"))];
    stopDomWriteAttribution();
    const report = getDomWriteReport();
    expect(report.totalRecords).toBe(2);
    expect(report.batches.map((batch) => batch.records)).toEqual([1, 1]);
    expect(report.observerOverhead.calls).toBe(2);
    expect(report.observerOverhead.totalMs).toBeGreaterThanOrEqual(report.observerOverhead.maxMs);
  } finally {
    resetDomWriteAttributionForTest();
    vi.unstubAllGlobals();
  }
});
