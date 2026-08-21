import { describe, expect, it } from "vitest";
import { parseSkillsSaveResult, parseSkillsSnapshot } from "./skills-snapshot";

describe("parseSkillsSnapshot", () => {
  it("parses a full snapshot from the desktop command surface", () => {
    expect(
      parseSkillsSnapshot({
        state: "drift",
        ops: [
          { kind: "add", name: "otto-loop" },
          { kind: "delete", name: "otto-chat" },
        ],
        available: ["otto", "otto-loop"],
        installed: ["otto"],
        selection: { mode: "custom", skills: ["otto", "otto-loop"] },
      }),
    ).toEqual({
      state: "drift",
      ops: [
        { kind: "add", name: "otto-loop" },
        { kind: "delete", name: "otto-chat" },
      ],
      available: ["otto", "otto-loop"],
      installed: ["otto"],
      selection: { mode: "custom", skills: ["otto", "otto-loop"] },
    });
  });

  it("parses the installed skills the host reports", () => {
    expect(
      parseSkillsSnapshot({
        state: "drift",
        ops: [{ kind: "add", name: "otto-loop" }],
        available: ["otto", "otto-loop"],
        installed: ["otto-loop", 7],
        selection: { mode: "all" },
      }).installed,
    ).toEqual(["otto-loop"]);
  });

  it("assumes the saved selection is installed when the host does not report it", () => {
    // An older host has no `installed` field. Assuming the selection is on disk
    // keeps the destructive confirmation firing rather than silently skipping it.
    expect(
      parseSkillsSnapshot({
        state: "up-to-date",
        ops: [],
        available: ["otto", "otto-advisor", "otto-loop"],
        selection: { mode: "custom", skills: ["otto", "otto-loop"] },
      }).installed,
    ).toEqual(["otto", "otto-loop"]);
  });

  it("assumes every bundled skill is installed for an all selection from an older host", () => {
    expect(
      parseSkillsSnapshot({
        state: "up-to-date",
        ops: [],
        available: ["otto", "otto-loop"],
      }).installed,
    ).toEqual(["otto", "otto-loop"]);
  });

  it("reads a snapshot with no saved selection as all skills", () => {
    expect(parseSkillsSnapshot({ state: "up-to-date", ops: [], available: ["otto"] })).toEqual({
      state: "up-to-date",
      ops: [],
      available: ["otto"],
      installed: ["otto"],
      selection: { mode: "all" },
    });
  });

  it("drops catalog and selection entries that are not skill names", () => {
    expect(
      parseSkillsSnapshot({
        state: "up-to-date",
        ops: [],
        available: ["otto", 7, null, "otto-loop"],
        selection: { mode: "custom", skills: ["otto", 7] },
      }),
    ).toEqual({
      state: "up-to-date",
      ops: [],
      available: ["otto", "otto-loop"],
      installed: ["otto"],
      selection: { mode: "custom", skills: ["otto"] },
    });
  });

  it("reads the removals the host wants confirmed", () => {
    expect(
      parseSkillsSaveResult({
        state: "up-to-date",
        ops: [],
        available: ["otto", "otto-loop"],
        installed: ["otto", "otto-loop"],
        selection: { mode: "all" },
        confirmationRequired: { removals: ["otto-loop", 7] },
      }).confirmationRequired,
    ).toEqual({ removals: ["otto-loop"] });
  });

  it("treats a save with no confirmation request as applied", () => {
    expect(
      parseSkillsSaveResult({
        state: "up-to-date",
        ops: [],
        available: ["otto"],
        installed: ["otto"],
        selection: { mode: "all" },
      }).confirmationRequired,
    ).toBeNull();
  });

  it("rejects a response that is not an object", () => {
    expect(() => parseSkillsSnapshot("nope")).toThrow("Unexpected skills status response.");
  });

  it("rejects an unknown install state", () => {
    expect(() => parseSkillsSnapshot({ state: "half-installed", ops: [] })).toThrow(
      "Unexpected skills status state: half-installed",
    );
  });

  it("rejects an unknown pending operation kind", () => {
    expect(() =>
      parseSkillsSnapshot({ state: "drift", ops: [{ kind: "relocate", name: "otto" }] }),
    ).toThrow("Unexpected skill op kind: relocate");
  });
});
