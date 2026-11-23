import { expect, it } from "vitest";
import { EditorScrollLink } from "./scroll-link";
it("synchronizes either pane without echo loops, stale expected positions, hidden writes or invalid geometry", () => {
  const link = new EditorScrollLink(),
    source: number[] = [],
    preview: number[] = [];
  const releaseSource = link.listen("source", (value) => {
    source.push(value);
    link.report("source", value);
  });
  const releasePreview = link.listen("preview", (value) => {
    preview.push(value);
    link.report("preview", value);
  });
  link.report("source", 0.1);
  expect(preview).toEqual([]);
  link.setEnabled(true);
  link.report("source", 0.5);
  expect(preview).toEqual([0.5]);
  expect(source).toEqual([]);
  link.report("preview", 0.6);
  expect(source).toEqual([0.6]);
  link.report("source", 0.4);
  link.report("source", 0.6);
  expect(preview).toEqual([0.5, 0.4, 0.6]);
  link.report("source", Number.NaN);
  link.report("preview", Infinity);
  link.setEnabled(false);
  link.report("preview", 0.8);
  expect(source).toEqual([0.6]);
  releaseSource();
  releasePreview();
});
