/**
 * @vitest-environment jsdom
 */
import React, { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { Pressable, Text, type View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MenuRoot, MenuTrigger } from "./menu-root";

beforeEach(() => vi.stubGlobal("React", React));

describe("MenuTrigger", () => {
  it("opens a row's menu without selecting the enclosing row", () => {
    const selectRow = vi.fn();
    const openMenu = vi.fn();
    const screen = render(
      <Pressable onPress={selectRow}>
        <MenuRoot onOpenChange={openMenu}>
          <MenuTrigger accessibilityLabel="Open row actions">
            <Text>Actions</Text>
          </MenuTrigger>
        </MenuRoot>
      </Pressable>,
    );
    fireEvent.click(screen.getByLabelText("Open row actions"));
    expect(openMenu).toHaveBeenCalledWith(true);
    expect(selectRow).not.toHaveBeenCalled();
  });

  it("forwards its rendered trigger to callers", () => {
    const triggerRef = createRef<View>();

    render(
      <MenuRoot>
        <MenuTrigger ref={triggerRef} accessibilityLabel="Open menu">
          <Text>Open</Text>
        </MenuTrigger>
      </MenuRoot>,
    );

    expect(triggerRef.current).not.toBeNull();
  });
});
