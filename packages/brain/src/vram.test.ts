import { test } from "vitest";
import assert from "node:assert/strict";

import * as vram from "./vram.js";
import type { Model } from "./types.js";
import type { Profile } from "./config/schema.js";

// Geometry read from the real Qwen3.6-27B GGUF header.
const QWEN36_27B = {
  arch: "qwen35",
  blockCount: 64,
  headCountKv: 4,
  keyLength: 256,
  valueLength: 256,
  contextLength: 262144,
};

const MODEL = {
  sizeBytes: 15.41 * vram.GIB,
  mmprojBytes: 0.87 * vram.GIB,
  mmprojPath: "C:\\fake\\mmproj.gguf",
  metadata: QWEN36_27B,
} as unknown as Model;

const PROFILE = {
  contextSize: 225000,
  cacheTypeK: "q8_0",
  cacheTypeV: "q8_0",
  vision: false,
} as unknown as Profile;

const RTX5090 = 31.8 * vram.GIB;

test("cache type byte widths match GGUF block layouts", () => {
  assert.equal(vram.cacheTypeBytes("f16"), 2);
  assert.equal(vram.cacheTypeBytes("q8_0"), 34 / 32);
  assert.equal(vram.cacheTypeBytes("Q8_0"), 34 / 32, "case insensitive");
  assert.throws(() => vram.cacheTypeBytes("q3_k_m"), /unknown KV cache type/);
});

test("theoretical KV formula computes the dense worst case", () => {
  const perToken = vram.theoreticalKvBytesPerToken(QWEN36_27B, "q8_0", "q8_0");
  // 64 layers * 4 kv heads * (256 + 256) * (34/32)
  assert.equal(perToken, 64 * 4 * 512 * (34 / 32));
});

test("theoretical formula returns null when geometry is missing", () => {
  assert.equal(vram.theoreticalKvBytesPerToken({ arch: "x" }, "q8_0", "q8_0"), null);
  assert.equal(vram.theoreticalKvBytesPerToken(null, "q8_0", "q8_0"), null);
});

test("measured calibration is preferred over the theoretical estimate", () => {
  const calibration = { kvBytesPerToken: 38.55 * 1024, baseOverheadBytes: 0.3 * vram.GIB };

  const measured = vram.budget({
    model: MODEL,
    profile: PROFILE,
    calibration,
    totalVramBytes: RTX5090,
  });
  const guessed = vram.budget({
    model: MODEL,
    profile: PROFILE,
    calibration: null,
    totalVramBytes: RTX5090,
  });

  assert.equal(measured.source, "measured");
  assert.equal(guessed.source, "theoretical");
  assert.ok(measured.kvBytes < guessed.kvBytes, "the formula overestimates for this architecture");
});

test("measured budget reproduces the observed 24.3G at 225K context", () => {
  const calibration = { kvBytesPerToken: 38.55 * 1024, baseOverheadBytes: 0.3 * vram.GIB };
  const b = vram.budget({ model: MODEL, profile: PROFILE, calibration, totalVramBytes: RTX5090 });

  const totalGiB = b.totalBytes / vram.GIB;
  // Hardware measurement was 24.27 GiB; allow half a gigabyte of slack.
  assert.ok(Math.abs(totalGiB - 24.3) < 0.5, `expected ~24.3G, computed ${totalGiB.toFixed(2)}G`);
  assert.equal(b.fits, true);
});

test("vision adds the projector only when enabled and available", () => {
  const calibration = { kvBytesPerToken: 38.55 * 1024, baseOverheadBytes: 0.3 * vram.GIB };
  const without = vram.budget({
    model: MODEL,
    profile: PROFILE,
    calibration,
    totalVramBytes: RTX5090,
  });
  const withVision = vram.budget({
    model: MODEL,
    profile: { ...PROFILE, vision: true },
    calibration,
    totalVramBytes: RTX5090,
  });

  assert.equal(without.mmprojBytes, 0);
  assert.equal(withVision.mmprojBytes, MODEL.mmprojBytes);
  assert.ok(withVision.totalBytes > without.totalBytes);
});

test("an oversized context is reported as not fitting", () => {
  const calibration = { kvBytesPerToken: 38.55 * 1024, baseOverheadBytes: 0.3 * vram.GIB };
  const b = vram.budget({
    model: MODEL,
    profile: { ...PROFILE, contextSize: 2_000_000 },
    calibration,
    totalVramBytes: RTX5090,
  });
  assert.equal(b.fits, false);
  assert.ok(b.headroomBytes < 0);
});

test("maxContextThatFits never exceeds the native context length", () => {
  const calibration = { kvBytesPerToken: 38.55 * 1024, baseOverheadBytes: 0.3 * vram.GIB };
  const max = vram.maxContextThatFits({
    model: MODEL,
    profile: PROFILE,
    calibration,
    totalVramBytes: RTX5090,
  });
  assert.ok(max! > 0);
  assert.ok(max! <= QWEN36_27B.contextLength, `${max} exceeded native ${QWEN36_27B.contextLength}`);
  assert.equal(max! % 4096, 0, "rounded to the step");
});

test("maxContextThatFits shrinks as the cache type grows", () => {
  const calibration = { kvBytesPerToken: 38.55 * 1024, baseOverheadBytes: 0.3 * vram.GIB };
  const common = { model: MODEL, calibration, totalVramBytes: RTX5090 };
  // f16 is ~2x q8_0 per element, so the theoretical path must yield less room.
  const q8 = vram.maxContextThatFits({
    ...common,
    profile: { ...PROFILE, cacheTypeK: "q8_0", cacheTypeV: "q8_0" },
  });
  const f16 = vram.maxContextThatFits({
    ...common,
    calibration: null,
    profile: { ...PROFILE, cacheTypeK: "f16", cacheTypeV: "f16" },
  });
  assert.ok(f16! < q8!, `f16 (${f16}) should fit less than measured q8_0 (${q8})`);
});

test("fitToBudget reports the context it was asked for, not the one it settled on", () => {
  const calibration = { kvBytesPerToken: 38.55 * 1024, baseOverheadBytes: 0.3 * vram.GIB };
  // Far more context than the card can hold, so the fit has to cut it down.
  const asked = 2_000_000;
  const fit = vram.fitToBudget({
    model: MODEL,
    profile: { ...PROFILE, contextSize: asked },
    calibration,
    totalVramBytes: RTX5090,
  });

  assert.equal(fit.adjusted, true);
  assert.ok(fit.profile.contextSize < asked, "the profile that runs was cut down");
  // The point of the field: once the adjustment is applied, the number the user
  // actually configured is unrecoverable from `fit.profile`, and a benchmark
  // that stores only the effective context claims a score at a context that was
  // never measured.
  assert.equal(fit.requestedContextSize, asked);
});

test("fitToBudget still reports the requested context when nothing was adjusted", () => {
  const calibration = { kvBytesPerToken: 38.55 * 1024, baseOverheadBytes: 0.3 * vram.GIB };
  const fit = vram.fitToBudget({
    model: MODEL,
    profile: PROFILE,
    calibration,
    totalVramBytes: RTX5090,
  });

  assert.equal(fit.adjusted, false);
  assert.equal(fit.requestedContextSize, PROFILE.contextSize);
  assert.equal(fit.profile.contextSize, PROFILE.contextSize);
});

test("a model too large for the card fits nothing", () => {
  const huge = { ...MODEL, sizeBytes: 60 * vram.GIB };
  const max = vram.maxContextThatFits({
    model: huge,
    profile: PROFILE,
    calibration: { kvBytesPerToken: 38.55 * 1024, baseOverheadBytes: 0.3 * vram.GIB },
    totalVramBytes: RTX5090,
  });
  assert.equal(max, null);
});
