import { expect, test } from "vitest";
import { classifyBrowserReservedShortcut } from "../../features/browser-keyboard/policy.js";
test("find in page uses the platform command modifier without stealing modified or released keys", () => {
  const key = { type: "keyDown", key: "f", control: true, meta: false, alt: false, shift: false };
  expect(classifyBrowserReservedShortcut(key, { isMac: false })).toBe("find-in-page");
  expect(
    classifyBrowserReservedShortcut({ ...key, control: false, meta: true }, { isMac: true }),
  ).toBe("find-in-page");
  for (const change of [
    { shift: true },
    { alt: true },
    { meta: true },
    { type: "keyUp" },
    { control: false },
  ])
    expect(classifyBrowserReservedShortcut({ ...key, ...change }, { isMac: false })).toBeNull();
});
