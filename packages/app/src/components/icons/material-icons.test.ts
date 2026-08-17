import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MATERIAL_SYMBOL_SVGS } from "@/assets/material-symbol-icons";

/**
 * Every icon exported from `material-icons.ts` must resolve to a real SVG in the
 * generated asset.
 *
 * A missing key is a silent failure at render time: `createMaterialSymbolIcon`
 * reads `MATERIAL_SYMBOL_SVGS[name]`, and `SvgXml` handed `xml={undefined}` draws
 * an empty box with no error. That is exactly how the `Siren` / `SirenQuestion` /
 * `Error` status icons went blank - they were hand-pasted into the generated file
 * instead of the source map, so the next regeneration dropped them and nothing
 * failed. This test fails the build the moment an export loses its SVG, whether
 * the map entry is removed or a regeneration is run against a stale map.
 */

function exportedIconKeys() {
  const source = readFileSync(
    fileURLToPath(new URL("./material-icons.ts", import.meta.url)),
    "utf8",
  );
  const keys = new Set<string>();
  for (const match of source.matchAll(
    /export const \w+ = create\w+MaterialSymbolIcon\("(\w+)"\)/g,
  )) {
    keys.add(match[1]);
  }
  return keys;
}

describe("material icon exports", () => {
  it("every exported icon resolves to a non-empty SVG", () => {
    const missing = [...exportedIconKeys()].filter((key) => {
      const svg = MATERIAL_SYMBOL_SVGS[key];
      return typeof svg !== "string" || !svg.startsWith("<svg");
    });
    expect(missing, `icons with no SVG in the generated asset: ${missing.join(", ")}`).toEqual([]);
  });

  it("the status-bucket glyphs are all present", () => {
    // Pinned by name: these three are the agent-status glyphs (needs_input /
    // failed / attention) and are the ones that were blank.
    for (const key of ["Error", "Siren", "SirenQuestion"]) {
      expect(MATERIAL_SYMBOL_SVGS[key]).toMatch(/^<svg[ >]/);
    }
  });
});
