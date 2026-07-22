import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { EVIDENCE_SEPARATOR, MONEY_SHOT_PREFIX, STEP_SHOT_PREFIX } from "../helpers/evidence-names";

/**
 * Builds the human-auditable QA report for an e2e run.
 *
 * Playwright's own HTML report answers "did it pass?". This answers the
 * questions a release check actually asks:
 *   1. What is covered, per module?          -> index.md (table of contents)
 *   2. What did each test see?               -> modules/<module>/<spec>/<test>/
 *   3. Can I eyeball the whole suite at once?-> money-shots/index.md (contact sheet)
 *   4. What broke?                           -> failures.md
 *
 * Module grouping is derived from `projects/e2e-qa-coverage/coverage-matrix.md`
 * rather than per-spec tags, so the matrix stays the single source of truth for
 * what belongs where. `scripts/e2e-coverage-check.mjs` already guarantees every
 * spec on disk is claimed by exactly one matrix section, so any spec landing in
 * "Unclassified" here means the matrix drifted.
 */

interface ReporterOptions {
  /** Output directory, relative to the Playwright config's rootDir. */
  outputDir?: string;
}

interface CapturedAttachment {
  name: string;
  contentType: string;
  path?: string;
  body?: Buffer;
}

interface CapturedTest {
  id: string;
  title: string;
  titlePath: string[];
  projectName: string;
  specFile: string;
  module: string;
  status: TestResult["status"];
  expectedStatus: TestCase["expectedStatus"];
  ok: boolean;
  durationMs: number;
  retries: number;
  errorText: string;
  stdio: string;
  attachments: CapturedAttachment[];
}

const UNCLASSIFIED = "Unclassified";

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, "");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusIcon(entry: CapturedTest): string {
  if (entry.status === "skipped") return "⊘";
  return entry.ok ? "✅" : "❌";
}

/**
 * Maps `<spec>.spec.ts` -> matrix section title. Sections are `## <n>. <Title>`;
 * spec references inside them are backtick-quoted. Mirrors the parsing in
 * scripts/e2e-coverage-check.mjs — keep the two in step.
 */
async function loadModuleIndex(matrixPath: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let matrix: string;
  try {
    matrix = await readFile(matrixPath, "utf8");
  } catch {
    return index;
  }
  for (const section of matrix.split(/^## /m).slice(1)) {
    const title = section.slice(0, section.indexOf("\n")).trim();
    for (const match of section.matchAll(/`([\w.-]+\.spec\.ts)`/g)) {
      if (!index.has(match[1])) index.set(match[1], title);
    }
  }
  return index;
}

class QaReporter implements Reporter {
  private readonly options: ReporterOptions;
  private outputDir = "";
  private matrixPath = "";
  private moduleIndex = new Map<string, string>();
  private readonly results = new Map<string, CapturedTest>();
  private startedAt = new Date(0);

  constructor(options: ReporterOptions = {}) {
    this.options = options;
  }

  // The `list` reporter owns the terminal; this one only writes files.
  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig): void {
    // `config.rootDir` is the resolved *testDir* (packages/app/e2e), not the
    // directory holding playwright.config.ts. Anchor on the config file so the
    // report lands beside the config, not inside the spec tree.
    const configDir = config.configFile
      ? path.dirname(config.configFile)
      : path.resolve(config.rootDir, "..");
    this.outputDir = path.resolve(configDir, this.options.outputDir ?? "e2e-report");
    // packages/app -> repo root -> projects/e2e-qa-coverage/coverage-matrix.md
    this.matrixPath = path.resolve(
      configDir,
      "..",
      "..",
      "projects",
      "e2e-qa-coverage",
      "coverage-matrix.md",
    );
    this.startedAt = new Date();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const specFile = path.basename(test.location.file);
    const errorText = stripAnsi(
      (result.errors ?? [])
        .map((error) => [error.message, error.stack].filter(Boolean).join("\n"))
        .join("\n\n"),
    ).trim();
    const stdio = stripAnsi(
      [...result.stdout, ...result.stderr]
        .map((chunk) => (typeof chunk === "string" ? chunk : chunk.toString("utf8")))
        .join(""),
    ).trim();

    // Retries overwrite: the final attempt is the run's verdict for this test.
    this.results.set(test.id, {
      id: test.id,
      title: test.title,
      titlePath: test.titlePath().filter(Boolean),
      projectName: test.parent.project()?.name ?? "",
      specFile,
      module: UNCLASSIFIED,
      status: result.status,
      expectedStatus: test.expectedStatus,
      ok: result.status === test.expectedStatus,
      durationMs: result.duration,
      retries: result.retry,
      errorText,
      stdio,
      attachments: result.attachments.map((attachment) => ({
        name: attachment.name,
        contentType: attachment.contentType,
        path: attachment.path,
        body: attachment.body,
      })),
    });
  }

  async onEnd(result: FullResult): Promise<void> {
    this.moduleIndex = await loadModuleIndex(this.matrixPath);
    for (const entry of this.results.values()) {
      entry.module = this.moduleIndex.get(entry.specFile) ?? UNCLASSIFIED;
    }

    // A fresh tree every run — a stale money shot is worse than none, because it
    // reads as proof of something this run never exercised.
    await rm(this.outputDir, { recursive: true, force: true });
    await mkdir(this.outputDir, { recursive: true });

    const entries = [...this.results.values()];
    const digest: { entry: CapturedTest; claim: string; relPath: string }[] = [];
    const runLog: string[] = [];

    for (const entry of entries) {
      const written = await this.writeTestDirectory(entry);
      runLog.push(written.log);
      digest.push(...written.moneyShots);
    }

    await this.writeIndex(entries, result);
    await this.writeMoneyShotDigest(digest);
    await this.writeFailures(entries);
    await writeFile(path.join(this.outputDir, "run.log"), runLog.join("\n"), "utf8");
  }

  /** Writes one directory per test: all evidence for that test, in order. */
  private async writeTestDirectory(entry: CapturedTest): Promise<{
    log: string;
    moneyShots: { entry: CapturedTest; claim: string; relPath: string }[];
  }> {
    const moduleSlug = slugify(entry.module);
    const specSlug = entry.specFile.replace(/\.spec\.ts$/, "");
    const testSlug = slugify(entry.title);
    const testDir = path.join(this.outputDir, "modules", moduleSlug, specSlug, testSlug);
    await mkdir(testDir, { recursive: true });

    const moneyShots: { entry: CapturedTest; claim: string; relPath: string }[] = [];
    const evidenceLines: string[] = [];
    let ordinal = 0;

    for (const attachment of entry.attachments) {
      ordinal += 1;
      const isMoney = attachment.name.startsWith(MONEY_SHOT_PREFIX);
      const isStep = attachment.name.startsWith(STEP_SHOT_PREFIX);
      const label = attachment.name.includes(EVIDENCE_SEPARATOR)
        ? attachment.name.split(EVIDENCE_SEPARATOR).slice(1).join(EVIDENCE_SEPARATOR)
        : attachment.name;
      const extension =
        path.extname(attachment.path ?? "") || guessExtension(attachment.contentType);
      let kind = slugify(attachment.name);
      let evidenceLabel: string = attachment.name;
      if (isMoney) {
        kind = "money-shot";
        evidenceLabel = "**money shot**";
      } else if (isStep) {
        kind = "step";
        evidenceLabel = "step";
      }
      const fileName = `${String(ordinal).padStart(2, "0")}-${kind}-${slugify(label)}${extension}`;
      const destination = path.join(testDir, fileName);

      const copied = await this.materialize(attachment, destination);
      if (!copied) continue;

      evidenceLines.push(
        `- ${evidenceLabel} — ${label} → [\`${fileName}\`](${encodeURI(fileName)})`,
      );

      if (isMoney) {
        const digestName = `${specSlug}__${testSlug}${extension}`;
        const digestRel = path.posix.join("money-shots", moduleSlug, digestName);
        await mkdir(path.join(this.outputDir, "money-shots", moduleSlug), { recursive: true });
        await copyFile(destination, path.join(this.outputDir, digestRel));
        moneyShots.push({ entry, claim: label, relPath: digestRel });
      }
    }

    if (entry.stdio) {
      await writeFile(path.join(testDir, "stdio.log"), entry.stdio, "utf8");
      evidenceLines.push("- test stdout/stderr → [`stdio.log`](stdio.log)");
    }

    const resultMd = [
      `# ${entry.title}`,
      "",
      `- **Module:** ${entry.module}`,
      `- **Spec:** \`${entry.specFile}\``,
      `- **Project:** ${entry.projectName || "—"}`,
      `- **Status:** ${statusIcon(entry)} ${entry.status}${entry.retries > 0 ? ` (after ${entry.retries} ${entry.retries === 1 ? "retry" : "retries"})` : ""}`,
      `- **Duration:** ${formatDuration(entry.durationMs)}`,
      "",
      "## Evidence",
      "",
      evidenceLines.length > 0 ? evidenceLines.join("\n") : "_No evidence captured._",
      "",
    ];
    if (entry.errorText) {
      resultMd.push("## Error", "", "```", entry.errorText, "```", "");
    }
    await writeFile(path.join(testDir, "result.md"), resultMd.join("\n"), "utf8");

    const log = [
      `${statusIcon(entry)} [${entry.module}] ${entry.specFile} › ${entry.title} (${formatDuration(entry.durationMs)})`,
      entry.errorText ? indent(entry.errorText) : "",
      entry.stdio ? indent(entry.stdio) : "",
    ]
      .filter(Boolean)
      .join("\n");

    return { log, moneyShots };
  }

  private async materialize(attachment: CapturedAttachment, destination: string): Promise<boolean> {
    try {
      if (attachment.body) {
        await writeFile(destination, attachment.body);
        return true;
      }
      if (attachment.path) {
        await copyFile(attachment.path, destination);
        return true;
      }
    } catch {
      // A missing trace/video file (Playwright cleans some up on success) must
      // not abort report generation.
    }
    return false;
  }

  private async writeIndex(entries: CapturedTest[], result: FullResult): Promise<void> {
    const byModule = groupByModule(entries);
    const passed = entries.filter((entry) => entry.ok && entry.status !== "skipped").length;
    const failed = entries.filter((entry) => !entry.ok).length;
    const skipped = entries.filter((entry) => entry.status === "skipped").length;
    const totalMs = entries.reduce((sum, entry) => sum + entry.durationMs, 0);

    const lines: string[] = [
      "# E2E QA run report",
      "",
      `**Run:** ${this.startedAt.toISOString()} · **Verdict:** ${result.status === "passed" ? "✅ passed" : `❌ ${result.status}`}`,
      "",
      `✅ ${passed} passed · ❌ ${failed} failed · ⊘ ${skipped} skipped · ${entries.length} total · ${formatDuration(totalMs)} of test time`,
      "",
      "- [Money-shot digest](money-shots/index.md) — one confirming frame per test, in one place",
      "- [Failure report](failures.md)",
      "- [Full run log](run.log)",
      "",
      "## Coverage by module",
      "",
      "| Module | Tests | ✅ | ❌ | ⊘ |",
      "| --- | ---: | ---: | ---: | ---: |",
    ];

    for (const [moduleName, moduleEntries] of byModule) {
      const modPassed = moduleEntries.filter((e) => e.ok && e.status !== "skipped").length;
      const modFailed = moduleEntries.filter((e) => !e.ok).length;
      const modSkipped = moduleEntries.filter((e) => e.status === "skipped").length;
      lines.push(
        `| [${moduleName}](#${slugify(moduleName)}) | ${moduleEntries.length} | ${modPassed} | ${modFailed} | ${modSkipped} |`,
      );
    }
    lines.push("");

    for (const [moduleName, moduleEntries] of byModule) {
      lines.push(`## ${moduleName}`, "");
      const bySpec = new Map<string, CapturedTest[]>();
      for (const entry of moduleEntries) {
        const bucket = bySpec.get(entry.specFile) ?? [];
        bucket.push(entry);
        bySpec.set(entry.specFile, bucket);
      }
      for (const [specFile, specEntries] of [...bySpec].sort((a, b) => a[0].localeCompare(b[0]))) {
        lines.push(`### \`${specFile}\``, "");
        for (const entry of specEntries) {
          const rel = path.posix.join(
            "modules",
            slugify(moduleName),
            specFile.replace(/\.spec\.ts$/, ""),
            slugify(entry.title),
            "result.md",
          );
          lines.push(
            `- ${statusIcon(entry)} [${entry.title}](${encodeURI(rel)}) — ${formatDuration(entry.durationMs)}`,
          );
        }
        lines.push("");
      }
    }

    await writeFile(path.join(this.outputDir, "index.md"), lines.join("\n"), "utf8");
  }

  private async writeMoneyShotDigest(
    digest: { entry: CapturedTest; claim: string; relPath: string }[],
  ): Promise<void> {
    await mkdir(path.join(this.outputDir, "money-shots"), { recursive: true });
    const lines: string[] = [
      "# Money-shot digest",
      "",
      "One confirming frame per test — the visual proof that the behavior under test",
      "actually happened. Scroll this page to validate the whole suite by eye.",
      "",
      `${digest.length} shot${digest.length === 1 ? "" : "s"} from this run.`,
      "",
    ];

    const byModule = new Map<string, typeof digest>();
    for (const item of digest) {
      const bucket = byModule.get(item.entry.module) ?? [];
      bucket.push(item);
      byModule.set(item.entry.module, bucket);
    }

    for (const [moduleName, items] of sortModules(byModule)) {
      lines.push(`## ${moduleName}`, "");
      for (const item of items) {
        // Paths here are relative to money-shots/index.md.
        const href = encodeURI(item.relPath.replace(/^money-shots\//, ""));
        lines.push(
          `### ${statusIcon(item.entry)} ${item.entry.title}`,
          "",
          `\`${item.entry.specFile}\` — _${item.claim}_`,
          "",
          `![${item.claim}](${href})`,
          "",
        );
      }
    }

    await writeFile(path.join(this.outputDir, "money-shots", "index.md"), lines.join("\n"), "utf8");
  }

  private async writeFailures(entries: CapturedTest[]): Promise<void> {
    const failures = entries.filter((entry) => !entry.ok);
    const lines: string[] = ["# Failure report", ""];

    if (failures.length === 0) {
      lines.push("No failures in this run. ✅", "");
      await writeFile(path.join(this.outputDir, "failures.md"), lines.join("\n"), "utf8");
      return;
    }

    lines.push(
      `${failures.length} failing test${failures.length === 1 ? "" : "s"}.`,
      "",
      "| Module | Spec | Test | Status |",
      "| --- | --- | --- | --- |",
    );
    for (const entry of failures) {
      lines.push(`| ${entry.module} | \`${entry.specFile}\` | ${entry.title} | ${entry.status} |`);
    }
    lines.push("");

    for (const entry of failures) {
      const rel = path.posix.join(
        "modules",
        slugify(entry.module),
        entry.specFile.replace(/\.spec\.ts$/, ""),
        slugify(entry.title),
      );
      lines.push(
        `## ${entry.specFile} › ${entry.title}`,
        "",
        `- **Module:** ${entry.module}`,
        `- **Status:** ${entry.status}${entry.retries > 0 ? ` (after ${entry.retries} ${entry.retries === 1 ? "retry" : "retries"})` : ""}`,
        `- **Evidence:** [\`${rel}/\`](${encodeURI(`${rel}/result.md`)})`,
        "",
        "```",
        entry.errorText || "(no error text captured)",
        "```",
        "",
      );
    }

    await writeFile(path.join(this.outputDir, "failures.md"), lines.join("\n"), "utf8");
  }
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function guessExtension(contentType: string): string {
  if (contentType.startsWith("image/png")) return ".png";
  if (contentType.startsWith("image/jpeg")) return ".jpg";
  if (contentType.startsWith("video/webm")) return ".webm";
  if (contentType.startsWith("application/zip")) return ".zip";
  return ".txt";
}

function groupByModule(entries: CapturedTest[]): [string, CapturedTest[]][] {
  const map = new Map<string, CapturedTest[]>();
  for (const entry of entries) {
    const bucket = map.get(entry.module) ?? [];
    bucket.push(entry);
    map.set(entry.module, bucket);
  }
  return sortModules(map);
}

/**
 * Matrix sections are numbered (`1. Startup…`), so a numeric-aware sort keeps
 * report order identical to the matrix. Unclassified sinks to the bottom.
 */
function sortModules<T>(map: Map<string, T[]>): [string, T[]][] {
  return [...map].sort(([a], [b]) => {
    if (a === UNCLASSIFIED) return 1;
    if (b === UNCLASSIFIED) return -1;
    const numA = Number.parseInt(a, 10);
    const numB = Number.parseInt(b, 10);
    if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) return numA - numB;
    return a.localeCompare(b);
  });
}

export default QaReporter;
