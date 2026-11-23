import { fixtureRoot } from "../test-fixtures.js";
import { afterAll, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import * as gguf from "./gguf.js";
import { scan, detectQuant, isProjectorFile } from "./models/index.js";

const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-gguf-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
function uint64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}
function string(value: string): Buffer {
  const buffer = Buffer.from(value);
  return Buffer.concat([uint64(buffer.length), buffer]);
}
function field(key: string, value: string | number): Buffer {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(typeof value === "string" ? 8 : 4);
  const data = typeof value === "string" ? string(value) : Buffer.alloc(4);
  if (typeof value === "number") data.writeUInt32LE(value);
  return Buffer.concat([string(key), tag, data]);
}
const metadata = [
  field("general.architecture", "llama"),
  field("llama.context_length", 4096),
  field("llama.block_count", 16),
  field("llama.attention.head_count", 16),
  field("llama.attention.head_count_kv", 4),
  field("llama.embedding_length", 1024),
];
const arrayTag = Buffer.alloc(8);
arrayTag.writeUInt32LE(9);
arrayTag.writeUInt32LE(8, 4);
metadata.push(
  Buffer.concat([string("tokenizer.ggml.tokens"), arrayTag, uint64(2000), Buffer.alloc(16000)]),
);
const header = Buffer.alloc(24);
header.write("GGUF");
header.writeUInt32LE(3, 4);
header.writeBigUInt64LE(1n, 8);
header.writeBigUInt64LE(BigInt(metadata.length), 16);
const payload = Buffer.concat([header, ...metadata, Buffer.alloc(65536)]);
for (const repo of ["author/repo", "another/repo"]) {
  const dir = path.join(root, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "model-Q4_K_M.gguf"), payload);
}
fs.writeFileSync(path.join(root, "author/repo/mmproj-F16.gguf"), payload);
const models = {
  detectQuant,
  isProjectorFile,
  scan: (options: { withMetadata: boolean }) => scan({ ...options, modelsDir: root }),
};
const sample = models.scan({ withMetadata: false })[0];

test("reads a GGUF header without loading the whole file", () => {
  const { version, tensorCount, fileSize, meta } = gguf.readMetadata(sample!.modelPath);

  assert.ok(version >= 2, `unexpected GGUF version ${version}`);
  assert.ok(tensorCount > 0);
  assert.equal(fileSize, payload.length, "metadata reader leaves the tensor payload alone");
  assert.ok(meta["general.architecture"], "architecture must be present");
});

test("huge token arrays are skipped rather than materialised", () => {
  const { meta } = gguf.readMetadata(sample!.modelPath);
  const tokens = meta["tokenizer.ggml.tokens"] as { skipped: boolean; count: number } | undefined;
  if (tokens === undefined) return; // not all models carry an embedded vocab
  assert.equal(Array.isArray(tokens), false, "vocabulary should not be decoded");
  assert.equal(tokens.skipped, true);
  assert.ok(tokens.count > 1000);
});

test("summarize derives the geometry the VRAM budget needs", () => {
  const summary = gguf.summarize(sample!.modelPath);

  assert.equal(typeof summary.arch, "string");
  assert.ok(summary.contextLength! > 0, "context length is required for budgeting");
  assert.ok(summary.blockCount! > 0, "layer count is required");
  for (const key of ["headCountKv", "keyLength", "valueLength"] as const) {
    assert.ok(summary[key] === null || summary[key]! > 0, `${key} must be null or positive`);
  }
});

test("a non-GGUF file is rejected clearly", () => {
  const tmp = path.join(fixtureRoot(), `not-a-gguf-${process.pid}.gguf`);
  fs.writeFileSync(tmp, Buffer.from("THIS IS NOT A GGUF FILE AT ALL"));
  try {
    assert.throws(() => gguf.readMetadata(tmp), /not a GGUF file/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("normalizes both template preservation spellings into one capability", () => {
  assert.deepEqual(
    gguf.detectTemplateReasoningCapabilities(
      "{% if preserve_thinking %}{{ reasoning }}{% endif %}",
    ),
    { reasoning: true, reasoningPreservationArgument: "preserve_thinking" },
  );
  assert.deepEqual(
    gguf.detectTemplateReasoningCapabilities(
      "{% if preserve_reasoning %}{{ reasoning }}{% endif %}",
    ),
    { reasoning: true, reasoningPreservationArgument: "preserve_reasoning" },
  );
});

test("reads the reasoning control contract a chat template declares", () => {
  assert.deepEqual(
    gguf.detectTemplateReasoningCapabilities(
      "{%- if enable_thinking is defined and enable_thinking is false %}<think></think>{%- endif %}",
    ),
    { reasoning: true, reasoningToggleArgument: "enable_thinking" },
  );
  assert.deepEqual(
    gguf.detectTemplateReasoningCapabilities(
      "{%- if reasoning_effort not in ['low', 'medium', 'xhigh'] %}{{ raise_exception('bad') }}{%- endif %}",
    ),
    {
      reasoning: true,
      reasoningEffortArgument: "reasoning_effort",
      reasoningEffortValues: ["low", "medium", "xhigh"],
    },
  );
});

test("a thinking template that names no control argument earns no contract", () => {
  assert.deepEqual(gguf.detectTemplateReasoningCapabilities("<think>{{ content }}</think>"), {
    reasoning: true,
  });
});

test("ignores effort literals that Otto cannot express", () => {
  const detected = gguf.detectTemplateReasoningCapabilities(
    "{%- if reasoning_effort not in ['low', 'ultra', 'high'] %}{{ raise_exception('bad') }}{%- endif %}",
  );
  assert.deepEqual(detected.reasoningEffortValues, ["low", "high"]);
});

test("the catalog pairs vision projectors with their model", () => {
  const catalog = models.scan({ withMetadata: false });
  assert.ok(catalog.length > 0);

  for (const model of catalog) {
    assert.equal(
      models.isProjectorFile(model.modelPath),
      false,
      `${model.displayName}: an mmproj file must never be listed as a hostable model`,
    );
    if (model.mmprojPath) {
      assert.ok(model.mmprojBytes > 0, "a paired projector must report a size");
      assert.equal(
        path.dirname(model.mmprojPath),
        path.dirname(model.modelPath),
        "projectors are paired from the same directory",
      );
    }
  }
});

test("catalog entries have unique display names", () => {
  const catalog = models.scan({ withMetadata: false });
  const seen = new Set<string>();
  for (const model of catalog) {
    assert.equal(
      seen.has(model.displayName),
      false,
      `duplicate display name would be ambiguous in the picker: ${model.displayName}`,
    );
    seen.add(model.displayName);
  }
});

test("quantisation labels use the complete terminal filename suffix", () => {
  assert.equal(models.detectQuant("model-Q4_K_M.gguf"), "Q4_K_M");
  assert.equal(models.detectQuant("model-Q8_0.gguf"), "Q8_0");
  assert.equal(models.detectQuant("Qwable-27b_Q4_K_M.gguf"), "Q4_K_M");
  assert.equal(models.detectQuant("model-NVFP4-MTP.gguf"), "NVFP4");
  assert.equal(models.detectQuant("Muse-Glimmer-30B-UD-Q4_K_XL.gguf"), "Q4_K_XL");
  assert.equal(models.detectQuant("Muse-Glimmer-30B-UD-Q2_K_XL.gguf"), "Q2_K_XL");
  assert.equal(models.detectQuant("model-Q2_K_XL-00001-of-00002.gguf"), "Q2_K_XL");
  assert.equal(models.detectQuant("model-with-no-quant.gguf"), null);
});

test("quantisation suffix parsing remains bounded for malformed filenames", () => {
  assert.equal(models.detectQuant(`model-${"Q2_".repeat(50_000)}.gguf`), null);
});
