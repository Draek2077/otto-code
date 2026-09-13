/**
 * @vitest-environment jsdom
 *
 * This file mounts real React roots with `react-dom/client`, so it needs actual DOM globals.
 * It previously ran in the project's default `node` environment and hand-installed `window`,
 * `document` and `navigator` one property at a time. That worked only for as long as nobody
 * added an import - each new transitive module reached for one more global (`matchMedia`,
 * `addEventListener`, `ShadowRoot`) and failed this file with an error naming code it does not
 * use. Declaring the environment gets all of them at once, and keeps getting them.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "@/stores/draft-store";
import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";

const { asyncStorage } = vi.hoisted(() => ({
  asyncStorage: new Map<string, string>(),
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => asyncStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStorage.delete(key);
    },
  },
}));

vi.mock("@/attachments/service", () => ({
  garbageCollectAttachments: async () => undefined,
}));

vi.mock("@/hooks/use-agent-form-state", () => ({
  useAgentFormState: () => ({
    selectedServerId: "host-1",
    selectedProvider: "codex",
    setProviderFromUser: () => undefined,
    selectedMode: "auto",
    setModeFromUser: () => undefined,
    selectedModel: "",
    setModelFromUser: () => undefined,
    selectedThinkingOptionId: "",
    setThinkingOptionFromUser: () => undefined,
    workingDir: "/repo",
    providerDefinitions: [{ id: "codex", label: "Codex", modes: [{ id: "auto", label: "Auto" }] }],
    providerDefinitionMap: new Map(),
    agentDefinition: undefined,
    modeOptions: [{ id: "auto", label: "Auto" }],
    availableModels: [
      {
        provider: "codex",
        id: "gpt-5.4",
        label: "gpt-5.4",
        isDefault: true,
        defaultThinkingOptionId: "high",
        thinkingOptions: [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
    ],
    allProviderModels: new Map([
      [
        "codex",
        [
          {
            provider: "codex",
            id: "gpt-5.4",
            label: "gpt-5.4",
            isDefault: true,
            defaultThinkingOptionId: "high",
            thinkingOptions: [
              { id: "medium", label: "Medium" },
              { id: "high", label: "High", isDefault: true },
            ],
          },
        ],
      ],
    ]),
    modelSelectorProviders: [
      {
        id: "codex",
        label: "Codex",
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "codex:gpt-5.4",
              provider: "codex",
              providerLabel: "Codex",
              modelId: "gpt-5.4",
              modelLabel: "gpt-5.4",
              isDefault: true,
            },
          ],
        },
      },
    ],
    isAllModelsLoading: false,
    isProviderModelsRefreshing: false,
    availableThinkingOptions: [
      { id: "medium", label: "Medium" },
      { id: "high", label: "High", isDefault: true },
    ],
    isModelLoading: false,
    modelError: null,
    refreshProviderModels: () => undefined,
    setProviderAndModelFromUser: () => undefined,
    workingDirIsEmpty: false,
    persistFormPreferences: async () => undefined,
  }),
}));

const mountedRoots = new Set<Root>();
function createTestRoot(container: HTMLElement): Root {
  const root = createRoot(container);
  mountedRoots.add(root);
  return root;
}

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots) root.unmount();
    mountedRoots.clear();
  });
});

let useAgentInputDraft: typeof import("./input-draft").useAgentInputDraft;
type DraftRecordForTest = ReturnType<typeof useDraftStore.getState>["drafts"][string];

beforeAll(async () => {
  const storage = new Map<string, string>();

  // The environment supplies the DOM (see the docblock). Only `localStorage` is replaced,
  // because these tests assert against its contents, and it is installed before the dynamic
  // import below so persisted-draft hydration reads the controlled map on first load.
  Object.defineProperty(globalThis.window, "localStorage", {
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });

  ({ useAgentInputDraft } = await import("./input-draft"));
});

describe("useAgentInputDraft live contract", () => {
  beforeEach(() => {
    asyncStorage.clear();
    document.body.innerHTML = "<div id='root'></div>";
    localStorage.clear();

    useDraftStore.setState({
      drafts: {},
      createModalDraft: null,
      attachmentFocusRequestByDraftKey: {},
    });
  });

  it("hydrates persisted text and attachments and returns draft-mode composer state for a caller-provided key", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "attachment-1",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/1",
      createdAt: 1,
      fileName: "image.png",
      byteSize: 128,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe({ draftKey }: { draftKey: string }) {
      latest = useAgentInputDraft({
        draftKey,
        composer: {
          initialServerId: "host-1",
          isVisible: true,
          lockedWorkingDir: "/repo",
        },
      });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    let root: Root | null = createTestRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Probe draftKey="draft:setup" />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().composerState?.agentControls.selectedProvider).toBe("codex");
    expect(getLatest().composerState?.commandDraftConfig).toEqual({
      provider: "codex",
      cwd: "/repo",
      modeId: "auto",
      model: "gpt-5.4",
      thinkingOptionId: "high",
    });

    const hydratedTextReplacement = getLatest().textReplacement;

    await act(async () => {
      getLatest().setText("hello world");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    expect(getLatest().textReplacement).toBe(hydratedTextReplacement);

    await act(async () => {
      getLatest().replaceText("replacement text");
    });

    expect(getLatest().textReplacement).not.toBe(hydratedTextReplacement);
    expect(getLatest().textReplacement.text).toBe("replacement text");

    await act(async () => {
      getLatest().editText("hello world");
    });

    await act(async () => {
      root!.unmount();
    });

    root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe draftKey="draft:setup" />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().text).toBe("hello world");
    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
  });

  it("migrates legacy image drafts to image attachments on hydration", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "legacy-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/legacy-image",
      createdAt: 10,
      fileName: "legacy.png",
      byteSize: 512,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    useDraftStore.setState({
      drafts: {
        "draft:legacy": {
          input: {
            text: "legacy text",
            images: [image],
          },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
      createModalDraft: null,
    });

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:legacy" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().text).toBe("legacy text");
    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
    expect(useDraftStore.getState().drafts["draft:legacy"]?.input).toEqual({
      text: "legacy text",
      attachments: [{ kind: "image", metadata: image }],
    });
  });

  it("hydrates drafts saved by old builds with cwd", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const githubIssue: ComposerAttachment = {
      kind: "github_issue",
      item: {
        kind: "issue",
        number: 42,
        title: "Unify attachments",
        url: "https://github.com/otto/otto/issues/42",
        state: "open",
        body: "body",
        labels: ["composer"],
      },
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    useDraftStore.setState({
      drafts: {
        "draft:new-shape": {
          input: {
            text: "new text",
            attachments: [githubIssue],
            cwd: "/persisted",
          },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
      createModalDraft: null,
    });

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:new-shape" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().text).toBe("new text");
    expect(getLatest().attachments).toEqual([githubIssue]);

    await act(async () => {
      root.unmount();
    });

    expect(useDraftStore.getState().drafts["draft:new-shape"]?.input).toEqual({
      text: "new text",
      attachments: [githubIssue],
      cwd: "/persisted",
    });
  });

  it("updates and persists attachments through setAttachments", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "next-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/next-image",
      createdAt: 11,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:attachments" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().setText("with attachment");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
    const readPersistedInput = () => useDraftStore.getState().drafts["draft:attachments"]?.input;
    await act(async () => {
      // Web text publication occurs after paint; attachments save immediately.
      await expect.poll(readPersistedInput).toEqual({
        text: "with attachment",
        attachments: [{ kind: "image", metadata: image }],
      });
    });
    await act(async () => {
      root.unmount();
    });
  });

  it("attaches to an unmounted legacy draft without losing its input", async () => {
    const image: AttachmentMetadata = {
      id: "legacy-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/legacy-image",
      createdAt: 10,
    };
    useDraftStore.setState({
      drafts: {
        "draft:legacy-workspace-file": {
          input: { text: "legacy text", images: [image] },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
    });

    await useDraftStore.getState().attachWorkspaceFile({
      draftKey: "draft:legacy-workspace-file",
      attachment: createWorkspaceFileAttachment({ path: "src/app.ts" }),
    });

    expect(useDraftStore.getState().getDraftInput("draft:legacy-workspace-file")).toEqual({
      text: "legacy text",
      attachments: [
        { kind: "image", metadata: image },
        createWorkspaceFileAttachment({ path: "src/app.ts" }),
      ],
    });
  });

  it("a programmatic rewrite wins over a pending typing checkpoint", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:rewrite-race" });
      return null;
    }
    function current() {
      if (!latest) throw new Error("Expected draft");
      return latest;
    }
    const container = document.getElementById("root");
    if (!container) throw new Error("Missing root");
    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    vi.useFakeTimers();
    try {
      await act(async () => {
        current().editText("stale native typing");
      });
      await act(async () => {
        current().replaceText("authoritative rewrite");
      });
      const replacement = current().textReplacement;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(current().text).toBe("authoritative rewrite");
      expect(current().textReplacement).toBe(replacement);
      expect(replacement.text).toBe("authoritative rewrite");
      expect(useDraftStore.getState().getDraftInput("draft:rewrite-race")?.text).toBe(
        "authoritative rewrite",
      );
      await act(async () => {
        current().clear("sent");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(current().textReplacement.text).toBe("");
      expect(useDraftStore.getState().getDraftInput("draft:rewrite-race")?.text ?? "").toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clear resets text and attachments", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "clear-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/clear-image",
      createdAt: 12,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:clear" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().setText("queued message");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    const replacementKeyBeforeClear = getLatest().textReplacement.key;

    await act(async () => {
      getLatest().clear("sent");
    });

    expect(getLatest().text).toBe("");
    expect(getLatest().textReplacement.key).not.toBe(replacementKeyBeforeClear);
    expect(getLatest().attachments).toEqual([]);
    expect(useDraftStore.getState().drafts["draft:clear"]?.input).toEqual({
      text: "",
      attachments: [],
    });
  });

  it("clears drafts with sent and abandoned lifecycle tombstones", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const sentImage: AttachmentMetadata = {
      id: "attachment-sent",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/sent",
      createdAt: 2,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:lifecycle" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().setText("queued message");
      getLatest().setAttachments([{ kind: "image", metadata: sentImage }]);
    });

    await act(async () => {
      getLatest().clear("sent");
    });

    expect(getLatest().text).toBe("");
    expect(getLatest().attachments).toEqual([]);
    expect(useDraftStore.getState().drafts["draft:lifecycle"]).toMatchObject({
      lifecycle: "sent",
      input: { text: "", attachments: [] },
    });

    await act(async () => {
      getLatest().setText("draft again");
    });

    await act(async () => {
      getLatest().clear("abandoned");
    });

    expect(useDraftStore.getState().drafts["draft:lifecycle"]).toMatchObject({
      lifecycle: "abandoned",
      input: { text: "", attachments: [] },
    });
  });
});
