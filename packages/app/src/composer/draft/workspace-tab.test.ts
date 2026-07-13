import { describe, expect, test } from "vitest";

import {
  resolveAutoSubmitConfig,
  resolveDraftPersonality,
  shouldAllowEmptyDraftText,
  validateDraftSubmission,
} from "./workspace-tab-core";

const baseComposerState = {
  providerDefinitions: [{ id: "codewhale" }],
  selectedProvider: "codewhale",
  isModelLoading: false,
  effectiveModelId: "",
  availableModels: [],
};

function validate(overrides = {}) {
  return validateDraftSubmission({
    text: "hello",
    allowsEmptyAutoSubmit: false,
    composerState: baseComposerState,
    autoSubmitConfig: null,
    workspaceDirectory: "/tmp/project",
    hasClient: true,
    ...overrides,
  });
}

describe("workspace draft agent model validation", () => {
  test("allows a ready provider with no models to submit without a selected model", () => {
    expect(validate({})).toBeNull();
  });

  test("keeps waiting while model defaults are loading", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          isModelLoading: true,
        },
      }),
    ).toBe("Model defaults are still loading");
  });

  test("still requires a selected model when the provider exposes models", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          availableModels: [{ id: "deepseek/deepseek-v4-pro" }],
        },
      }),
    ).toBe("No model is available for the selected provider");
  });
});

describe("workspace draft empty text readiness", () => {
  test("allows attachment-only retries after a fork draft create fails", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [{ kind: "chat_history" }],
      }),
    ).toBe(true);
  });

  test("still rejects empty drafts with no auto-submit and no attachments", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [],
      }),
    ).toBe(false);
  });
});

describe("draft personality resolution", () => {
  test("carries the picker's selected personality when there is no auto-submit", () => {
    const draftPersonality = resolveDraftPersonality({
      autoSubmitConfig: null,
      agentControls: {
        selectedPersonalityId: "sage",
        personalities: [
          {
            id: "sage",
            name: "Sage",
            provider: "codewhale",
            subtitle: "codewhale",
            available: true,
          },
        ],
      },
    });
    expect(draftPersonality?.id).toBe("sage");
  });

  test("carries the personality from a pending new-chat auto-submit", () => {
    // Regression: starting a brand-new chat with a personality selected used to
    // drop the personality entirely, because the auto-submit path (new
    // workspace -> pending submission -> this tab) unconditionally nulled it
    // out instead of reading the id carried on the pending submission.
    const autoSubmitConfig = resolveAutoSubmitConfig({
      provider: "codewhale",
      model: "deepseek-v4-pro",
      personality: "sage",
    });
    const draftPersonality = resolveDraftPersonality({
      autoSubmitConfig,
      agentControls: {
        // The tab's own composer never selected anything — the personality
        // came from the originating new-workspace composer instead.
        selectedPersonalityId: null,
        personalities: [
          {
            id: "sage",
            name: "Sage",
            provider: "codewhale",
            subtitle: "codewhale",
            available: true,
          },
        ],
      },
    });
    expect(draftPersonality?.id).toBe("sage");
  });

  test("returns no personality when the auto-submit carried none", () => {
    const autoSubmitConfig = resolveAutoSubmitConfig({
      provider: "codewhale",
      model: "deepseek-v4-pro",
    });
    const draftPersonality = resolveDraftPersonality({
      autoSubmitConfig,
      // Even if this tab's own (unrelated) composer state has a stale
      // selection, an auto-submit with no personality must not pick it up.
      agentControls: {
        selectedPersonalityId: "sage",
        personalities: [
          {
            id: "sage",
            name: "Sage",
            provider: "codewhale",
            subtitle: "codewhale",
            available: true,
          },
        ],
      },
    });
    expect(draftPersonality).toBeNull();
  });
});
