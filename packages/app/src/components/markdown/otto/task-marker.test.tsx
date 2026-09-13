/** @vitest-environment jsdom */
import React, { createElement, type ReactNode } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
import { applyOttoAssistantMarkdownExtensions } from "./parser-extensions";
import { MarkdownListMarker } from "./task-marker";
import { MarkdownTaskProvider } from "../task-context";

vi.mock("react-native", () => ({
  Text: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress(): void }) =>
    createElement("button", { type: "button", onClick: onPress }, children),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const emptyStyle = {};

function attributes(source: string) {
  const token = applyOttoAssistantMarkdownExtensions(createAssistantMarkdownParser())
    .parse(source, {})
    .find((entry) => entry.type === "list_item_open");
  return Object.fromEntries(token?.attrs ?? []);
}

describe("MarkdownListMarker", () => {
  it("renders parsed checked and unchecked assistant tasks without enabling document mutation", () => {
    const onToggle = vi.fn();
    const view = render(
      <MarkdownTaskProvider onToggle={onToggle}>
        <MarkdownListMarker
          attributes={attributes("- [x] done")}
          ordered={false}
          marker="•"
          style={emptyStyle}
          readOnly
        />
        <MarkdownListMarker
          attributes={attributes("- [ ] next")}
          ordered={false}
          marker="•"
          style={emptyStyle}
          readOnly
        />
      </MarkdownTaskProvider>,
    );
    expect(view.container.textContent).toBe("☑☐");
    expect(view.queryByRole("button")).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
    view.unmount();
  });

  it("retains ordered numbering and uses the parsed source line for editable documents", () => {
    const onToggle = vi.fn();
    const view = render(
      <MarkdownTaskProvider onToggle={onToggle}>
        <MarkdownListMarker
          attributes={attributes("Intro\n\n3. [ ] next")}
          ordered
          marker="3."
          style={emptyStyle}
        />
      </MarkdownTaskProvider>,
    );
    expect(view.container.textContent).toBe("3.☐");
    fireEvent.click(view.getByRole("button"));
    expect(onToggle).toHaveBeenCalledWith({ line: 3, checked: true });
    view.unmount();
  });
});
