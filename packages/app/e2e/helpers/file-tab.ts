import type { Locator, Page } from "@playwright/test";

// Shared locators for the unified file tab (see components/file-tab-pane.tsx
// and components/file-view-mode-bar.tsx). Kept additive — text-editor.spec.ts
// keeps its own local copies.

/**
 * Mirrors getCloseButtonTestId → encodeFilePathForPathSegment in
 * screens/workspace/workspace-tab-menu.ts (base64url, no padding). The close
 * testid is derived from the tab's file path only, independent of origin.
 */
export function editorTabCloseTestId(path: string): string {
  return `workspace-file-close-${Buffer.from(path, "utf-8").toString("base64url")}`;
}

// Inactive tabs stay mounted (useMountedTabSet), so multiple file-tab panes —
// and their nested CM editors / preview surfaces — coexist in the DOM. Scope
// every locator to the visible (active) pane so assertions never resolve
// against a hidden background tab.

/** The active file tab's pane container (editor, split, and preview render inside it). */
export function fileTabPane(page: Page): Locator {
  return page.locator('[data-testid="workspace-file-tab-pane"]:visible');
}

/** The CM6 editor buffer inside the active file tab pane (empty in preview-only mode). */
export function fileTabEditorContent(page: Page): Locator {
  return fileTabPane(page).locator(".cm-content:visible");
}

/** The active read-only preview surface (components/file-pane.tsx FilePreview). */
export function filePreviewSurface(page: Page): Locator {
  return page.locator('[data-testid="workspace-file-pane"]:visible');
}
