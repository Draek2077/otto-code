import { describe, expect, it } from "vitest";
import { LspDiagnosticsStore, toCodeDiagnostics } from "./diagnostics.js";
import type { LspPublishedDiagnostics } from "./connection.js";

function published(
  entries: LspPublishedDiagnostics["diagnostics"],
  uri = "file:///c:/ws/a.ts",
): LspPublishedDiagnostics {
  return { uri, diagnostics: entries };
}

function at(line: number, character: number) {
  return { start: { line, character }, end: { line, character: character + 4 } };
}

describe("converting a server's push", () => {
  it("moves positions to 1-based and names the severity", () => {
    const [entry] = toCodeDiagnostics(
      published([{ range: at(3, 6), severity: 2, message: "Unused" }]),
      "oxlint",
    );

    expect(entry).toMatchObject({
      line: 4,
      column: 7,
      endLine: 4,
      endColumn: 11,
      severity: "warning",
      message: "Unused",
      serverId: "oxlint",
    });
  });

  it("treats an unranked problem as an error, because the server bothered to report it", () => {
    const [entry] = toCodeDiagnostics(published([{ range: at(0, 0), message: "?" }]), "ts");

    expect(entry.severity).toBe("error");
  });

  it("widens a zero-width range so the marker can be drawn at all", () => {
    const [entry] = toCodeDiagnostics(
      published([
        {
          range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
          message: "Expected ;",
        },
      ]),
      "ts",
    );

    expect(entry.column).toBe(6);
    expect(entry.endColumn).toBe(7);
  });

  it("keeps a numeric code as a string, so one type covers TypeScript and oxlint alike", () => {
    const [numeric] = toCodeDiagnostics(
      published([{ range: at(0, 0), code: 2345, message: "x" }]),
      "ts",
    );
    const [named] = toCodeDiagnostics(
      published([{ range: at(0, 0), code: "eslint(no-unused-vars)", message: "x" }]),
      "oxlint",
    );

    expect(numeric.code).toBe("2345");
    expect(named.code).toBe("eslint(no-unused-vars)");
  });

  it("carries the rule documentation link when the server offers one", () => {
    const [entry] = toCodeDiagnostics(
      published([
        {
          range: at(0, 0),
          message: "x",
          codeDescription: { href: "https://oxc.rs/rule" },
        },
      ]),
      "oxlint",
    );

    expect(entry.codeHref).toBe("https://oxc.rs/rule");
  });
});

describe("the per-document store", () => {
  const DOC = "C:/ws/a.ts";
  const TS = "C:/ws typescript";
  const OXLINT = "C:/ws oxlint";

  function entry(line: number, message: string, severity: "error" | "warning" = "error") {
    return { line, column: 1, endLine: line, endColumn: 5, severity, message };
  }

  it("keeps two servers' findings on the same document, rather than letting the last one win", () => {
    const store = new LspDiagnosticsStore();

    store.set({ documentKey: DOC, serverKey: TS, diagnostics: [entry(1, "type error")] });
    store.set({ documentKey: DOC, serverKey: OXLINT, diagnostics: [entry(2, "unused")] });

    expect(store.merged(DOC).map((item) => item.message)).toEqual(["type error", "unused"]);
  });

  it("replaces only the publishing server's slice", () => {
    const store = new LspDiagnosticsStore();
    store.set({ documentKey: DOC, serverKey: TS, diagnostics: [entry(1, "type error")] });
    store.set({ documentKey: DOC, serverKey: OXLINT, diagnostics: [entry(2, "unused")] });

    store.set({ documentKey: DOC, serverKey: TS, diagnostics: [] });

    expect(store.merged(DOC).map((item) => item.message)).toEqual(["unused"]);
  });

  it("reports no change when a server republishes the same set", () => {
    const store = new LspDiagnosticsStore();
    store.set({ documentKey: DOC, serverKey: TS, diagnostics: [entry(1, "type error")] });

    const changed = store.set({
      documentKey: DOC,
      serverKey: TS,
      diagnostics: [entry(1, "type error")],
    });

    expect(changed).toBe(false);
  });

  it("reports a change when the set actually differs", () => {
    const store = new LspDiagnosticsStore();
    store.set({ documentKey: DOC, serverKey: TS, diagnostics: [entry(1, "type error")] });

    expect(
      store.set({ documentKey: DOC, serverKey: TS, diagnostics: [entry(1, "other error")] }),
    ).toBe(true);
  });

  it("orders by position, then by severity, so a list reads top to bottom", () => {
    const store = new LspDiagnosticsStore();
    store.set({
      documentKey: DOC,
      serverKey: TS,
      diagnostics: [entry(9, "late"), entry(2, "warn first", "warning"), entry(2, "err first")],
    });

    expect(store.merged(DOC).map((item) => item.message)).toEqual([
      "err first",
      "warn first",
      "late",
    ]);
  });

  it("retracts a dead server's claims and names the documents that changed", () => {
    const store = new LspDiagnosticsStore();
    const other = "C:/ws/b.ts";
    store.set({ documentKey: DOC, serverKey: TS, diagnostics: [entry(1, "a")] });
    store.set({ documentKey: other, serverKey: TS, diagnostics: [entry(1, "b")] });
    store.set({ documentKey: other, serverKey: OXLINT, diagnostics: [entry(3, "keep me")] });

    expect(store.clearServer(TS).sort()).toEqual([DOC, other].sort());
    expect(store.merged(DOC)).toEqual([]);
    expect(store.merged(other).map((item) => item.message)).toEqual(["keep me"]);
  });

  it("forgets a document entirely when its tab closes", () => {
    const store = new LspDiagnosticsStore();
    store.set({ documentKey: DOC, serverKey: TS, diagnostics: [entry(1, "a")] });

    store.clearDocument(DOC);

    expect(store.documentCount()).toBe(0);
  });

  it("holds no entry for a document whose every server reported clean", () => {
    const store = new LspDiagnosticsStore();
    store.set({ documentKey: DOC, serverKey: TS, diagnostics: [entry(1, "a")] });

    store.set({ documentKey: DOC, serverKey: TS, diagnostics: [] });

    expect(store.documentCount()).toBe(0);
  });
});
