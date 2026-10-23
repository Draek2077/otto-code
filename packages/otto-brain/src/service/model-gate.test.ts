import { expect, it } from "vitest";
import { decideModelGate } from "./model-gate.js";
import type { Model } from "../types.js";
function model(id: string): Model {
  return {
    id,
    displayName: id.toUpperCase(),
    modelPath: `${id}.gguf`,
    mmprojPath: null,
    mmprojBytes: 0,
    quant: null,
    sizeBytes: 1,
    metadata: null,
    features: { mtp: false, imatrix: false, distilled: false },
  };
}
const a = model("a");
const b = model("b");
it("locked requests use only the selected stable model identities", () => {
  expect(
    decideModelGate({
      lockModel: true,
      requestedName: "b",
      pinned: a,
      pinnedModels: [a, b],
      resolved: null,
    }),
  ).toEqual({ ok: true, model: b });
  expect(
    decideModelGate({ lockModel: true, requestedName: null, pinned: a, resolved: null }),
  ).toEqual({ ok: true, model: a });
  expect(
    decideModelGate({ lockModel: true, requestedName: "c", pinned: a, resolved: b }),
  ).toMatchObject({ ok: false, status: 409 });
  expect(
    decideModelGate({ lockModel: true, requestedName: null, pinned: null, resolved: b }),
  ).toMatchObject({ ok: false, status: 503 });
});
it("unlocked requests distinguish unknown models from an empty library", () => {
  expect(decideModelGate({ lockModel: false, requestedName: "b", pinned: a, resolved: b })).toEqual(
    { ok: true, model: b },
  );
  expect(
    decideModelGate({ lockModel: false, requestedName: "missing", pinned: a, resolved: null }),
  ).toMatchObject({ ok: false, status: 404 });
  expect(
    decideModelGate({ lockModel: false, requestedName: null, pinned: a, resolved: null }),
  ).toMatchObject({ ok: false, status: 503 });
});
