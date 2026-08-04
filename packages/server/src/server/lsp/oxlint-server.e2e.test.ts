import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { LSP_SERVER_ROWS, resolveServerCommand } from "./registry.js";
import { LspService, type DiagnosticsSnapshot } from "./service.js";

/**
 * Diagnostics against the real `oxlint --lsp`, which this repo already installs.
 *
 * This is the end-to-end proof for Phase 5b: an unsolicited `publishDiagnostics` from a
 * foreign process, parsed, converted, stored, and delivered to the listener the daemon
 * broadcasts from. A stub server could not prove it - the whole risk in a push channel is
 * whether a real server volunteers anything at all, and under what conditions.
 *
 * oxlint is also the row that makes the multi-server binding real rather than test-only: it
 * claims `.ts` alongside the TypeScript server.
 */

const logger = pino({ level: "silent" });
const oxlintRow = LSP_SERVER_ROWS.find((row) => row.id === "oxlint");

const tempRoots: string[] = [];
const services: LspService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll()));
  await Promise.all(
    tempRoots
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});

/**
 * The repo itself, because `oxlint`'s only discovery rung is `workspaceBin` - deliberately,
 * so a project that never adopted oxlint is never linted by it. A temp directory therefore
 * cannot supply the server, which is the rule working, not a limitation of the test.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..");

async function isOxlintAvailable(): Promise<boolean> {
  if (oxlintRow === undefined) {
    return false;
  }
  return (await resolveServerCommand(oxlintRow, REPO_ROOT)) !== null;
}

function createService(): LspService {
  const service = LspService.create({
    logger,
    rows: oxlintRow === undefined ? [] : [oxlintRow],
  });
  services.push(service);
  return service;
}

/** Waits for a snapshot about `filePath`, or resolves null on timeout. */
function nextDiagnostics(
  service: LspService,
  filePath: string,
  timeoutMs: number,
): Promise<DiagnosticsSnapshot | null> {
  return new Promise((resolve) => {
    // A real server may publish more than once for one document (an empty set on open,
    // then the findings), so the listener has to be able to fire again without resolving
    // a settled promise.
    let settled = false;
    const settle = (value: DiagnosticsSnapshot | null): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const timer = setTimeout(() => settle(null), timeoutMs);
    service.onDiagnosticsChange((snapshot) => {
      if (snapshot.filePath === filePath && snapshot.diagnostics.length > 0) {
        clearTimeout(timer);
        settle(snapshot);
      }
    });
  });
}

describe.skipIf(!(await isOxlintAvailable()))("diagnostics from a real oxlint server", () => {
  it("pushes a snapshot for a synced document without being asked", async () => {
    const service = createService();
    // Inside the repo so oxlint resolves the repo's own config, but in a scratch directory
    // so nothing collides with real sources.
    const scratch = await mkdtemp(path.join(REPO_ROOT, ".lsp-oxlint-e2e-"));
    tempRoots.push(scratch);
    const filePath = path.join(scratch, "broken.ts");
    const text = "export function f() {\n  if (true) {\n    return 1;\n  }\n  return 2;\n}\n";
    await writeFile(filePath, text, "utf8");

    const arriving = nextDiagnostics(service, filePath, 20_000);
    await service.syncDocument({ rootPath: REPO_ROOT, filePath, text });
    const snapshot = await arriving;

    expect(snapshot).not.toBeNull();
    expect(snapshot?.diagnostics.length).toBeGreaterThan(0);

    const [first] = snapshot?.diagnostics ?? [];
    // 1-based, attributed, and carrying the server's own explanation.
    expect(first.line).toBeGreaterThan(0);
    expect(first.column).toBeGreaterThan(0);
    expect(first.serverId).toBe("oxlint");
    expect(first.message.length).toBeGreaterThan(0);
    // `no-constant-condition` is what `if (true)` trips; the rule name is what makes the
    // tooltip an explanation rather than an assertion.
    expect(first.code).toContain("no-constant-condition");
  }, 40_000);

  it("answers no definition at all, because it never advertised one", async () => {
    const service = createService();
    const scratch = await mkdtemp(path.join(REPO_ROOT, ".lsp-oxlint-e2e-"));
    tempRoots.push(scratch);
    const filePath = path.join(scratch, "plain.ts");
    const text = "export const value = 1;\nexport const other = value;\n";
    await writeFile(filePath, text, "utf8");

    await service.syncDocument({ rootPath: REPO_ROOT, filePath, text });
    const result = await service.definition({ rootPath: REPO_ROOT, filePath, line: 2, column: 22 });

    // The capability filter at work: a diagnostics-only server is not asked, so this is
    // `unavailable` (nothing can answer) rather than a wasted round-trip and a false miss.
    expect(result.status).toBe("unavailable");
  }, 40_000);
});
