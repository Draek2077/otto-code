import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ToastApi, ToastVariant } from "@otto-code/plugin/client/react-native";
import { useToast } from "./toast";

const app = vi.hoisted(() => ({ show: vi.fn(), error: vi.fn() }));
vi.mock("@/contexts/toast-api-context", () => ({ useToast: () => app }));

function borrowToast(): ToastApi {
  let api: ToastApi | null = null;
  function Surface() {
    api = useToast();
    return null;
  }
  renderToStaticMarkup(React.createElement(Surface));
  if (!api) throw new Error("Expected plugin toast API");
  return api;
}

describe("plugin toast host bridge", () => {
  it.each<ToastVariant>(["default", "info", "success", "warning", "error"])(
    "preserves %s and explicit duration",
    (variant) => {
      app.show.mockClear();
      const api = borrowToast();
      api.show("Plugin notice", { variant, durationMs: 5000 });
      expect(app.show).toHaveBeenCalledExactlyOnceWith("Plugin notice", {
        variant,
        durationMs: 5000,
      });
    },
  );

  it("preserves host defaults and the error shortcut", () => {
    app.show.mockClear();
    app.error.mockClear();
    const api = borrowToast();
    api.show("Default notice");
    api.error("Failed");
    expect(app.show).toHaveBeenCalledExactlyOnceWith("Default notice", undefined);
    expect(app.error).toHaveBeenCalledExactlyOnceWith("Failed");
  });
});
