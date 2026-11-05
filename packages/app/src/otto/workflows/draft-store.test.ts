import { test, expect } from "vitest";
import { draftFor, workflowDrafts, discardWorkflowDraft } from "./draft-store";
import { scope, authored, entry } from "./test-fixtures";
test("library and workspace drafts have separate lifetime authority over the same saved origin", async () => {
  const owner = {},
    left = draftFor(owner, scope, "library", authored(), entry()),
    right = draftFor(owner, scope, "workspace:one", authored(), entry());
  expect(left).not.toBe(right);
  expect(draftFor(owner, scope, "library", authored(), entry())).toBe(left);
  const releaseLeft = left.activate(),
    releaseRight = right.activate();
  releaseRight();
  left.patch(["value", "title"], "Visible editor");
  const saved = await left.save({
    read: async () => entry(),
    save: async (input) => ({ ...entry(), revision: "ack", document: input.document }),
  });
  expect(saved?.document.value.title).toBe("Visible editor");
  releaseLeft();
});
test("bounded retention refuses another dirty draft without evicting existing work; explicit discard frees a slot", () => {
  const owner = {};
  for (let index = 0; index < 16; index++) {
    const doc = authored();
    doc.value.id = `draft-${index}`;
    draftFor(owner, scope, "library", doc, null);
  }
  const extra = authored();
  extra.value.id = "extra";
  expect(() => draftFor(owner, scope, "library", extra, null)).toThrow("explicitly discard");
  const before = workflowDrafts(owner, scope, "library");
  expect(before).toHaveLength(16);
  expect(discardWorkflowDraft(owner, before[0])).toBe(true);
  draftFor(owner, scope, "library", extra, null);
  expect(workflowDrafts(owner, scope, "library")).toHaveLength(16);
});
