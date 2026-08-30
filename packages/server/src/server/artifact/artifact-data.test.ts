import { describe, expect, test } from "vitest";
import { readArtifactData, replaceArtifactData } from "./artifact-data.js";

const html = `<!doctype html><style>body { color: rebeccapurple }</style><main>Stable UI</main><script type="application/json" id="otto-artifact-data">{"visits":3}</script><script>render()</script>`;

describe("artifact data blocks", () => {
  test("reads and replaces only the dedicated JSON block", () => {
    const updated = replaceArtifactData(html, { visits: 4, labels: ["today"] });

    expect(readArtifactData(updated)).toEqual({ visits: 4, labels: ["today"] });
    expect(updated.replace('{"visits":4,"labels":["today"]}', '{"visits":3}')).toBe(html);
  });

  test("keeps a closing script tag inside a value from escaping the data block", () => {
    const hostile = { title: "</script><script>document.body.innerHTML='pwned'</script>" };
    const updated = replaceArtifactData(html, hostile);

    expect(updated.split("</script>")).toHaveLength(3);
    expect(updated).not.toContain("</script><script>document");
    expect(readArtifactData(updated)).toEqual(hostile);
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
