import { describe, expect, it } from "vitest";
import { resolveWindowChromeSafeArea } from "./window-chrome";

describe("resolveWindowChromeSafeArea", () => {
  const windowControls = {
    topLeft: null,
    topRight: { width: 140, height: 46 },
  };

  it("reserves Windows controls only for the pane that owns the top-right corner", () => {
    expect(
      resolveWindowChromeSafeArea({
        obstruction: windowControls,
        corners: "top-right",
        placement: "inline",
      }),
    ).toEqual({ paddingLeft: 0, paddingRight: 140 });

    expect(
      resolveWindowChromeSafeArea({
        obstruction: windowControls,
        corners: "none",
        placement: "inline",
      }),
    ).toEqual({ paddingLeft: 0, paddingRight: 0 });
  });
});
