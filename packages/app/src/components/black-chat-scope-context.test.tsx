/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  BlackChatScopeProvider,
  resolveBlackChatCanvasStyle,
  useBlackChatScope,
} from "./black-chat-scope-context";

function Scope({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <BlackChatScopeProvider enabled={enabled}>{children}</BlackChatScopeProvider>;
}

describe("black chat scope context", () => {
  it("keeps the explicit canvas enabled for independently rendered descendants", () => {
    const { result } = renderHook(() => useBlackChatScope(), {
      wrapper: ({ children }) => <Scope enabled>{children}</Scope>,
    });

    expect(result.current).toBe(true);
    expect(resolveBlackChatCanvasStyle(result.current)).toMatchObject({
      backgroundColor: "#000000",
    });
  });

  it("defaults ordinary surfaces to the app theme", () => {
    const { result } = renderHook(() => useBlackChatScope());

    expect(result.current).toBe(false);
    expect(resolveBlackChatCanvasStyle(result.current)).toBeUndefined();
  });
});
