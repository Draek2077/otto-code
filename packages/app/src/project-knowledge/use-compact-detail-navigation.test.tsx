/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCompactDetailNavigation } from "./use-compact-detail-navigation";

describe("useCompactDetailNavigation", () => {
  it("opens a compact detail only after selection and returns to the list without clearing it", () => {
    const { result } = renderHook(() => useCompactDetailNavigation(true));

    expect(result.current.showsDetail).toBe(false);

    act(() => result.current.openDetail());
    expect(result.current.showsDetail).toBe(true);

    act(() => result.current.goBack());
    expect(result.current.showsDetail).toBe(false);
  });

  it("keeps desktop selections in the split view", () => {
    const { result } = renderHook(() => useCompactDetailNavigation(false));

    act(() => result.current.openDetail());

    expect(result.current.showsDetail).toBe(false);
  });
});
