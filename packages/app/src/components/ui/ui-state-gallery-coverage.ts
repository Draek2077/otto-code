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
  "combobox-trigger.tsx": "Structural trigger wrapper; its visual chrome is caller-owned.",
  "control-state-preview.tsx": "Gallery-only state plumbing with no standalone visual chrome.",
  "context-menu.tsx": "Uses the covered dropdown menu items and floating surface.",
  "dropdown-trigger.tsx": "Structural chevron wrapper around the covered DropdownMenuTrigger.",
  "floating-panel-portal.tsx": "Portal infrastructure with no standalone visual chrome.",
  "floating.tsx": "Surface infrastructure exercised by live dropdown and tooltip fixtures.",
  "isolated-bottom-sheet-modal/index.tsx": "Lifecycle wrapper with no standalone visual chrome.",
  "tabbed-modal-sheet.tsx": "Composition of the gallery's modal surface and segmented controls.",
  "text-area.tsx": "Unstyled platform pass-through; field chrome is caller-owned.",
  "text-area.web.tsx": "Web scrolling implementation of the unstyled TextArea pass-through.",
};
