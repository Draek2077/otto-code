/**
 * Shared UI files with a visible fixture in the in-app UI Gallery.
 * Platform variants are listed separately because each is a real Metro entry.
 */
export const UI_STATE_GALLERY_COVERED_FILES = [
  "alert.tsx",
  "autocomplete.tsx",
  "button.tsx",
  "color-wheel-picker.tsx",
  "combobox.tsx",
  "dropdown-menu.tsx",
  "external-link.tsx",
  "form-field.tsx",
  "loading-spinner.tsx",
  "number-stepper-field.tsx",
  "page-loading.tsx",
  "scrollable-code-surface.tsx",
  "search-clear-button.tsx",
  "segmented-control.tsx",
  "select-field.tsx",
  "shortcut.tsx",
  "slider.tsx",
  "split-button.tsx",
  "status-badge.tsx",
  "switch.tsx",
  "text-field-picker.tsx",
  "titlebar-popup-search-field.tsx",
  "toolbar-icon-button.tsx",
  "toolbar-separator.tsx",
  "tooltip.tsx",
] as const;

/**
 * Files intentionally represented by another fixture or owning no standalone
 * visual chrome. Every new shared `.tsx` file must be covered or explain why
 * it is not an independently auditable element.
 */
export const UI_STATE_GALLERY_EXEMPTIONS: Readonly<Record<string, string>> = {
  "autocomplete-popover.tsx": "Composition of the covered Autocomplete and floating surface.",
  "horizontal-scroll-boundary.tsx":
    "Exports a scroll-boundary hook only; it renders nothing of its own.",
  "overlay-scrollbar/dom-overlay-scrollbar.tsx":
    "Web DOM half of the overlay scrollbar; it has no resting state away from a scrolling surface.",
  "overlay-scrollbar/overlay-scrollbar.tsx":
    "Draws over whichever surface is scrolling, so it has no standalone fixture to audit.",
  "pane-content-toolbar.tsx":
    "Composition of the covered toolbar icon buttons and separators over a pane's content.",
  "skeleton-pulse.tsx":
    "Animation driver hook for the skeletons that use it; it renders no element itself.",
  "skeleton-pulse.web.tsx":
    "Web variant of the same driver hook, sharing its timing with the native one.",
  "text-input/text-input.tsx":
    "Editing-surface primitive with no chrome of its own; the fields that wrap it are covered.",
  "text-input/text-input.web.tsx":
    "Web variant of the same unstyled editing primitive, differing only in IME handling.",
  "toolbar-label-trigger.tsx":
    "Style helpers for the covered toolbar buttons rather than an element of its own.",
  "trailing-action-scrim.tsx":
    "Gradient fade behind a hovered row's trailing actions; it has no state of its own to audit.",
  "combobox-trigger.tsx": "Structural trigger wrapper; its visual chrome is caller-owned.",
  "control-state-preview.tsx": "Gallery-only state plumbing with no standalone visual chrome.",
  "context-menu.tsx": "Uses the covered dropdown menu items and floating surface.",
  "dropdown-trigger.tsx": "Structural chevron wrapper around the covered DropdownMenuTrigger.",
  "floating-panel-portal.tsx": "Portal infrastructure with no standalone visual chrome.",
  "floating.tsx": "Surface infrastructure exercised by live dropdown and tooltip fixtures.",
  "highlighted-text.tsx":
    "Search-match styling used inline in diff and agent list results, not a gallery fixture.",
  "isolated-bottom-sheet-modal/index.tsx": "Lifecycle wrapper with no standalone visual chrome.",
  "menu/menu-item.tsx":
    "Menu engine internals rendered live through the covered DropdownMenuItem fixture.",
  "menu/menu-overlay.tsx":
    "Positioning and portal engine rendered beneath the covered DropdownMenuContent fixture.",
  "menu/menu-root.tsx":
    "State and trigger engine behind the covered DropdownMenu and DropdownMenuTrigger fixtures.",
  "menu/menu-sub.tsx":
    "Submenu variant of the covered MenuItem engine; no gallery fixture opens a submenu page.",
  "menu/menu-surface.tsx":
    "Popover and sheet engine rendered through the covered DropdownMenuContent fixture.",
  "pinnable-toolbar.tsx":
    "Composition of the covered toolbar buttons, dropdown menu, and tooltip primitives.",
  "overlay-scrollbar/use-overlay-flat-list-scrollbar.tsx":
    "Native/base stub with no visual chrome; the web override renders the actual thumb.",
  "overlay-scrollbar/use-overlay-flat-list-scrollbar.web.tsx":
    "Scroll-thumb hook for host FlatLists such as the workspace tree; no gallery list hosts it.",
  "press-highlight.native.tsx":
    "Native highlight overlay behind the covered context menu; unreachable in the web gallery.",
  "press-highlight.tsx":
    "Web pass-through to Pressable behind the covered context menu; no chrome of its own.",
  "search-field.tsx":
    "Standalone filter field used in app screens; the gallery shows the titlebar variant.",
  "sheet-chrome.tsx":
    "Shared bottom-sheet frame - handle, corners, title, indent - rendered beneath every covered sheet fixture.",
  "tabbed-modal-sheet.tsx": "Composition of the gallery's modal surface and segmented controls.",
  "text-area.tsx": "Unstyled platform pass-through; field chrome is caller-owned.",
  "text-area.web.tsx": "Web scrolling implementation of the unstyled TextArea pass-through.",
};
