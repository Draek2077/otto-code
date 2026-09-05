#!/usr/bin/env node
// Before/after import survival plus explicit, reviewed composition contracts.
// See docs/upstream-merges.md for capture timing, ref safety and limitations.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  AnalysisError,
  analyzeIntegrations,
  isSource,
  isTest,
  normalizeBrand,
  resolveModule,
} from "./merge-integration-analysis.mjs";
import { CONTRACT_VERSION, EXCLUSIONS } from "./merge-integration-contracts.mjs";

const BASELINE_PATH = ".tmp/merge-orphan-baseline.json";
const SNAPSHOT_VERSION = 2;
const contractHash = () =>
  createHash("sha256")
    .update(readFileSync(new URL("./merge-integration-contracts.mjs", import.meta.url)))
    .digest("hex");

export class Repository {
  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }
  git(...args) {
    try {
      return execFileSync("git", args, {
        cwd: this.cwd,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      throw new AnalysisError(
        `git ${args[0]} failed: ${String(error.stderr ?? error.message).trim()}`,
      );
    }
  }
  commit(ref, upstream = false) {
    if (!ref || ref.startsWith("-")) throw new AnalysisError("Expected an explicit Git ref");
    if (upstream) {
      if (/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(ref)) ref = "refs/upstream-tags/" + ref;
      else if (
        !/^[a-f\d]{40}$/i.test(ref) &&
        !ref.startsWith("refs/upstream-tags/") &&
        !ref.startsWith("refs/remotes/upstream/")
      )
        throw new AnalysisError(
          "Upstream input must be a full SHA or an explicit upstream ref; Otto release tags are not upstream tags",
        );
    }
    return this.git("rev-parse", "--verify", "--end-of-options", ref + "^{commit}").trim();
  }
  ancestor(before, after) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", before, after], {
        cwd: this.cwd,
        stdio: "pipe",
      });
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw new AnalysisError(`Cannot establish ancestry for ${before} -> ${after}`);
    }
  }
  comparison(beforeRef, targetRef, afterRef) {
    const before = this.commit(beforeRef);
    const target = this.commit(targetRef, true);
    if (this.git("rev-parse", "--is-shallow-repository").trim() === "true")
      throw new AnalysisError(
        "Shallow history cannot certify a premerge baseline; fetch complete history first",
      );
    const bases = this.git("merge-base", "--all", before, target)
      .trim()
      .split("\n")
      .filter(Boolean);
    if (bases.length !== 1) throw new AnalysisError("Expected one premerge common ancestor");
    if (this.ancestor(target, before))
      throw new AnalysisError(
        "Invalid premerge baseline: it already contains the upstream target. Supply the actual premerge ref, not the reviewed postmerge state",
      );
    const after = afterRef ? this.commit(afterRef) : null;
    if (after && !this.ancestor(before, after))
      throw new AnalysisError("Candidate does not descend from the supplied premerge baseline");
    if (after && !this.ancestor(target, after))
      throw new AnalysisError("Candidate does not contain the supplied upstream target");
    return { before, target, after, mergeBase: bases[0] };
  }
  renames(before, after) {
    const tokens = this.git(
      "diff",
      "--name-status",
      "-z",
      "-M",
      before,
      ...(after ? [after] : []),
      "--",
    ).split("\0");
    const result = new Map();
    for (let i = 0; i < tokens.length && tokens[i]; ) {
      const status = tokens[i++];
      const from = tokens[i++];
      if (status.startsWith("R")) result.set(normalizeBrand(from), normalizeBrand(tokens[i++]));
      else if (status.startsWith("C")) i++;
    }
    return result;
  }
  tree(ref, renames = new Map()) {
    const paths = ref
      ? this.git("ls-tree", "-r", "--name-only", "-z", ref).split("\0").filter(Boolean)
      : this.git("ls-files", "-z").split("\0").filter(Boolean);
    const originals = new Map();
    for (const path of paths) {
      if (!ref && !existsSync(resolve(this.cwd, path))) continue;
      const normalized = normalizeBrand(path);
      if (originals.has(normalized))
        throw new AnalysisError(
          `Brand-normalized path collision: ${originals.get(normalized)} and ${path}`,
        );
      originals.set(normalized, path);
    }
    const cache = new Map();
    const decode = (bytes, path) => {
      let content;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new AnalysisError(`Invalid UTF-8 source: ${path}`);
      }
      // Otto has literal NUL separators inside valid strings/template literals.
      // Decode strictly, then let the TypeScript parser decide source validity.
      return content;
    };
    const read = (file) => {
      if (cache.has(file)) return cache.get(file);
      const path = originals.get(file);
      if (!path) throw new AnalysisError(`Missing source ${file}`);
      const bytes = ref
        ? execFileSync("git", ["show", ref + ":" + path], {
            cwd: this.cwd,
            maxBuffer: 128 * 1024 * 1024,
            stdio: "pipe",
          })
        : readFileSync(resolve(this.cwd, path));
      const content = decode(bytes, path);
      cache.set(file, content);
      return content;
    };
    const preload = (files) => {
      if (!ref) return;
      for (let start = 0; start < files.length; start += 256) {
        const batch = files.slice(start, start + 256);
        const input = batch.map((file) => ref + ":" + originals.get(file)).join("\n") + "\n";
        const output = execFileSync("git", ["cat-file", "--batch"], {
          cwd: this.cwd,
          input,
          maxBuffer: 128 * 1024 * 1024,
          stdio: "pipe",
        });
        let offset = 0;
        for (const file of batch) {
          const end = output.indexOf(10, offset);
          const header = output.subarray(offset, end).toString("utf8");
          const match = /^[a-f\d]+ blob (\d+)$/.exec(header);
          if (end < 0 || !match)
            throw new AnalysisError(`Cannot read Git source blob ${file}: ${header}`);
          const size = Number(match[1]);
          cache.set(file, decode(output.subarray(end + 1, end + 1 + size), file));
          offset = end + 1 + size + 1;
        }
      }
    };
    return {
      ref,
      files: new Set(originals.keys()),
      read,
      preload,
      mapPath: (file) => (originals.has(file) ? file : (renames.get(file) ?? file)),
    };
  }
}

// The broad snapshot remains an import-survival heuristic. It is not a React
// reachability analysis and does not participate in the CI integration gate.
export function importerIndex(reader) {
  const index = new Map();
  const candidates = [];
  reader.preload?.([...reader.files].filter((file) => isSource(file) && !isTest(file)));
  for (const file of reader.files) {
    if (!isSource(file) || isTest(file)) continue;
    const source = ts.createSourceFile(file, reader.read(file), ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length)
      throw new AnalysisError(`Cannot capture/check imports: syntax error in ${file}`);
    const specs = [];
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(node) && !node.isTypeOnly)
      ) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
          specs.push(node.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(source) === "require") &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        specs.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const spec of specs) {
      let target;
      try {
        target = resolveModule(spec, file, reader.files);
      } catch (error) {
        candidates.push({ file, specifier: spec, reason: error.message });
        continue;
      }
      if (!target || target === file) continue;
      if (!index.has(target)) index.set(target, new Set());
      index.get(target).add(file);
    }
  }
  return { index, candidates };
}

export function captureBaseline(repo, refs) {
  const before = repo.tree(refs.before);
  const target = repo.tree(refs.target);
  const base = repo.tree(refs.mergeBase);
  const { index, candidates } = importerIndex(before);
  const entries = {};
  for (const file of [...before.files].sort()) {
    if (!isSource(file) || isTest(file) || target.files.has(file) || base.files.has(file)) continue;
    entries[file] = [...(index.get(file) ?? [])].sort();
  }
  return {
    schemaVersion: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    head: refs.before,
    target: { commit: refs.target },
    mergeBase: refs.mergeBase,
    entries,
    candidates,
  };
}

function validateBaseline(repo, baseline) {
  if (
    !baseline ||
    baseline.schemaVersion !== SNAPSHOT_VERSION ||
    !baseline.head ||
    !baseline.target?.commit ||
    !baseline.entries ||
    typeof baseline.entries !== "object" ||
    Array.isArray(baseline.entries)
  )
    throw new AnalysisError(
      "Invalid/unsupported baseline. Recapture with --baseline --before <actual-premerge-sha> --at <upstream-sha>; never capture the postmerge state",
    );
  for (const [path, imports] of Object.entries(baseline.entries))
    if (
      !isSource(path) ||
      !Array.isArray(imports) ||
      imports.some((item) => typeof item !== "string")
    )
      throw new AnalysisError("Invalid baseline importer entries");
  const refs = repo.comparison(baseline.head, baseline.target.commit);
  if (refs.mergeBase !== baseline.mergeBase)
    throw new AnalysisError("Baseline merge-base provenance does not match Git history");
  return refs;
}

export function checkBaseline(repo, baseline, afterRef) {
  const refs = validateBaseline(repo, baseline);
  const after = repo.commit(afterRef ?? "HEAD");
  if (!repo.ancestor(refs.before, after))
    throw new AnalysisError("Check HEAD does not descend from the premerge baseline");
  if (!repo.ancestor(refs.target, after)) {
    let mergeHead;
    try {
      mergeHead = repo.commit("MERGE_HEAD");
    } catch {
      /* handled below */
    }
    if (afterRef || !mergeHead || !repo.ancestor(refs.target, mergeHead))
      throw new AnalysisError("Check target has not been merged into the candidate");
  }
  if (!afterRef && repo.git("ls-files", "-u").trim())
    throw new AnalysisError("Resolve all index conflicts before checking imports");
  const renames = repo.renames(refs.before, afterRef ? after : null);
  const reader = repo.tree(afterRef ? after : null, renames);
  const { index, candidates } = importerIndex(reader);
  const findings = [];
  for (const [original, before] of Object.entries(baseline.entries)) {
    if (!before.length) continue;
    const file = reader.mapPath(original);
    if (!reader.files.has(file)) findings.push({ category: "deleted", file: original, before });
    else if (!index.get(file)?.size) findings.push({ category: "lost-importers", file, before });
  }
  return {
    mode: "check",
    refs: { ...refs, after },
    worktree: !afterRef,
    worktreeStatus: afterRef ? null : repo.git("status", "--porcelain"),
    findings,
    candidates,
    note: "Import loss is a structural candidate for review, not proof of a broken feature",
  };
}

function parseArgs(argv) {
  const flags = new Set(["baseline", "check", "integrations", "json", "verbose"]);
  const values = new Set(["before", "after", "at", "baseline-file"]);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith("--") ? argv[i].slice(2) : "";
    if (key in options || (!flags.has(key) && !values.has(key)))
      throw new AnalysisError(`Unknown or repeated argument: ${argv[i]}`);
    if (flags.has(key)) options[key] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw new AnalysisError(`Missing value for --${key}`);
      options[key] = argv[++i];
    }
  }
  validateOptions(options);
  return options;
}

function validateOptions(options) {
  if (["baseline", "check", "integrations"].filter((key) => options[key]).length !== 1)
    throw new AnalysisError("Choose exactly one of --baseline, --check or --integrations");
  if (
    options.integrations &&
    (!options.before || !options.after || !options.at || options["baseline-file"])
  )
    throw new AnalysisError(
      "--integrations requires --before, --at and --after and does not use a snapshot file",
    );
  if (options.baseline && (!options.at || options.after))
    throw new AnalysisError("--baseline requires --at and does not accept --after");
  if (options.check && (options.before || options.at))
    throw new AnalysisError("--check takes its before/target refs from the baseline file");
}

export function run(argv, repo = new Repository()) {
  const options = parseArgs(argv);
  const baselinePath = resolve(repo.cwd, options["baseline-file"] ?? BASELINE_PATH);
  let report;
  if (options.baseline) {
    if (!options.before && repo.git("status", "--porcelain", "--untracked-files=no").trim())
      throw new AnalysisError(
        "Capture from a clean tracked tree or supply --before <premerge-ref> for Git-object capture",
      );
    const refs = repo.comparison(options.before ?? "HEAD", options.at);
    report = captureBaseline(repo, refs);
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify(report, null, 2) + "\n");
    report = { ...report, mode: "baseline", writtenTo: baselinePath };
  } else if (options.check) {
    if (!existsSync(baselinePath))
      throw new AnalysisError(
        `No premerge baseline at ${baselinePath}; capture with an explicit premerge ref`,
      );
    let baseline;
    try {
      baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    } catch {
      throw new AnalysisError(`Invalid JSON baseline at ${baselinePath}`);
    }
    report = checkBaseline(repo, baseline, options.after);
  } else {
    const refs = repo.comparison(options.before, options.at, options.after);
    const analysis = analyzeIntegrations(
      repo.tree(refs.after, repo.renames(refs.target, refs.after)),
    );
    report = {
      schemaVersion: 1,
      mode: "integrations",
      refs,
      contractVersion: CONTRACT_VERSION,
      contractHash: contractHash(),
      ...analysis,
      exclusions: EXCLUSIONS,
    };
  }
  let exitCode = 0;
  if (report.results?.some((item) => item.status === "violation") || report.findings?.length)
    exitCode = 1;
  if (report.results?.some((item) => item.status === "error")) exitCode = 2;
  return { options, report, exitCode };
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Merge guard: ${report.mode}`);
  if (report.refs) console.log(JSON.stringify(report.refs));
  if (report.writtenTo) console.log(`Premerge snapshot: ${report.writtenTo}`);
  for (const result of report.results ?? []) {
    console.log(
      `${result.status.toUpperCase()} ${result.id}${result.detail ? ": " + result.detail : ""}`,
    );
    for (const edge of result.edges ?? [])
      console.log(
        `  ${edge.status}: ${edge.owner.file}#${edge.owner.name} -> ${edge.target.name}: ${edge.detail}`,
      );
  }
  for (const finding of report.findings ?? [])
    console.log(
      `CANDIDATE ${finding.category}: ${finding.file}; previous importers: ${finding.before.join(", ")}`,
    );
  for (const candidate of report.candidates ?? [])
    console.log(`UNRESOLVED IMPORT ${candidate.file}: ${candidate.specifier}: ${candidate.reason}`);
  for (const exclusion of report.exclusions ?? [])
    console.log(`EXCLUSION ${exclusion.id}: ${exclusion.reason}`);
  if (report.note) console.log(report.note);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { options, report, exitCode } = run(process.argv.slice(2));
    printReport(report, options.json);
    process.exitCode = exitCode;
  } catch (error) {
    const report = { status: "error", detail: error.message };
    if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else console.error(`ANALYSIS ERROR: ${error.message}`);
    process.exitCode = 2;
  }
}
