import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import * as gguf from "./gguf.js";
import { scan, detectQuant, isProjectorFile, LMSTUDIO_MODELS_DIR } from "./models/index.js";

// The models module renamed MODELS_DIR -> LMSTUDIO_MODELS_DIR; keep the test
// body referring to `models.MODELS_DIR` by re-exposing it under the old name.
const models = { scan, detectQuant, isProjectorFile, MODELS_DIR: LMSTUDIO_MODELS_DIR };

/**
 * These run against the real model library when one is present. GGUF parsing
 * is the foundation every budget decision rests on, so it is verified against
 * actual files rather than a synthetic fixture.
 */

function anyModelFile() {
  if (!fs.existsSync(models.MODELS_DIR)) return null;
  const found = models.scan({ withMetadata: false });
  return found.length ? found[0] : null;
}

const sample = anyModelFile();
const skip = sample ? false : "no GGUF models found on this machine";

(skip ? test.skip : test)("reads a GGUF header without loading the whole file", () => {
  const { version, tensorCount, fileSize, meta } = gguf.readMetadata(sample!.modelPath);

  assert.ok(version >= 2, `unexpected GGUF version ${version}`);
  assert.ok(tensorCount > 0);
  assert.ok(fileSize > 1e8, "sample should be a real multi-hundred-MB model");
  assert.ok(meta["general.architecture"], "architecture must be present");
});

(skip ? test.skip : test)("huge token arrays are skipped rather than materialised", () => {
  const { meta } = gguf.readMetadata(sample!.modelPath);
  const tokens = meta["tokenizer.ggml.tokens"] as { skipped: boolean; count: number } | undefined;
  if (tokens === undefined) return; // not all models carry an embedded vocab
  assert.equal(Array.isArray(tokens), false, "vocabulary should not be decoded");
  assert.equal(tokens.skipped, true);
  assert.ok(tokens.count > 1000);
});

(skip ? test.skip : test)("summarize derives the geometry the VRAM budget needs", () => {
  const summary = gguf.summarize(sample!.modelPath);

  assert.equal(typeof summary.arch, "string");
  assert.ok(summary.contextLength! > 0, "context length is required for budgeting");
  assert.ok(summary.blockCount! > 0, "layer count is required");
  for (const key of ["headCountKv", "keyLength", "valueLength"] as const) {
    assert.ok(summary[key] === null || summary[key]! > 0, `${key} must be null or positive`);
  }
});

test("a non-GGUF file is rejected clearly", () => {
  const tmp = path.join(os.tmpdir(), `not-a-gguf-${process.pid}.gguf`);
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

(skip ? test.skip : test)("the catalog pairs vision projectors with their model", () => {
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

(skip ? test.skip : test)("catalog entries have unique display names", () => {
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
