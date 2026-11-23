import { expect, test } from "vitest";
import { externalBrowserUrl, isFindShortcut } from "./action-policy";
test("external browsing accepts only ordinary non-credential page URLs", () => {
  expect(externalBrowserUrl("https://example.test/path?q=1")).toBe("https://example.test/path?q=1");
  for (const value of [
    null,
    "not a url",
    "file:///private",
    "javascript:alert(1)",
    "https://user:secret@example.test/",
  ])
    expect(externalBrowserUrl(value)).toBeNull();
});
test("find shortcuts belong only to their exact browser identity", () => {
  expect(isFindShortcut({ action: "find-in-page", browserId: "tab-a" }, "tab-a")).toBe(true);
  for (const value of [
    null,
    [],
    {},
    { action: "focus-url", browserId: "tab-a" },
    { action: "find-in-page", browserId: "tab-b" },
  ])
    expect(isFindShortcut(value, "tab-a")).toBe(false);
});
