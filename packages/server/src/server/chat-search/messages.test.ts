import { expect, test } from "vitest";
import { projectSearchMessages } from "./messages.js";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";

function assistant(seq: number, text: string): AgentTimelineRow {
  return {
    seq,
    timestamp: "2026-09-25T00:00:00Z",
    item: { type: "assistant_message", messageId: "reply", text },
  };
}
test("coalesces streamed text, resolves the last contributing row and keeps keys stable on hydration", () => {
  const live = projectSearchMessages([assistant(2, "Apricot "), assistant(3, "orchard")]);
  const hydrated = projectSearchMessages([assistant(1, "Apricot orchard")]);
  expect(live).toHaveLength(1);
  expect(live[0].text).toBe("Apricot orchard");
  expect(live[0].sourceSeq).toBe(3);
  expect(live[0].key).toBe(hydrated[0].key);
});
test("does not join messages separated by tool activity and distinguishes duplicate text", () => {
  const projected = projectSearchMessages([assistant(1, "orchard"), assistant(3, "orchard")]);
  expect(projected).toHaveLength(2);
  expect(projected[0].key).not.toBe(projected[1].key);
});
