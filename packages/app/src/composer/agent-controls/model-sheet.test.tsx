/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RolePersonality } from "@/provider-selection/role-model-personality";
import { CompactModelSheet } from "./model-sheet";

vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => true,
}));
vi.mock("@/components/provider-icons", () => ({ getProviderIcon: () => null }));

// Isolate the native presenter and model browser: this regression is the
// sheet's routing of row presses to the draft or confirmed live-switch owner.
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div>{children}</div> : null,
}));
vi.mock("@/components/model-browser", () => ({
  useModelBrowser: () => ({
    selectedModelLabel: "Auto",
    triggerLabel: "Team's Chatter",
    prepareToOpen: () => {},
    reset: () => {},
  }),
  ModelBrowser: function ModelBrowser({
    onSelect,
  }: {
    onSelect: (provider: string, model: string) => void;
  }) {
    const chooseCodex = React.useCallback(() => onSelect("codex", "chosen-model"), [onSelect]);
    const chooseClaude = React.useCallback(() => onSelect("claude", "chosen-model"), [onSelect]);
    return (
      <>
        <button type="button" onClick={chooseCodex}>
          Choose Codex model
        </button>
        <button type="button" onClick={chooseClaude}>
          Choose Claude model
        </button>
      </>
    );
  },
}));

afterEach(cleanup);

function personality(overrides: Partial<RolePersonality> = {}): RolePersonality {
  return {
    personalities: [],
    selectedProfileId: "__team-chatter__",
    onSelectProfile: undefined,
    onClearProfile: vi.fn(),
    hasBoundProfile: true,
    isSwitching: false,
    selectedName: "Team's Chatter",
    ...overrides,
  };
}

function chooseModel(profile: RolePersonality | null, provider = "Codex") {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <CompactModelSheet
      providers={[]}
      selectedProvider="codex"
      selectedModel="auto"
      isLoading={false}
      personality={profile}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "modelSelector.selectedModel" }));
  fireEvent.click(view.getByRole("button", { name: `Choose ${provider} model` }));
  return { onSelect, onClose, view };
}

describe("compact model selection", () => {
  it.each(["Codex", "Claude"])(
    "detaches the draft team profile when choosing a %s model",
    (provider) => {
      const profile = personality();
      const { onSelect, onClose, view } = chooseModel(profile, provider);

      expect(onSelect).toHaveBeenCalledExactlyOnceWith(provider.toLowerCase(), "chosen-model");
      expect(profile.onClearProfile).toHaveBeenCalledExactlyOnceWith();
      expect(onClose).toHaveBeenCalledExactlyOnceWith();
      expect(view.queryByRole("button", { name: `Choose ${provider} model` })).toBeNull();
    },
  );

  it("routes a running profile override through its confirmed switch flow", () => {
    const onSelectModelOverProfile = vi.fn();
    const profile = personality({ onSelectModelOverProfile });
    const { onSelect, onClose } = chooseModel(profile);

    expect(onSelectModelOverProfile).toHaveBeenCalledExactlyOnceWith("codex", "chosen-model");
    expect(onSelect).not.toHaveBeenCalled();
    expect(profile.onClearProfile).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledExactlyOnceWith();
  });

  it("selects normally when no profile is bound", () => {
    const profile = personality({ selectedProfileId: null, hasBoundProfile: false });
    const { onSelect } = chooseModel(profile);

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("codex", "chosen-model");
    expect(profile.onClearProfile).not.toHaveBeenCalled();
  });

  it("allows a model change with a read-only profile identity", () => {
    const { onSelect } = chooseModel(personality({ onClearProfile: undefined }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("codex", "chosen-model");
  });
});
