// visualizer-bundle.gen.ts is ~360 KB of inline HTML/JS/CSS as a single string
// export. Every platform view calls this instead of importing the module at
// the top level, so the bundle is only fetched/parsed once a Visualizer tab
// actually mounts.
let cachedHtmlPromise: Promise<string> | null = null;

export function loadVisualizerHtml(): Promise<string> {
  if (!cachedHtmlPromise) {
    cachedHtmlPromise = import("./visualizer-bundle.gen").then((mod) => mod.VISUALIZER_HTML);
  }
  return cachedHtmlPromise;
}

/** Substitutes the shell's devicePixelRatio-cap placeholder (emit-bundle.mjs)
 * with the render-quality setting's scale. The page reads dpr once at boot,
 * so a scale change requires reloading the guest — the views achieve that by
 * deriving their html from this and letting the document remount. */
export function applyVisualizerRenderScale(html: string, scale: number): string {
  return html.replace("__OTTO_DPR_CAP__", String(scale));
}

/** Substitutes the shell's theme placeholder (emit-bundle.mjs) with the
 * palette JSON from resolveVisualizerTheme. Double-encoded so the shell's
 * `JSON.parse("...")` sees a valid JS string literal; `<` is escaped so the
 * payload can never terminate the shell's inline <script>. Like the dpr cap,
 * the palette is baked per load — the vendor page consumes it at module init
 * (COLORS merge), so a theme change reloads the guest. */
export function applyVisualizerTheme(html: string, themeJson: string): string {
  const literal = JSON.stringify(themeJson).replace(/</g, "\\u003c");
  return html.replace('"__OTTO_THEME_JSON__"', literal);
}
