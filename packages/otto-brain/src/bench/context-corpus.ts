/**
 * A window-sized synthetic codebase for the `context-stress` benchmark task.
 *
 * The point of this task is the opposite of a clever puzzle: it is a *volume*
 * test. A staged pipeline has N modules, each of which returns its input
 * unchanged (a placeholder). The real rule each stage must implement -- an
 * operation and an operand -- lives ONLY in the specification, which is split
 * across `docs/spec/part_XX.md` and generated verbose enough to fill a target
 * fraction of the model's context window. So the model cannot fix any stage
 * without reading the spec, and it cannot fix ALL of them without holding most
 * of the window at once.
 *
 * That is the design guarantee: a run that scores well on the hidden per-stage
 * oracle MUST have held (read and kept in context) at least the target fraction
 * of the window. A run that shortcuts scores low AND shows low held context --
 * which is exactly the signal a 1-2%-held long-horizon task fails to give.
 *
 * Everything here is deterministic (seeded by stage index, never `Math.random`)
 * so the corpus, the reference fix, and the oracle all agree across runs. All
 * arithmetic is bounded mod 1000 so the JavaScript-computed expectations match
 * Python's integer semantics exactly (no bignum drift through a long pipeline).
 */

/** One stage's fully-resolved rule: the op, its operand, and a probe/expected. */
export interface StageSpec {
  index: number;
  op: "add" | "mul" | "shift";
  operand: number;
  /** A small fixed probe input for this stage's oracle test. */
  sample: number;
  /** The correct `apply(sample)`, computed here so the oracle is self-consistent. */
  expected: number;
}

/** The generated corpus: what the model sees, the hidden oracle, and the fix. */
export interface ContextCorpus {
  /** Files shown to the model: docs (read-only) + buggy Python modules. */
  files: Record<string, string>;
  /** The correct Python modules, kept ONLY for the unit test's oracle check. */
  reference: Record<string, string>;
  /** The hidden per-stage oracle (`test_pipeline.py`), never shown to the model. */
  hiddenTest: string;
  /** Basenames of the runnable Python modules (no docs), for the test harness. */
  pyFiles: string[];
  /** The spec doc paths, in order. */
  specFiles: string[];
  /** The resolved stage rules. */
  stages: StageSpec[];
  /** The approximate character budget the docs were padded to. */
  docChars: number;
}

/** Neutral spec-prose filler, used to pad each part to its character budget so
 *  the corpus reaches the target window fraction. Deterministic by index. */
const FILLER = [
  "This constraint is load-bearing: downstream stages assume the transform has already been applied, so skipping it silently corrupts every later result.",
  "The operand was chosen during calibration and must not be inferred from the code, which deliberately carries no hint of its value.",
  "Reviewers should treat this section as normative; where the prose and a placeholder disagree, the prose wins.",
  "Historically this rule lived in the module itself, but colocating it with the code led to drift, so it was moved here and the code reset to a passthrough.",
  "Note that the ordering of stages is significant only through the running total; each stage's own rule is independent of its neighbours.",
  "A conforming implementation returns an integer in the range produced by the bounded arithmetic described below, never a float.",
  "The specification is intentionally verbose so that a reader must carry it in working memory rather than pattern-matching a single line.",
  "When in doubt, re-read the operand: transcription errors here are the most common cause of a failing stage.",
];

function operandFor(index: number): number {
  // Knuth multiplicative hash, kept well under 2^53 for any realistic N, mapped
  // to a readable 3-digit operand so the spec prose can name it plainly.
  return 100 + ((index * 2654435761) % 900);
}

function opFor(index: number): StageSpec["op"] {
  return (["add", "mul", "shift"] as const)[index % 3];
}

/** Apply a stage's rule, bounded mod 1000 (matches the generated Python). */
function applyRule(op: StageSpec["op"], operand: number, x: number): number {
  if (op === "mul") return (x * operand) % 1000;
  if (op === "shift") return (x + operand * 2) % 1000;
  return (x + operand) % 1000;
}

/** The Python expression body for a stage's correct `apply`, matching applyRule. */
function pyExpr(op: StageSpec["op"], operand: number): string {
  if (op === "mul") return `(x * ${operand}) % 1000`;
  if (op === "shift") return `(x + ${operand * 2}) % 1000`;
  return `(x + ${operand}) % 1000`;
}

/** A human-readable rule description for the spec prose. */
function ruleProse(op: StageSpec["op"], operand: number): string {
  if (op === "mul")
    return `multiply the running value by operand **${operand}**, then take the result modulo 1000`;
  if (op === "shift")
    return `add **twice** operand ${operand} (that is, ${operand * 2}) to the running value, then take the result modulo 1000`;
  return `add operand **${operand}** to the running value, then take the result modulo 1000`;
}

function stageModuleName(index: number): string {
  return `stage_${String(index).padStart(2, "0")}`;
}

function buggyStage(index: number): string {
  const name = stageModuleName(index);
  return (
    `"""${name}: one stage of the pipeline.\n\n` +
    `This module is a PLACEHOLDER. It must apply the rule documented for stage ` +
    `${index} in the specification under docs/spec/. Until then it returns its\n` +
    `input unchanged, which the oracle test for this stage will reject.\n"""\n\n\n` +
    `def apply(x):\n` +
    `    # TODO: implement stage ${index} per docs/spec/.\n` +
    `    return x\n`
  );
}

function referenceStage(index: number, op: StageSpec["op"], operand: number): string {
  const name = stageModuleName(index);
  return (
    `"""${name}: one stage of the pipeline (reference implementation)."""\n\n\n` +
    `def apply(x):\n` +
    `    return ${pyExpr(op, operand)}\n`
  );
}

function pipelineModule(count: number): string {
  const names = Array.from({ length: count }, (_, i) => stageModuleName(i));
  const imports = names.map((n) => `import ${n}`).join("\n");
  const list = names.join(", ");
  return (
    `"""The staged pipeline. Applies every stage's apply() in order.\n\n` +
    `Each stage is implemented in its own module; the rules live in docs/spec/.\n"""\n` +
    `${imports}\n\n` +
    `STAGES = [${list}]\n\n\n` +
    `def run(x):\n` +
    `    total = x\n` +
    `    for stage in STAGES:\n` +
    `        total = stage.apply(total)\n` +
    `    return total\n`
  );
}

const PIPELINE_START = 5;

function endToEnd(stages: StageSpec[]): number {
  let total = PIPELINE_START;
  for (const s of stages) total = applyRule(s.op, s.operand, total);
  return total;
}

function hiddenTest(stages: StageSpec[]): string {
  const imports = stages.map((s) => `import ${stageModuleName(s.index)}`).join("\n");
  const perStage = stages
    .map(
      (s) =>
        `    def test_${stageModuleName(s.index)}(self):\n` +
        `        self.assertEqual(${stageModuleName(s.index)}.apply(${s.sample}), ${s.expected})\n`,
    )
    .join("\n");
  const final = endToEnd(stages);
  return (
    `import unittest\n\n` +
    `${imports}\n` +
    `import pipeline\n\n\n` +
    `class TestPipeline(unittest.TestCase):\n` +
    `${perStage}\n` +
    `    def test_pipeline_end_to_end(self):\n` +
    `        self.assertEqual(pipeline.run(${PIPELINE_START}), ${final})\n\n\n` +
    `if __name__ == "__main__":\n` +
    `    unittest.main()\n`
  );
}

/** Pad `body` with deterministic filler prose until it reaches `budgetChars`. */
function padTo(body: string, budgetChars: number, seed: number): string {
  let out = body;
  let i = seed;
  while (out.length < budgetChars) {
    out += `\n\n${FILLER[i % FILLER.length]}`;
    i += 1;
  }
  return out;
}

/** Build one spec part covering `stages`, padded to `budgetChars`. */
function specPart(partIndex: number, stages: StageSpec[], budgetChars: number): string {
  const heading =
    `# Pipeline specification - part ${String(partIndex).padStart(2, "0")}\n\n` +
    `This part defines the rule for stages ${stages[0].index}–${stages[stages.length - 1].index}. ` +
    `Each stage's module in the working copy is a passthrough placeholder; implement its \`apply(x)\` ` +
    `exactly as written here. All arithmetic is bounded modulo 1000 and returns an integer.\n`;
  const entries = stages
    .map(
      (s) =>
        `\n## Stage ${s.index}\n\n` +
        `Module: \`${stageModuleName(s.index)}.py\`. Rule: ${ruleProse(s.op, s.operand)}. ` +
        `Equivalently, \`apply(x)\` must return \`${pyExpr(s.op, s.operand)}\`.\n`,
    )
    .join("");
  return padTo(heading + entries, budgetChars, partIndex * 31 + stages[0].index);
}

/**
 * Generate a window-sized staged-pipeline corpus whose spec fills roughly
 * `targetTokens` (estimated at ~4 chars/token). Returns the buggy corpus the
 * model works on, the reference fix, and the hidden oracle.
 */
export function generateContextCorpus({ targetTokens }: { targetTokens: number }): ContextCorpus {
  // ~3000 tokens of spec per stage keeps the stage count sane while letting the
  // docs carry the volume; clamp so tiny windows still get a real pipeline and
  // huge windows do not generate an unbounded number of modules.
  const stageCount = Math.max(12, Math.min(48, Math.round(targetTokens / 3000)));
  const docChars = Math.max(2000, targetTokens * 4);

  const stages: StageSpec[] = Array.from({ length: stageCount }, (_, index) => {
    const op = opFor(index);
    const operand = operandFor(index);
    const sample = 3 + (index % 7);
    return { index, op, operand, sample, expected: applyRule(op, operand, sample) };
  });

  // Split stages across doc parts (~6 per part), each padded to an equal share
  // of the doc budget so the whole spec sums to ~docChars.
  const partCount = Math.min(stageCount, Math.max(3, Math.round(stageCount / 6)));
  const perPartBudget = Math.floor(docChars / partCount);
  const partStride = Math.ceil(stageCount / partCount);

  const files: Record<string, string> = {};
  const reference: Record<string, string> = {};
  const specFiles: string[] = [];

  files["README.md"] =
    "# staged-pipeline\n\nA numeric pipeline built from independent stages. Every stage " +
    "module under the working root is a placeholder that returns its input unchanged; the " +
    "rule each one must implement is specified in `docs/spec/`. Fix every stage, then run " +
    "`python -m unittest test_pipeline`.\n";
  files["docs/OVERVIEW.md"] =
    "# Specification overview\n\nThe pipeline applies each stage's `apply(x)` in order, starting " +
    `from ${PIPELINE_START}. There are ${stageCount} stages. The rule for each stage - its ` +
    "operation and operand - is defined in the numbered parts under `docs/spec/`. The code carries " +
    "no hint of the operands; you must read the spec.\n";

  for (let p = 0; p < partCount; p += 1) {
    const slice = stages.slice(p * partStride, (p + 1) * partStride);
    if (!slice.length) continue;
    const path = `docs/spec/part_${String(p).padStart(2, "0")}.md`;
    files[path] = specPart(p, slice, perPartBudget);
    specFiles.push(path);
  }

  const pyFiles: string[] = [];
  for (const s of stages) {
    const file = `${stageModuleName(s.index)}.py`;
    files[file] = buggyStage(s.index);
    reference[file] = referenceStage(s.index, s.op, s.operand);
    pyFiles.push(file);
  }
  files["pipeline.py"] = pipelineModule(stageCount);
  reference["pipeline.py"] = files["pipeline.py"];
  pyFiles.push("pipeline.py");

  return {
    files,
    reference,
    hiddenTest: hiddenTest(stages),
    pyFiles,
    specFiles,
    stages,
    docChars,
  };
}
