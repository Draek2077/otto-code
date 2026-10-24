import { expect, test } from "vitest";
import { decodeBrainQuery, decodeBrainAction } from "./library-output.js";

test("remote catalog and runtime data lose unknown credentials and native paths before crossing RPC", () => {
  const catalog = decodeBrainQuery(
    { resource: "catalog" },
    {
      models: [
        {
          id: "model",
          name: "Model",
          favorite: false,
          installed: false,
          hfRepo: "owner/repo",
          quant: "Q4",
          hfToken: "private-token",
          arbitrary: { token: "private-token" },
        },
      ],
    },
  );
  expect(JSON.stringify(catalog)).not.toContain("private-token");
  expect(
    decodeBrainQuery(
      { resource: "runtimes" },
      {
        runtimes: [
          {
            id: "opaque",
            label: "Runtime",
            displayName: "Runtime",
            version: "v1",
            source: "managed",
            dir: "/private/dir",
          },
        ],
        candidates: [],
      },
    ),
  ).toEqual({
    runtimes: [
      { id: "opaque", label: "Runtime", displayName: "Runtime", version: "v1", source: "managed" },
    ],
    candidates: [],
  });
});
test("malformed post-write results are uncertain outcomes rather than safe validation rejections", () => {
  expect(() =>
    decodeBrainAction(
      { action: "save-profile", modelId: "model", expectedRevision: "origin", patch: {} },
      { wrong: true },
    ),
  ).toThrow(expect.objectContaining({ kind: "unknown" }));
});
test("acknowledged filesystem actions return no native host result", () => {
  expect(
    decodeBrainAction(
      { action: "rename", modelId: "model", displayName: "New name" },
      { privatePath: "/secret" },
    ),
  ).toEqual({ accepted: true });
});
