import { expect, test } from "vitest";
import {
  artifactData,
  artifactPreview,
  replaceArtifactData,
  validateArtifactHtml,
} from "./content.js";
const prefix =
  '<!doctype html><html><head><title>Report</title><style>body { color: red }</style></head><body>\r\n<script id="otto-artifact-data" type="application/json">';
const suffix = '</script>\r\n<script>document.body.dataset.ready="yes"</script></body></html>';
const html = prefix + '{"value":1}' + suffix;
test("data updates preserve every byte outside the contract and escape closing-script injection", () => {
  const next = replaceArtifactData(
    html,
    JSON.stringify({ value: "</script><script>alert(1)</script>" }),
  );
  expect(next.startsWith(prefix)).toBe(true);
  expect(next.endsWith(suffix)).toBe(true);
  expect(next.slice(prefix.length, -suffix.length)).not.toContain("<");
  expect(JSON.parse(artifactData(next)!)).toEqual({ value: "</script><script>alert(1)</script>" });
});
test("preview strips encoded author policies and refresh without changing stored HTML", () => {
  const hostile = html.replace(
    "<title>",
    '<meta HTTP-EQUIV="content-security-pol&#105;cy" content="default-src *"><meta http-equiv=refresh content="0;url=https://example.com"><base href="https://example.com"><title>',
  );
  const preview = artifactPreview(hostile);
  expect(preview.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  expect(preview).not.toContain("default-src *");
  expect(preview).not.toContain("<base");
  expect(preview).not.toContain("http-equiv=refresh");
  expect(artifactPreview(preview)).toBe(preview);
});
test.each([
  "<html><head></head><body>missing close",
  html.replace('{"value":1}', "bad-json"),
  html.replace(
    "</body>",
    '<script id="otto-artifact-data" type="application/json">{}</script></body>',
  ),
  html.replace("<head>", "<script>fetch('https://example.com')</script><head>"),
  html.replace("<head>", "<head></head><head>"),
  `unexpected text${html}`,
  `<img src="https://example.com">${html}`,
])("refuses incomplete or ambiguous data contracts", (text) => {
  expect(() => validateArtifactHtml(text)).toThrow();
});
test("an artifact without a data contract requires explicit regeneration", () => {
  expect(() =>
    replaceArtifactData("<html><head></head><body>Static report</body></html>", "{}"),
  ).toThrow("no data contract");
});
