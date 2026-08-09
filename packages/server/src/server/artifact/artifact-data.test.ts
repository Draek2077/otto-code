import { describe, expect, test } from "vitest";
import { readArtifactData, replaceArtifactData } from "./artifact-data.js";

const html = `<!doctype html><style>body { color: rebeccapurple }</style><main>Stable UI</main><script type="application/json" id="otto-artifact-data">{"visits":3}</script><script>render()</script>`;

describe("artifact data blocks", () => {
  test("reads and replaces only the dedicated JSON block", () => {
    const updated = replaceArtifactData(html, { visits: 4, labels: ["today"] });

    expect(readArtifactData(updated)).toEqual({ visits: 4, labels: ["today"] });
    expect(updated.replace('{"visits":4,"labels":["today"]}', '{"visits":3}')).toBe(html);
  });

  test("rejects artifacts without the data-only update contract", () => {
    expect(() => replaceArtifactData("<main>No data block</main>", {})).toThrow(
      "does not support data-only updates",
    );
  });

  test("rejects malformed artifact data", () => {
    expect(() => readArtifactData('<script id="otto-artifact-data">{nope}</script>')).toThrow(
      "must contain valid JSON",
    );
  });
});
