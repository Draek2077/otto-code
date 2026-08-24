/**
 * @vitest-environment jsdom
 */
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantFileLinkResolverConfigRef } from "./provider";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(async () => true),
}));

vi.mock("@/components/ui/context-menu", async () => {
  const { createElement } = await import("react");
  return {
    ContextMenuItem: ({ children, testID }: { children: ReactNode; testID?: string }) =>
      createElement("span", { "data-testid": testID }, children),
  };
});

const { AssistantLinkContextMenuContent } = await import("./link-context-menu");

const WORKSPACE_ROOT = "/Users/test/project";

const configRef: AssistantFileLinkResolverConfigRef = {
  current: { workspaceRoot: WORKSPACE_ROOT },
};

const PARTIAL_URL_SOURCE = { href: "/oauth2/sign_out", text: "/oauth2/sign_out" };
const PROJECT_FILE_SOURCE = { href: "src/app.ts", text: "src/app.ts" };
const PROJECT_FILE_TARGET = {
  raw: "src/app.ts",
  path: `${WORKSPACE_ROOT}/src/app.ts`,
};

const resolveNothing = async () => null;
const resolveProjectFile = async () => PROJECT_FILE_TARGET;
const open = vi.fn();

describe("AssistantLinkContextMenuContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  // A named declaration, not an inline arrow: it keeps the `expect(...)` case
  // inside the nested-callback budget.
  function render(node: ReactNode): void {
    act(() => {
      root.render(node);
    });
  }

  // The chat menu surface is a sibling of the transcript, so this content never
  // renders under AssistantFileLinkResolverProvider. Requiring that context
  // here threw on every right click of a file link and blanked the app.
  it("renders without the assistant file link resolver provider", () => {
    expect(() =>
      render(
        <AssistantLinkContextMenuContent
          configRef={configRef}
          source={PARTIAL_URL_SOURCE}
          target={null}
          resolve={resolveNothing}
          open={open}
          workspaceRoot={WORKSPACE_ROOT}
        />,
      ),
    ).not.toThrow();

    expect(container.querySelector("[data-testid='assistant-file-link-copy']")).not.toBeNull();
    expect(container.querySelector("[data-testid='assistant-file-link-open-file']")).toBeNull();
  });

  it("offers workspace navigation for a resolved project file", () => {
    render(
      <AssistantLinkContextMenuContent
        configRef={configRef}
        source={PROJECT_FILE_SOURCE}
        target={PROJECT_FILE_TARGET}
        resolve={resolveProjectFile}
        open={open}
        workspaceRoot={WORKSPACE_ROOT}
      />,
    );

    expect(container.querySelector("[data-testid='assistant-file-link-open-file']")).not.toBeNull();
    expect(
      container.querySelector("[data-testid='assistant-file-link-navigate-to-file']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='assistant-file-link-navigate-to-folder']"),
    ).not.toBeNull();
  });
});
