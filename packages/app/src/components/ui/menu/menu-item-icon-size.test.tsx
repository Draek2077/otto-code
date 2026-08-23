import React from "react";
import { View } from "react-native";
import { describe, expect, it } from "vitest";
import { withMenuIconSize } from "./menu-item";

function Icon(_: { size?: number }) {
  return null;
}

function sizeOf(element: React.ReactElement | null): unknown {
  return (element?.props as { size?: unknown } | undefined)?.size;
}

describe("withMenuIconSize", () => {
  it("draws a glyph authored for the desktop row at the row's size", () => {
    expect(sizeOf(withMenuIconSize(<Icon size={14} />, 32))).toBe(32);
  });

  // The regression this function exists to prevent: a call site that already sized its glyph
  // through `useIconSize()` hands over a compact-scaled number. Scaling it again lands at 4x,
  // and a menu ends up drawing three sizes in three consecutive rows.
  it("leaves a glyph that is already the row's size alone, however it got there", () => {
    expect(sizeOf(withMenuIconSize(<Icon size={32} />, 32))).toBe(32);
  });

  it("is idempotent", () => {
    const once = withMenuIconSize(<Icon size={14} />, 32);
    const twice = withMenuIconSize(once, 32);
    expect(sizeOf(twice)).toBe(sizeOf(once));
  });

  it("does not touch a slot that is not a sized glyph", () => {
    const wrapper = (
      <View>
        <Icon size={14} />
      </View>
    );
    expect(withMenuIconSize(wrapper, 32)).toBe(wrapper);
  });

  it("passes nullish content straight through", () => {
    expect(withMenuIconSize(null, 32)).toBeNull();
    expect(withMenuIconSize(undefined, 32)).toBeNull();
  });
});
