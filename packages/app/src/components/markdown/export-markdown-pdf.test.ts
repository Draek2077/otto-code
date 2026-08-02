import { describe, expect, it } from "vitest";
import {
  exportMarkdownAsPdf,
  pdfExportPath,
  type PdfExportWriter,
  type PdfPrinter,
} from "./export-markdown-pdf";

/**
 * `printToPDF` is Electron's, and there is no headless stand-in for it — the
 * bytes it produces are proven by hand and by the packaged desktop smoke, not
 * here. What is testable is everything around it: where the file lands, what
 * the printer is handed, and that both failure paths surface as a failed
 * export rather than an unhandled rejection.
 */
function createPrinter(result: string | Error) {
  const calls: string[] = [];
  const printer: PdfPrinter = {
    printHtml: async ({ html }) => {
      calls.push(html);
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  };
  return { printer, calls };
}

function createWriter(outcome: Awaited<ReturnType<PdfExportWriter["writeBinaryFile"]>>) {
  const writes: Array<{ path: string; contentBase64: string; overwrite?: boolean }> = [];
  const writer: PdfExportWriter = {
    writeBinaryFile: async (options) => {
      writes.push({
        path: options.path,
        contentBase64: options.contentBase64,
        overwrite: options.overwrite,
      });
      return outcome;
    },
  };
  return { writer, writes };
}

const WRITTEN = { status: "written", modifiedAt: "t1", size: 1024 } as const;

describe("pdfExportPath", () => {
  it("lands beside the source document", () => {
    expect(pdfExportPath("notes/design.md")).toBe("notes/design.pdf");
  });

  it("handles a document at the workspace root", () => {
    expect(pdfExportPath("README.md")).toBe("README.pdf");
  });

  it("keeps a windows-style path in its own separator style", () => {
    expect(pdfExportPath("docs\\guides\\a.md")).toBe("docs\\guides\\a.pdf");
  });

  it("appends rather than replaces when the document has no extension", () => {
    expect(pdfExportPath("NOTES")).toBe("NOTES.pdf");
  });
});

describe("exportMarkdownAsPdf", () => {
  it("prints the HTML export and writes the bytes beside the document", async () => {
    const { printer, calls } = createPrinter("JVBERi0=");
    const { writer, writes } = createWriter(WRITTEN);

    const result = await exportMarkdownAsPdf({
      printer,
      writer,
      cwd: "/repo",
      path: "docs/design.md",
      markdown: "# Design\n\nBody.\n",
    });

    expect(result).toEqual({ status: "written", path: "docs/design.pdf", title: "Design" });
    expect(writes).toEqual([
      { path: "docs/design.pdf", contentBase64: "JVBERi0=", overwrite: true },
    ]);
    // The printer is handed the same standalone document the HTML export
    // writes, which is the reason the two formats cannot drift.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("<!doctype html>");
    expect(calls[0]).toContain("<h1>Design</h1>");
  });

  it("titles the export from the file name when the document has no heading", async () => {
    const { printer } = createPrinter("JVBERi0=");
    const { writer } = createWriter(WRITTEN);

    const result = await exportMarkdownAsPdf({
      printer,
      writer,
      cwd: "/repo",
      path: "docs/notes.md",
      markdown: "Body only.\n",
    });

    expect(result).toEqual({ status: "written", path: "docs/notes.pdf", title: "notes.md" });
  });

  it("reports a failed print as a failed export, and writes nothing", async () => {
    const { printer } = createPrinter(new Error("Render frame was disposed"));
    const { writer, writes } = createWriter(WRITTEN);

    const result = await exportMarkdownAsPdf({
      printer,
      writer,
      cwd: "/repo",
      path: "docs/design.md",
      markdown: "# Design\n",
    });

    expect(result).toEqual({ status: "error", message: "Render frame was disposed" });
    expect(writes).toEqual([]);
  });

  it("reports a failed write with the daemon's message", async () => {
    const { printer } = createPrinter("JVBERi0=");
    const { writer } = createWriter({ status: "error", error: "EACCES: permission denied" });

    const result = await exportMarkdownAsPdf({
      printer,
      writer,
      cwd: "/repo",
      path: "docs/design.md",
      markdown: "# Design\n",
    });

    expect(result).toEqual({ status: "error", message: "EACCES: permission denied" });
  });

  it("never reports success for a refused overwrite", async () => {
    const { printer } = createPrinter("JVBERi0=");
    const { writer } = createWriter({ status: "exists" });

    const result = await exportMarkdownAsPdf({
      printer,
      writer,
      cwd: "/repo",
      path: "docs/design.md",
      markdown: "# Design\n",
    });

    expect(result.status).toBe("error");
  });
});
