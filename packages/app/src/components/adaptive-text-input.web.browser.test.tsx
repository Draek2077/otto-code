import React, { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AdaptiveTextInput } from "./adaptive-text-input";

interface MountedInput {
  root: Root;
  container: HTMLDivElement;
  textarea: HTMLTextAreaElement;
}

const mountedInputs: MountedInput[] = [];

function SchedulePromptHarness({ changes }: { changes: string[] }) {
  const [prompt, setPrompt] = useState("");
  const handleChangeText = useCallback(
    (text: string) => {
      changes.push(text);
      setPrompt(text);
    },
    [changes],
  );
  return (
    <AdaptiveTextInput
      initialValue={prompt}
      multiline
      onChangeText={handleChangeText}
      testID="schedule-prompt-input"
    />
  );
}

function mountSchedulePrompt(changes: string[]): MountedInput {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => root.render(<SchedulePromptHarness changes={changes} />));

  const textarea = container.querySelector("textarea");
  if (!textarea) {
    throw new Error("Schedule prompt did not render a textarea");
  }

  const mounted = { root, container, textarea };
  mountedInputs.push(mounted);
  return mounted;
}

function typeFromIme(textarea: HTMLTextAreaElement, text: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!valueSetter) {
    throw new Error("HTML textarea value setter is unavailable");
  }
  valueSetter.call(textarea, text);
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
}

afterEach(() => {
  for (const mounted of mountedInputs.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

describe("AdaptiveTextInput web IME composition", () => {
  it("keeps the candidate editing-surface owned until composition commits", () => {
    const changes: string[] = [];
    const { textarea } = mountSchedulePrompt(changes);

    act(() => {
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      typeFromIme(textarea, "n");
    });

    expect(textarea.value).toBe("n");
    expect(changes).toEqual([]);

    act(() => {
      textarea.value = "你";
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });

    expect(textarea.value).toBe("你");
    expect(changes).toEqual(["你"]);
  });
  it("replaces text only for a deliberate reset and keeps the editing surface focused", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<AdaptiveTextInput initialValue="draft" multiline resetKey={0} />));
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("Expected multiline editing surface");
    mountedInputs.push({ root, container, textarea });
    textarea.focus();
    textarea.setSelectionRange(2, 2);

    act(() => root.render(<AdaptiveTextInput initialValue="replacement" multiline resetKey={0} />));
    expect(textarea.value).toBe("draft");
    expect(textarea.selectionStart).toBe(2);
    expect(document.activeElement).toBe(textarea);

    act(() => root.render(<AdaptiveTextInput initialValue="replacement" multiline resetKey={1} />));
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("replacement");
    expect(document.activeElement).toBe(textarea);
  });
});
