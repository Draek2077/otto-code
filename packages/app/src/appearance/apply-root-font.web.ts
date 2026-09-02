const STYLE_ID = "otto-ui-font";
const RULE =
  ":is(#root, #overlay-root) *:not([data-pmono]):not([data-pmono] *){font-family:var(--otto-ui-font);}";

export function applyRootUiFont(uiFontStack: string): void {
  if (typeof document === "undefined") return;
  const value = uiFontStack
    .replace(/[<>{}();]/g, "")
    .replace(/[\r\n]/g, " ")
    .trim();
  if (value.length === 0) return;
  document.documentElement.style.setProperty("--otto-ui-font", value);
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = RULE;
    document.head.appendChild(style);
  }
}
