import { describe, expect, it } from "vitest";

import { getCenteredOptionScrollOffset } from "./combobox-scroll";

describe("getCenteredOptionScrollOffset", () => {
  it("centers a selected option in the available viewport", () => {
    expect(
      getCenteredOptionScrollOffset({ optionTop: 560, optionHeight: 64, viewportHeight: 360 }),
    ).toBe(412);
  });

  it("does not scroll past the beginning for an option already near the top", () => {
    expect(
      getCenteredOptionScrollOffset({ optionTop: 32, optionHeight: 64, viewportHeight: 360 }),
    ).toBe(0);
  });
});
