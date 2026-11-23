import { test, expect, vi } from "vitest";
import { WorkflowDraft } from "./draft";
import { WorkflowTemplatePreviewForm } from "./template-preview-model";
import { scope, deferred } from "./test-fixtures";
function fixture() {
  const draft = new WorkflowDraft(
      scope,
      {
        kind: "template",
        value: { id: "template", name: "Template", content: "Read <%= topic %>" },
      },
      null,
    ),
    model = new WorkflowTemplatePreviewForm(draft),
    release = model.activate();
  model.variables('{"topic":"A&B"}');
  return { draft, model, release };
}
test("preview sends exact current source and data without enabling code implicitly", async () => {
  const f = fixture(),
    port = vi.fn(async () => ({ text: "Read A&B" }));
  await f.model.preview(port);
  expect(port).toHaveBeenCalledWith({
    scope,
    template: f.draft.getSnapshot().document.value,
    variables: { topic: "A&B" },
    allowCode: false,
  });
  expect(f.model.getSnapshot()).toMatchObject({ text: "Read A&B", version: 0 });
  f.release();
});
test("new template edits and hidden surfaces invalidate late preview results", async () => {
  const f = fixture(),
    pending = deferred<{ text: string }>(),
    render = f.model.preview(() => pending.promise);
  f.draft.patch(["value", "content"], "New source");
  f.release();
  const release = f.model.activate();
  pending.resolve({ text: "Old preview" });
  await render;
  expect(f.model.getSnapshot().text).toBe("");
  release();
});
