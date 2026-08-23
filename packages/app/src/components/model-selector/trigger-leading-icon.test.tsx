/**
 * @vitest-environment jsdom
 *
 * The selector trigger must wear the same glyph as the popup row it reflects:
 * an Otto Brain model with a catalog family shows that family's mark, not the
 * generic Brain glyph. This pins the trigger's resolution rules so the chip and
 * the row cannot drift apart again.
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerLeadingIcon } from "./selector-content";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
});

const { theme } = vi.hoisted(() => {
  // Any color path resolves to a token-like value: the stylesheet factory only
  // needs to run, the colors never get painted in this test.
  const anyColor: unknown = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === Symbol.toPrimitive || key === "toString" || key === "valueOf"
          ? () => "#000"
          : anyColor,
    },
  );
  const spacing: Record<string, number> = {};
  for (const step of [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 16]) {
    spacing[String(step)] = step * 4;
  }
  return {
    theme: {
      colorScheme: "dark",
      spacing,
      iconSize: { xs: 12, sm: 14, md: 16, mdPlus: 18, lg: 20, xl: 24 },
      borderWidth: { 1: 1 },
      borderRadius: { sm: 4, md: 6, lg: 8, xl: 12, "2xl": 16, full: 999 },
      fontSize: { xs: 11, sm: 13, base: 15, lg: 17, code: 13 },
      fontWeight: { normal: "400", medium: "500", semibold: "600", bold: "700" },
      colors: anyColor,
    },
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (t: typeof theme) => unknown)(theme) : factory,
  },
  withUnistyles: <T,>(component: T): T => component,
  useUnistyles: () => ({ theme }),
}));

vi.mock("@/components/icons/material-icons", () => {
  const createIcon = (name: string) => (props: { size?: number | string }) =>
    React.createElement("span", { "data-icon": name, "data-size": props.size });
  return {
    AlertTriangle: createIcon("alert-triangle"),
    Boxes: createIcon("boxes"),
    Check: createIcon("check"),
    ChevronRight: createIcon("chevron-right"),
    Search: createIcon("search"),
    Settings: createIcon("settings"),
    Star: createIcon("star"),
    StarFilled: createIcon("star-filled"),
  };
});

vi.mock("@/components/brain/brain-model-family-icon", () => ({
  hasBrainModelFamilyIcon: (family: string | null | undefined) => family === "qwen",
  BrainModelFamilyIcon: (props: { family: string; size?: number | string }) =>
    React.createElement("span", { "data-family-icon": props.family, "data-size": props.size }),
}));

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: (provider: string) => (props: { size?: number | string }) =>
    React.createElement("span", { "data-provider-icon": provider, "data-size": props.size }),
}));

vi.mock("@/components/personality-provider-icon", () => ({
  PersonalityProviderIcon: (props: { provider: string }) =>
    React.createElement("span", { "data-personality-icon": props.provider }),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span", { "data-spinner": true }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: (props: { children?: React.ReactNode }) =>
    React.createElement("button", { type: "button" }, props.children),
}));

vi.mock("@/components/ui/combobox", () => ({
  ComboboxItem: (props: { children?: React.ReactNode }) =>
    React.createElement("div", null, props.children),
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });
  vi.stubGlobal("React", React);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function render(element: React.ReactElement) {
  act(() => {
    root?.render(element);
  });
  return container!;
}

const ATLAS = {
  id: "p1",
  name: "Atlas",
  provider: "otto-brain",
  subtitle: "",
  available: true,
  glowA: "#f00",
  glowB: "#0f0",
};

describe("TriggerLeadingIcon", () => {
  it("wears the catalog family mark for an Otto Brain model", () => {
    const host = render(
      <TriggerLeadingIcon personality={null} provider="otto-brain" family="qwen" size="md" />,
    );
    expect(host.querySelector("[data-family-icon='qwen']")).not.toBeNull();
    expect(host.querySelector("[data-provider-icon]")).toBeNull();
  });

  it("falls back to the Brain glyph when the catalog has no mark for the family", () => {
    const host = render(
      <TriggerLeadingIcon personality={null} provider="otto-brain" family="unknown" size="md" />,
    );
    expect(host.querySelector("[data-provider-icon='otto-brain']")).not.toBeNull();
    expect(host.querySelector("[data-family-icon]")).toBeNull();
  });

  it("keeps the provider glyph for non-Brain providers even with a family", () => {
    const host = render(
      <TriggerLeadingIcon personality={null} provider="openrouter" family="qwen" size="md" />,
    );
    expect(host.querySelector("[data-provider-icon='openrouter']")).not.toBeNull();
    expect(host.querySelector("[data-family-icon]")).toBeNull();
  });

  it("lets a selected personality own the glyph over the family mark", () => {
    const host = render(
      <TriggerLeadingIcon personality={ATLAS} provider="otto-brain" family="qwen" size="md" />,
    );
    expect(host.querySelector("[data-personality-icon='otto-brain']")).not.toBeNull();
    expect(host.querySelector("[data-family-icon]")).toBeNull();
  });
});
