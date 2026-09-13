// @vitest-environment jsdom
import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TextInput } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerTextInputProps } from "./composer-text-input.types";
import type { NativePastedFile } from "@/composer/native-pasted-image";
import { ComposerTextInput } from "./composer-text-input.native";

const native = vi.hoisted(() => ({
  props: {} as ComposerTextInputProps & {
    onPaste?: (error: string | null, files: NativePastedFile[]) => void;
  },
}));
vi.mock("@mattermost/react-native-paste-input", async () => {
  const R = await import("react");
  return {
    default: R.forwardRef<HTMLInputElement, typeof native.props>((props, ref) => {
      native.props = props;
      return R.createElement("input", {
        ref,
        value: props.value,
        disabled: props.editable === false,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          props.onChangeText?.(event.target.value),
        "data-paste-input": true,
      });
    }),
  };
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const files: NativePastedFile[] = [
  { fileName: "capture.png", fileSize: 42, type: "image/png", uri: "file:///capture.png" },
];

describe("Otto controlled composer native paste boundary", () => {
  it("keeps ordinary edits on one input and replaces only the explicit rewrite key", () => {
    const onChangeText = vi.fn();
    const onPasteImages = vi.fn();
    const ref = createRef<TextInput>();
    act(() =>
      root.render(
        <ComposerTextInput
          key="draft:0"
          ref={ref}
          value="draft"
          onChangeText={onChangeText}
          onPasteImages={onPasteImages}
        />,
      ),
    );
    const input = container.querySelector("input");
    act(() => native.props.onChangeText?.("draft typed"));
    expect(onChangeText).toHaveBeenCalledWith("draft typed");
    act(() =>
      root.render(
        <ComposerTextInput
          key="draft:0"
          ref={ref}
          value="draft typed"
          onChangeText={onChangeText}
          onPasteImages={onPasteImages}
        />,
      ),
    );
    expect(container.querySelector("input")).toBe(input);
    expect(input?.value).toBe("draft typed");
    act(() =>
      root.render(
        <ComposerTextInput
          key="draft:1"
          ref={ref}
          value="rewrite"
          onChangeText={onChangeText}
          onPasteImages={onPasteImages}
        />,
      ),
    );
    expect(container.querySelector("input")).not.toBe(input);
    expect(container.querySelector("input")?.value).toBe("rewrite");
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(container.querySelector("input"));
  });

  it("forwards files to the existing persistence owner and surfaces errors without attachments", () => {
    const onPasteImages = vi.fn();
    const onPasteError = vi.fn();
    act(() =>
      root.render(<ComposerTextInput onPasteImages={onPasteImages} onPasteError={onPasteError} />),
    );
    act(() => native.props.onPaste?.(null, files));
    expect(onPasteImages).toHaveBeenCalledExactlyOnceWith(files);
    act(() => native.props.onPaste?.(null, []));
    act(() => native.props.onPaste?.("clipboard denied", files));
    expect(onPasteImages).toHaveBeenCalledTimes(1);
    expect(onPasteError).toHaveBeenCalledOnce();
  });

  it.each([{ editable: false }, { pasteImagesEnabled: false }])(
    "rejects a late paste when editing or the attachment gate closes: %o",
    (gate) => {
      const onPasteImages = vi.fn();
      const onPasteError = vi.fn();
      act(() =>
        root.render(
          <ComposerTextInput onPasteImages={onPasteImages} onPasteError={onPasteError} />,
        ),
      );
      const original = container.querySelector("input");
      act(() =>
        root.render(
          <ComposerTextInput {...gate} onPasteImages={onPasteImages} onPasteError={onPasteError} />,
        ),
      );
      expect(container.querySelector("input")).toBe(original);
      act(() => native.props.onPaste?.(null, files));
      act(() => native.props.onPaste?.("clipboard denied", files));
      expect(onPasteImages).not.toHaveBeenCalled();
      expect(onPasteError).not.toHaveBeenCalled();
    },
  );
});
