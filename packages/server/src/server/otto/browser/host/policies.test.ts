import { expect, test } from "vitest";
import { runInNewContext } from "node:vm";
import { hostBrowserCandidates } from "./runtime-paths.js";
import { hostScreenshotScale } from "./screenshot.js";
import { hostEvaluation, HostEvaluationSchema } from "./evaluate.js";
test("browser discovery preserves Edge, Chrome and bundled priority without commands or downloads", () => {
  const candidates = hostBrowserCandidates({
    platform: "win32",
    environment: { ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\User\\Local" },
    home: "C:\\User",
    bundled: "C:\\cache\\chrome.exe",
  });
  expect(candidates[0]).toBe("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe");
  expect(candidates.at(-1)).toBe("C:\\cache\\chrome.exe");
  expect(candidates.every((candidate) => !candidate.includes("undefined"))).toBe(true);
  expect(
    hostBrowserCandidates({
      platform: "linux",
      environment: {},
      home: "/home/user",
      bundled: "/cache/chrome",
    }),
  ).toContain("/usr/bin/chromium");
  expect(
    hostBrowserCandidates({
      platform: "darwin",
      environment: {},
      home: "/Users/user",
      bundled: "/cache/chrome",
    }),
  ).toContain("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
});
test.each([
  [390, 844],
  [4096, 4096],
  [1200, 90_000],
  [1920, 1080],
])("screenshot geometry %ix%i obeys both vision budgets without enlarging", (width, height) => {
  const scale = hostScreenshotScale(width, height);
  expect(scale).toBeLessThanOrEqual(1);
  expect(Math.max(width, height) * scale).toBeLessThanOrEqual(1568.000001);
  expect(width * height * scale ** 2).toBeLessThanOrEqual(1_150_000.000001);
});
test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  "nonpositive/nonfinite capture geometry %s is refused",
  (value) => {
    expect(() => hostScreenshotScale(value, 800)).toThrow("geometry");
  },
);
test("page evaluation awaits functions and binds the validated element without host execution", async () => {
  const output = HostEvaluationSchema.parse(
    await runInNewContext(hostEvaluation("async element => ({id: element.id})", "node"), {
      node: { id: "fixture" },
    }),
  );
  expect(JSON.parse(output.resultJson)).toEqual({ id: "fixture" });
  expect(output.truncated).toBe(false);
});
test("evaluation is capped in the page even for an escape-heavy result", async () => {
  const output = HostEvaluationSchema.parse(
    await runInNewContext(hostEvaluation("() => '\\\\'.repeat(200000)", null)),
  );
  expect(output.truncated).toBe(true);
  expect(output.resultJson.length).toBeLessThanOrEqual(80_000);
  expect(typeof JSON.parse(output.resultJson)).toBe("string");
});
