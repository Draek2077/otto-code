// @vitest-environment jsdom
import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { View } from "react-native";
import { Button } from "@/components/ui/button";
import { SettingsButton, SettingsEditingTextInput } from "./controls";
import { SettingsSearchProvider, SettingsTargetScope } from "./target";
import { SettingsSelectField } from "./fields";
import { SettingsMenuItem } from "./menu-item";
import type { EditingTextInputHandle } from "@/components/ui/text-input";

// This fixture exercises the actual closed selector trigger and its label, not a
// portal or native bottom-sheet runtime. Keep those unrelated imports out of JSDOM.
vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({ open }: { open: boolean }) => {
    if (open) throw new Error("This fixture does not exercise the combobox portal");
    return null;
  },
  ComboboxItem: () => {
    throw new Error("No option is mounted in a closed combobox");
  },
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveTextInput: () => {
    throw new Error("The fixture uses the actual EditingTextInput directly");
  },
}));
vi.mock("@/components/settings/headings/settings-info-tip", () => ({
  SettingsInfoTip: () => {
    throw new Error("No heading tooltip is mounted in this fixture");
  },
}));

const { selectMenuItem } = vi.hoisted(() => ({
  selectMenuItem: vi.fn((action: (() => void) | undefined, _close: boolean) => action?.()),
}));
vi.mock("@/components/ui/dropdown-menu", async () => ({
  DropdownMenuItem: (await import("@/components/ui/menu/menu-item")).MenuItem,
}));
vi.mock("@/components/ui/menu/menu-context", () => ({
  useMenuContext: () => ({ selectItem: selectMenuItem }),
  MenuDepthProvider: () => {
    throw new Error("No submenu is mounted in this fixture");
  },
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: () => {
    throw new Error("No tooltip is mounted in this fixture");
  },
  TooltipTrigger: () => null,
  TooltipContent: () => null,
}));

const selectedModel = { label: "Choisi" };
let root: Root | undefined;
let container: HTMLDivElement | undefined;
const scrollIntoView = vi.fn();
let oldScrollDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.stubGlobal("React", React); // Existing shared components use the classic JSX test transform.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  oldScrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      top: 0,
      left: 0,
      right: 100,
      bottom: 30,
      toJSON: () => ({}),
    },
  ] as unknown as DOMRectList);
  scrollIntoView.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (oldScrollDescriptor)
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", oldScrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("Settings action composition", () => {
  it("registers the actual button, preserving its caller ref, keyboard tab order and action", async () => {
    const reference = createRef<View>();
    const action = vi.fn();
    await act(async () =>
      root!.render(
        <SettingsSearchProvider settingId="action">
          <Button testID="ordinary">Ordinary</Button>
          <SettingsButton settingIds={["action"]} ref={reference} testID="target" onPress={action}>
            Actual action
          </SettingsButton>
        </SettingsSearchProvider>,
      ),
    );
    const ordinary = container!.querySelector<HTMLElement>('[data-testid="ordinary"]')!;
    const target = container!.querySelector<HTMLElement>('[data-testid="target"]')!;
    expect(target.parentElement).toBe(ordinary.parentElement);
    expect(target.tagName).toBe(ordinary.tagName);
    expect(target.tabIndex).toBe(ordinary.tabIndex);
    expect(target.tabIndex).toBe(0);
    expect(reference.current).toBe(target);
    expect(document.activeElement).toBe(target);
    expect(action).not.toHaveBeenCalled();
    expect(target.tagName).toBe("BUTTON");
    act(() => {
      const keydown = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(keydown);
      expect(keydown.defaultPrevented).toBe(false);
      // PressResponder intentionally leaves native button activation to the browser.
      // JSDOM does not perform that default action: supply its keyboard click (detail 0).
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
      target.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    });
    expect(action).toHaveBeenCalledOnce();
  });

  it("preserves disabled state and explicit tab-order decisions", async () => {
    await act(async () =>
      root!.render(
        <SettingsSearchProvider settingId={null}>
          <SettingsButton settingIds={["disabled"]} testID="disabled" disabled>
            Disabled
          </SettingsButton>
          <SettingsButton settingIds={["manual"]} testID="manual" tabIndex={-1}>
            Manual focus
          </SettingsButton>
        </SettingsSearchProvider>,
      ),
    );
    const disabled = container!.querySelector<HTMLElement>('[data-testid="disabled"]')!;
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.tabIndex).toBe(-1);
    expect(container!.querySelector<HTMLElement>('[data-testid="manual"]')!.tabIndex).toBe(-1);
  });
  it("focuses the input's existing native ref without changing its value or replacing its handle", async () => {
    const input = createRef<EditingTextInputHandle>();
    const changed = vi.fn();
    await act(async () =>
      root!.render(
        <SettingsSearchProvider settingId="input">
          <SettingsEditingTextInput
            settingIds={["input"]}
            ref={input}
            initialValue="existing text"
            onChangeText={changed}
            testID="input"
          />
        </SettingsSearchProvider>,
      ),
    );
    const element = container!.querySelector<HTMLInputElement>('[data-testid="input"]')!;
    expect(input.current?.getNativeRef()).toBe(element);
    expect(document.activeElement).toBe(element);
    expect(input.current?.getText()).toBe("existing text");
    expect(changed).not.toHaveBeenCalled();
    act(() => input.current?.reset());
    expect(input.current?.getText()).toBe("");
    expect(document.activeElement).toBe(element);
  });

  it("binds a field=false selector's existing selected-value label while retaining its trigger", async () => {
    const changed = vi.fn();
    await act(async () =>
      root!.render(
        <SettingsSearchProvider settingId="model">
          <SettingsTargetScope settingIds={["model"]}>
            <SettingsSelectField
              field={false}
              label="Model"
              value="one"
              selectedDisplay={selectedModel}
              options={[{ id: "one", value: "one", label: "Choisi" }]}
              onChange={changed}
              placeholder="Choose"
              emptyText="None"
              triggerTestID="model-trigger"
            />
          </SettingsTargetScope>
        </SettingsSearchProvider>,
      ),
    );
    expect(document.activeElement?.textContent).toBe("Choisi");
    expect(container!.querySelector<HTMLElement>('[data-testid="model-trigger"]')!.tabIndex).toBe(
      0,
    );
    expect(changed).not.toHaveBeenCalled();
  });
  it("focuses the chosen menu's existing action without selecting it or bypassing menu ownership", async () => {
    const reference = createRef<View>();
    const remove = vi.fn();
    selectMenuItem.mockClear();
    await act(async () =>
      root!.render(
        <SettingsSearchProvider settingId="delete-script">
          <SettingsMenuItem
            settingIds={["delete-script"]}
            itemRef={reference}
            testID="remove-script"
            destructive
            onSelect={remove}
          >
            Remove chosen script
          </SettingsMenuItem>
        </SettingsSearchProvider>,
      ),
    );
    const element = container!.querySelector<HTMLElement>('[data-testid="remove-script"]')!;
    expect(reference.current).toBe(element);
    expect(document.activeElement).toBe(element);
    expect(element.getAttribute("role")).toBe("menuitem");
    expect(element.tabIndex).toBe(-1);
    expect(selectMenuItem).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    act(() => element.click());
    expect(selectMenuItem).toHaveBeenCalledWith(expect.any(Function), true);
    expect(remove).toHaveBeenCalledOnce();
  });
});
