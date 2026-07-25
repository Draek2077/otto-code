/**
 * A curated icon set for widgets, used as `<i class="ti ti-check"></i>`.
 *
 * Claude's widget host describes a 5800-glyph Tabler outline webfont as
 * "already loaded". Otto does not load it: the widget CSP is `default-src
 * 'none'` with no network at all (see `document.ts`), and a webfont large
 * enough to cover 5800 glyphs would have to be either inlined into every guest
 * document or served from an origin that does not survive relay/remote access.
 *
 * So the set is curated instead: ~40 glyphs covering what widgets actually
 * reach for, drawn in Tabler's outline language (24px box, 2px stroke, round
 * caps) and applied as a CSS mask so each one inherits `currentColor`. A name
 * outside the set renders nothing rather than a broken box — and the contract
 * document lists exactly what exists, so the model never guesses.
 */

const ICON_PATHS: Record<string, string> = {
  check: '<path d="M5 12l5 5L20 7"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  "chevron-right": '<path d="M9 6l6 6-6 6"/>',
  "chevron-left": '<path d="M15 6l-6 6 6 6"/>',
  "chevron-down": '<path d="M6 9l6 6 6-6"/>',
  "chevron-up": '<path d="M6 15l6-6 6 6"/>',
  "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
  "arrow-left": '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  "arrow-up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
  "arrow-down": '<path d="M12 5v14M18 13l-6 6-6-6"/>',
  "trending-up": '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  "trending-down": '<path d="M3 7l6 6 4-4 8 8"/><path d="M14 17h7v-7"/>',
  "circle-check": '<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/>',
  "circle-x": '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
  "alert-triangle":
    '<path d="M10.3 4.3L2.8 17a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  "alert-circle": '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  "info-circle": '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  "help-circle":
    '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M21 21l-5.9-5.9"/>',
  home: '<path d="M5 12L3 12l9-9 9 9h-2"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.1A1.6 1.6 0 004.6 8a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1"/>',
  users:
    '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 016-6h2a6 6 0 016 6v1"/><path d="M17 4.5a4 4 0 010 7M19 14a5 5 0 013 4.5V20"/>',
  file: '<path d="M14 3v5h5"/><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/>',
  folder: '<path d="M4 5a2 2 0 012-2h3l2 3h7a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/>',
  star: '<path d="M12 4l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z"/>',
  heart:
    '<path d="M12 20l-7-7a4.2 4.2 0 010-6 4.2 4.2 0 016 0l1 1 1-1a4.2 4.2 0 016 0 4.2 4.2 0 010 6z"/>',
  trash:
    '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3"/>',
  pencil: '<path d="M4 20h4L20 8a2.8 2.8 0 00-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 20V8M7 12l5-5 5 5"/><path d="M4 4h16"/>',
  "external-link":
    '<path d="M14 4h6v6"/><path d="M20 4L10 14"/><path d="M19 14v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5"/>',
  refresh: '<path d="M20 11a8 8 0 10-2 6"/><path d="M20 5v6h-6"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  database:
    '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  code: '<path d="M9 8l-5 4 5 4M15 8l5 4-5 4"/>',
  terminal: '<path d="M5 7l5 5-5 5M13 17h6"/>',
  "chart-bar":
    '<path d="M4 20h16"/><rect x="6" y="10" width="3" height="7"/><rect x="11" y="6" width="3" height="11"/><rect x="16" y="13" width="3" height="4"/>',
  "chart-line": '<path d="M4 20h16"/><path d="M5 15l4-5 4 3 5-7"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 8l9 6 9-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  "eye-off":
    '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.9 9.9 0 0112 6c6.4 0 10 6 10 6a17 17 0 01-3.3 3.9M6.6 8.1A17 17 0 002 12s3.6 6 10 6a9.6 9.6 0 003.4-.6"/>',
  world:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 010 18 15 15 0 010-18z"/>',
  sparkles:
    '<path d="M9 4l1.4 3.6L14 9l-3.6 1.4L9 14l-1.4-3.6L4 9l3.6-1.4z"/><path d="M17 13l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
};

function toMaskUrl(body: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Every icon name a widget may use. The contract document renders this list. */
export const WIDGET_ICON_NAMES: readonly string[] = Object.keys(ICON_PATHS).sort();

/** The `.ti-*` rules. Emitted once into every guest document. */
export function buildWidgetIconRules(): string {
  const rules = Object.entries(ICON_PATHS).map(([name, body]) => {
    const url = toMaskUrl(body);
    return `.ti-${name}{-webkit-mask-image:${url};mask-image:${url};}`;
  });
  return [
    ".ti{display:inline-block;width:1.15em;height:1.15em;vertical-align:-0.18em;",
    "background-color:currentColor;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;",
    "-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;",
    "mask-size:contain;}",
    ...rules,
  ].join("\n");
}
