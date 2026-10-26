const PAGE_PROTOCOLS = new Set(["http:", "https:"]);
/** External browsing is an explicit user action, limited to ordinary page URLs. */
export function externalBrowserUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!PAGE_PROTOCOLS.has(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
export function isFindShortcut(value: unknown, browserId: string): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Reflect.get(value, "action") === "find-in-page" &&
    Reflect.get(value, "browserId") === browserId,
  );
}
