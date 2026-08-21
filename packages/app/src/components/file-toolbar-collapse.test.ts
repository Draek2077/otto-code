import { describe, expect, it } from "vitest";
import {
  describeFileToolbarChrome,
  listPresentFileToolbarActions,
  resolveCollapsedFileToolbarActions,
  type CollapsibleFileToolbarAction,
  type FileToolbarActionAvailability,
} from "./file-toolbar-collapse";

const ITEM = 24;

const ALL: FileToolbarActionAvailability = {
  refine: true,
  exportHtml: true,
  exportPdf: true,
  findInFiles: true,
  viewChanges: true,
  outline: true,
  wordWrap: true,
};

function collapse(
  naturalWidth: number,
  availableWidth: number,
  present: readonly CollapsibleFileToolbarAction[] = listPresentFileToolbarActions(ALL),
): CollapsibleFileToolbarAction[] {
  return [
    ...resolveCollapsedFileToolbarActions({
      naturalWidth,
      availableWidth,
      itemWidth: ITEM,
      present,
    }),
  ];
}

describe("resolveCollapsedFileToolbarActions", () => {
  it("keeps every button while the bar fits", () => {
    expect(collapse(300, 300)).toEqual([]);
    expect(collapse(300, 400)).toEqual([]);
  });

  it("shows everything until the first layout has been measured", () => {
    expect(collapse(0, 200)).toEqual([]);
    expect(collapse(300, 0)).toEqual([]);
  });

  it("gives up one button per missing button's width, least important first", () => {
    expect(collapse(300, 290)).toEqual(["refine"]);
    expect(collapse(300, 260)).toEqual(["refine", "exportHtml"]);
    expect(collapse(300, 230)).toEqual(["refine", "exportHtml", "exportPdf"]);
  });

  it("gives up the whole bar rather than overflowing", () => {
    expect(collapse(300, 40)).toEqual([
      "refine",
      "exportHtml",
      "exportPdf",
      "findInFiles",
      "viewChanges",
      "outline",
      "wordWrap",
    ]);
  });

  it("skips actions this toolbar is not showing anyway", () => {
    // No Refine and no HTML export: the exact width that would have cost only
    // Refine now costs the first button the bar actually has.
    expect(collapse(300, 290, ["exportPdf", "viewChanges", "wordWrap"])).toEqual(["exportPdf"]);
  });

  it("stops as soon as the bar fits, however much room is left over", () => {
    expect(collapse(300, 299)).toEqual(["refine"]);
  });
});

describe("listPresentFileToolbarActions", () => {
  it("lists what the bar would show, in collapse order", () => {
    expect(
      listPresentFileToolbarActions({
        ...ALL,
        exportHtml: false,
        outline: false,
      }),
    ).toEqual(["refine", "exportPdf", "findInFiles", "viewChanges", "wordWrap"]);
  });
});

describe("describeFileToolbarChrome", () => {
  const base = {
    history: null,
    addToChat: null,
    leadingSlot: null,
    externalEditor: null,
    find: false,
    modeBar: null,
  };

  it("changes when a control the bar cannot collapse comes or goes", () => {
    const without = describeFileToolbarChrome(base);
    expect(describeFileToolbarChrome({ ...base, history: () => {} })).not.toBe(without);
    expect(describeFileToolbarChrome({ ...base, externalEditor: "Vim" })).not.toBe(without);
  });

  it("changes when the mode bar gains a segment", () => {
    const modeBar = {
      mode: "editor" as const,
      showSplit: false,
      onChange: () => {},
      formatted: null,
    };
    const plain = describeFileToolbarChrome({ ...base, modeBar });
    expect(
      describeFileToolbarChrome({ ...base, modeBar: { ...modeBar, showSplit: true } }),
    ).not.toBe(plain);
    expect(
      describeFileToolbarChrome({
        ...base,
        modeBar: { ...modeBar, formatted: { on: false, disabled: false, onToggle: () => {} } },
      }),
    ).not.toBe(plain);
  });

  it("is unchanged by a control merely changing state", () => {
    const modeBar = {
      mode: "editor" as const,
      showSplit: true,
      onChange: () => {},
      formatted: { on: false, disabled: false, onToggle: () => {} },
    };
    expect(describeFileToolbarChrome({ ...base, modeBar })).toBe(
      describeFileToolbarChrome({
        ...base,
        modeBar: { ...modeBar, mode: "preview", formatted: { ...modeBar.formatted, on: true } },
      }),
    );
  });
});
