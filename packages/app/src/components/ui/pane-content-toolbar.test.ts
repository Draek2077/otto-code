import { describe, expect, it } from "vitest";
import { paneToolbarActionGap } from "./pane-toolbar-geometry";

describe("pane toolbar action spacing", () => {
  it("keeps desktop control groups dense and gives compact controls a full spacing step", () => {
    expect(paneToolbarActionGap(4)).toEqual({ xs: 4, sm: 4, md: 1, lg: 1, xl: 1 });
  });
});
