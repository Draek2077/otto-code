import { describe, expect, it } from "vitest";
import { DETECTABLE_EXTENSIONS } from "./detect";
import { getParserForFile, getSupportedExtensions } from "./parsers";

describe("parser registrations", () => {
  // The Paseo v0.2.5 merge reshaped `languagesByExtension` and lost the shell
  // and SQL rows, while `detect.ts` kept scoring both. That combination is the
  // worst of the two: we confidently classified a snippet as shell and then had
  // no grammar to colour it with. See projects/paseo-v025-merge/audit-findings.md.
  it("colours shell and SQL", () => {
    expect(getParserForFile("deploy.sh")).not.toBeNull();
    expect(getParserForFile("deploy.bash")).not.toBeNull();
    expect(getParserForFile("profile.zsh")).not.toBeNull();
    expect(getParserForFile("schema.sql")).not.toBeNull();
  });

  // The real invariant, and the one that would have caught the regression on
  // its own: anything the detector is willing to claim must be renderable. A
  // verdict we cannot highlight is a promise the editor does not keep.
  it("can highlight every language the detector is able to return", () => {
    expect(DETECTABLE_EXTENSIONS.length).toBeGreaterThan(0);
    const unrenderable = DETECTABLE_EXTENSIONS.filter(
      (ext) => getParserForFile(`sample.${ext}`) === null,
    );
    expect(unrenderable).toEqual([]);
  });

  it("reports the new extensions as supported", () => {
    const supported = getSupportedExtensions();
    expect(supported).toEqual(expect.arrayContaining(["sh", "bash", "zsh", "sql"]));
  });
});
