import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIM_MAPPING_SETTINGS,
  getVimMappingAction,
  isVimMappingPrefix,
  normalizeVimMappingSettings,
} from "./vim-mappings";

describe("Vim mapping settings", () => {
  it("keeps the constrained Space leader shape and drops unsupported values", () => {
    expect(
      normalizeVimMappingSettings({
        leader: "\\",
        mappings: { save: "w", goToDefinition: "dd", unknown: "x" },
      }),
    ).toEqual(DEFAULT_VIM_MAPPING_SETTINGS);

    expect(
      normalizeVimMappingSettings({
        leader: "Space",
        mappings: { save: "w", goToDefinition: "<F12>", openChanges: "ch" },
      }),
    ).toEqual({
      leader: "Space",
      mappings: {
        save: "w",
        find: "f",
        goToDefinition: "d",
        findReferences: "r",
        renameSymbol: "n",
        openFileSearch: "p",
        openChanges: "ch",
        newTerminal: "t",
      },
    });
  });

  it("preserves the first action when mappings conflict", () => {
    expect(
      normalizeVimMappingSettings({
        leader: "Space",
        mappings: { save: "x", find: "x", openChanges: "xc" },
      }),
    ).toEqual({
      leader: "Space",
      mappings: {
        save: "x",
        find: "f",
        goToDefinition: "d",
        findReferences: "r",
        renameSymbol: "n",
        openFileSearch: "p",
        openChanges: "xc",
        newTerminal: "t",
      },
    });
  });

  it("resolves mappings and prefixes without claiming Otto modifier shortcuts", () => {
    const settings = normalizeVimMappingSettings({
      leader: "Space",
      mappings: { goToDefinition: "d", openChanges: "ch" },
    });
    expect(getVimMappingAction(settings, "d")).toBe("goToDefinition");
    expect(isVimMappingPrefix(settings, "c")).toBe(true);
    expect(isVimMappingPrefix(settings, "Mod-b")).toBe(false);
  });

  it("migrates empty persisted mappings to the shipped defaults", () => {
    expect(normalizeVimMappingSettings({ leader: "Space", mappings: {} })).toEqual(
      DEFAULT_VIM_MAPPING_SETTINGS,
    );
  });
});
