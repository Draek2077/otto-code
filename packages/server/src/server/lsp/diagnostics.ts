import type { CodeDiagnostic, CodeDiagnosticSeverity } from "@otto-code/protocol/messages";
import type { LspPublishedDiagnostics } from "./connection.js";

/**
 * The current problem set for each open document, per publishing server.
 *
 * Two-level keying is what makes multi-server documents behave. An Angular `.ts` file is
 * held by both `typescript` and `angular`, and each publishes its **own complete** set for
 * that document - so a push replaces one server's slice and leaves the other's alone.
 * Flattening to one list per document would make whichever server published last erase
 * the other's findings.
 *
 * `set` reports whether the merged view actually changed. Servers re-publish the same set
 * freely (tsserver re-runs on every keystroke it decides is interesting, and an unchanged
 * file yields an unchanged answer), and a broadcast per redundant publish would push that
 * churn to every connected client for nothing.
 */

const SEVERITY_BY_LSP_CODE: Readonly<Record<number, CodeDiagnosticSeverity>> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

/**
 * LSP makes `severity` optional and says the client decides. A problem the server took
 * the trouble to report but did not rank is treated as an error - the same call VS Code
 * makes, and the safe direction: over-reporting severity is visible, under-reporting hides
 * a real failure in a tone the eye skips.
 */
function severityOf(code: number | undefined): CodeDiagnosticSeverity {
  return code === undefined ? "error" : (SEVERITY_BY_LSP_CODE[code] ?? "error");
}

const SEVERITY_RANK: Readonly<Record<CodeDiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

/**
 * A server's push into Otto's wire shape: 1-based positions, named severity, string code.
 *
 * Zero-width ranges are widened by one column. A server is entitled to point at a single
 * offset (missing semicolons and unexpected EOF both do), but a marker with no extent
 * cannot be drawn or hovered - it would be a diagnostic the user can see in no way at all.
 */
export function toCodeDiagnostics(
  published: LspPublishedDiagnostics,
  serverId: string,
): CodeDiagnostic[] {
  return published.diagnostics.map((entry) => {
    const line = entry.range.start.line + 1;
    const column = entry.range.start.character + 1;
    const endLine = entry.range.end.line + 1;
    const endColumn = entry.range.end.character + 1;
    const isEmpty = endLine === line && endColumn <= column;

    return {
      line,
      column,
      endLine,
      endColumn: isEmpty ? column + 1 : endColumn,
      severity: severityOf(entry.severity),
      message: entry.message,
      ...(entry.source === undefined ? {} : { source: entry.source }),
      ...(entry.code === undefined ? {} : { code: String(entry.code) }),
      ...(entry.codeDescription === undefined ? {} : { codeHref: entry.codeDescription.href }),
      serverId,
    };
  });
}

export interface SetDiagnosticsInput {
  /** Canonical document identity, from `documentKey`. */
  documentKey: string;
  /** Canonical (workspace × server) identity - one server's slice of this document. */
  serverKey: string;
  diagnostics: CodeDiagnostic[];
}

export class LspDiagnosticsStore {
  private readonly byDocument = new Map<string, Map<string, CodeDiagnostic[]>>();

  /** Replace one server's slice. Returns whether the document's merged view changed. */
  set(input: SetDiagnosticsInput): boolean {
    const before = this.fingerprint(input.documentKey);
    const slices = this.byDocument.get(input.documentKey) ?? new Map<string, CodeDiagnostic[]>();

    if (input.diagnostics.length === 0) {
      slices.delete(input.serverKey);
    } else {
      slices.set(input.serverKey, input.diagnostics);
    }

    if (slices.size === 0) {
      this.byDocument.delete(input.documentKey);
    } else {
      this.byDocument.set(input.documentKey, slices);
    }

    return this.fingerprint(input.documentKey) !== before;
  }

  /** Every server's findings for one document, ordered so a list reads top to bottom. */
  merged(documentKey: string): CodeDiagnostic[] {
    const slices = this.byDocument.get(documentKey);
    if (slices === undefined) {
      return [];
    }

    return [...slices.values()]
      .flat()
      .sort(
        (a, b) =>
          a.line - b.line ||
          a.column - b.column ||
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          a.message.localeCompare(b.message),
      );
  }

  /**
   * Drop everything one server said, and report which documents that changed so each can
   * be re-broadcast. A dead server's squiggles are worse than none: they point at a claim
   * nothing stands behind any more, and nothing will ever retract them.
   */
  clearServer(serverKey: string): string[] {
    const affected: string[] = [];

    for (const [key, slices] of this.byDocument) {
      if (!slices.delete(serverKey)) {
        continue;
      }
      affected.push(key);
      if (slices.size === 0) {
        this.byDocument.delete(key);
      }
    }

    return affected;
  }

  clearDocument(documentKey: string): void {
    this.byDocument.delete(documentKey);
  }

  documentCount(): number {
    return this.byDocument.size;
  }

  private fingerprint(documentKey: string): string {
    return this.merged(documentKey)
      .map((entry) => `${entry.line}:${entry.column}:${entry.severity}:${entry.message}`)
      .join("\0");
  }
}
