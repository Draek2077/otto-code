import { describe, expect, it } from "vitest";
import type { MarkdownEdit } from "./markdown-format";
import {
  cycleColumnAlignment,
  deleteColumn,
  deleteRow,
  findTableAt,
  formatTableAtCursor,
  insertColumnRight,
  insertRowBelow,
  splitRow,
} from "./markdown-table";

const TABLE = ["| Name | Size |", "| --- | --- |", "| a | 1 |", "| bb | 22 |"].join("\n");

/** Apply an edit and return the resulting document. */
function apply(doc: string, edit: MarkdownEdit | null): string {
  if (!edit) return doc;
  return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
}

/** Offset of the first occurrence of `needle`, for placing the caret. */
function at(doc: string, needle: string): number {
  const index = doc.indexOf(needle);
  if (index < 0) throw new Error(`not found: ${needle}`);
  return index;
}

describe("splitRow", () => {
  it("drops the optional outer pipes", () => {
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
  });

  it("keeps an escaped pipe inside a cell", () => {
    expect(splitRow("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
  });

  it("keeps genuinely empty cells", () => {
    expect(splitRow("| a |  | c |")).toEqual(["a", "", "c"]);
  });
});

describe("findTableAt", () => {
  it("finds the table around a caret anywhere inside it", () => {
    const table = findTableAt(TABLE, at(TABLE, "bb"));
    expect(table?.rows).toEqual([
      ["Name", "Size"],
      ["a", "1"],
      ["bb", "22"],
    ]);
  });

  // A pipe in a sentence is not a table, and reformatting it would rewrite prose.
  it("returns null for a line with pipes but no divider row", () => {
    const doc = "a | b\nc | d";
    expect(findTableAt(doc, 0)).toBeNull();
  });

  it("stops at the blank lines around the table", () => {
    const doc = `before\n\n${TABLE}\n\nafter`;
    const table = findTableAt(doc, at(doc, "bb"));
    expect(doc.slice(table!.from, table!.to)).toBe(TABLE);
  });

  it("reads the caret's row and column", () => {
    const table = findTableAt(TABLE, at(TABLE, "22"));
    expect([table?.cursorRow, table?.cursorColumn]).toEqual([2, 1]);
  });

  // The divider has no cells to edit, so a caret there acts as the header's.
  it("treats a caret on the divider as being in the header", () => {
    expect(findTableAt(TABLE, at(TABLE, "---"))?.cursorRow).toBe(0);
  });
});

describe("formatTableAtCursor", () => {
  it("aligns the pipes", () => {
    const ragged = ["|Name|Size|", "|---|---|", "|a|1|", "|bb|22|"].join("\n");
    expect(apply(ragged, formatTableAtCursor(ragged, { from: 0, to: 0 }))).toBe(
      ["| Name | Size |", "| ---- | ---- |", "| a    | 1    |", "| bb   | 22   |"].join("\n"),
    );
  });

  it("pads short columns to the minimum divider width", () => {
    const doc = ["| a | b |", "| - | - |", "| c | d |"].join("\n");
    expect(apply(doc, formatTableAtCursor(doc, { from: 0, to: 0 }))).toBe(
      ["| a   | b   |", "| --- | --- |", "| c   | d   |"].join("\n"),
    );
  });

  it("preserves column alignment markers", () => {
    const doc = ["| a | b | c |", "| :-- | :-: | --: |", "| 1 | 2 | 3 |"].join("\n");
    const formatted = apply(doc, formatTableAtCursor(doc, { from: 0, to: 0 }));
    expect(formatted.split("\n")[1]).toBe("| :-- | :-: | --: |");
    // Right-aligned cells pad on the left.
    expect(formatted.split("\n")[2]).toBe("| 1   |  2  |   3 |");
  });

  it("does nothing outside a table", () => {
    expect(formatTableAtCursor("just prose", { from: 0, to: 0 })).toBeNull();
  });
});

describe("row operations", () => {
  it("inserts an empty row below the caret", () => {
    const result = apply(TABLE, insertRowBelow(TABLE, { from: at(TABLE, "| a "), to: 0 }));
    expect(result.split("\n")[3]).toBe("|      |      |");
  });

  // A row inserted above the header would become the header.
  it("never inserts above the header", () => {
    const result = apply(TABLE, insertRowBelow(TABLE, { from: at(TABLE, "Name"), to: 0 }));
    expect(result.split("\n")[0]).toBe("| Name | Size |");
    expect(result.split("\n")[2]).toBe("|      |      |");
  });

  it("deletes the caret's row", () => {
    const result = apply(TABLE, deleteRow(TABLE, { from: at(TABLE, "bb"), to: 0 }));
    expect(result.split("\n")).toHaveLength(3);
    expect(result).not.toContain("bb");
  });

  it("refuses to delete the header, which is structural", () => {
    expect(deleteRow(TABLE, { from: at(TABLE, "Name"), to: 0 })).toBeNull();
  });
});

describe("column operations", () => {
  it("inserts a column to the right of the caret", () => {
    const result = apply(TABLE, insertColumnRight(TABLE, { from: at(TABLE, "Name"), to: 0 }));
    expect(result.split("\n")[0]).toBe("| Name |     | Size |");
  });

  it("deletes the caret's column across every row", () => {
    const result = apply(TABLE, deleteColumn(TABLE, { from: at(TABLE, "Size"), to: 0 }));
    expect(result.split("\n")).toEqual(["| Name |", "| ---- |", "| a    |", "| bb   |"]);
  });

  it("refuses to delete the only column", () => {
    const single = ["| a |", "| --- |", "| b |"].join("\n");
    expect(deleteColumn(single, { from: 2, to: 2 })).toBeNull();
  });

  it("cycles alignment default to left to center to right and back", () => {
    let doc = TABLE;
    const caret = () => ({ from: at(doc, "Name"), to: 0 });
    doc = apply(doc, cycleColumnAlignment(doc, caret()));
    expect(doc.split("\n")[1]).toBe("| :--- | ---- |");
    doc = apply(doc, cycleColumnAlignment(doc, caret()));
    expect(doc.split("\n")[1]).toBe("| :--: | ---- |");
    doc = apply(doc, cycleColumnAlignment(doc, caret()));
    expect(doc.split("\n")[1]).toBe("| ---: | ---- |");
    doc = apply(doc, cycleColumnAlignment(doc, caret()));
    expect(doc.split("\n")[1]).toBe("| ---- | ---- |");
  });
});
