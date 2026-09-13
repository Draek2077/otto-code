import { describe, expect, it } from "vitest";
import { hydrateStreamState, type TodoEntry } from "@/types/stream";
import { projectChecklistActivity } from "./checklist-activity";

describe("evolving checklist activity", () => {
  it("does not label unrelated pending work with the completed task whose provider ID was reused", () => {
    const snapshots: TodoEntry[][] = [
      [{ id: "0", text: "Old work", completed: false, status: "pending" }],
      [{ id: "0", text: "Old work", completed: true, status: "completed" }],
      [{ id: "0", text: "New work", completed: false, status: "pending" }],
    ];
    const cards = hydrateStreamState(
      snapshots.map((items, index) => ({
        event: {
          type: "timeline" as const,
          provider: "codex" as const,
          item: { type: "todo" as const, items },
        },
        timestamp: new Date(index),
      })),
    ).filter((item) => item.kind === "todo_list");
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.items).toEqual(snapshots[2]);
    expect(projectChecklistActivity(card.activity, card.items)).toBeNull();
  });

  it("retains a factual completion when another task starts in the same update", () => {
    const activity = { type: "completed" as const, task: "Inspect" };
    expect(
      projectChecklistActivity(activity, [
        { text: "Inspect", completed: true },
        { text: "Repair", completed: false, status: "in_progress" },
      ]),
    ).toBe(activity);
  });

  it("does not claim completion when the same task returns to pending", () => {
    expect(
      projectChecklistActivity({ type: "completed", task: "Inspect" }, [
        { text: "Inspect", completed: false, status: "pending" },
      ]),
    ).toBeNull();
  });
});
