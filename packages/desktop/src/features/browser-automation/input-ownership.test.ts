import { expect, test } from "vitest";
import type { MouseInputEvent } from "electron";
import { observeBrowserUserActivation, withBrowserAutomationInput } from "./input-ownership.js";

test("only user mouse presses transfer ownership, including after overlapping failed input", async () => {
  const sent: unknown[] = [];
  let receive!: (event: unknown, input: MouseInputEvent) => void;
  let attachments = 0;
  const guest = {
    id: 42,
    hostWebContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    },
    on: (_event: "before-mouse-event", callback: typeof receive) => {
      receive = callback;
      attachments++;
    },
  };
  const click = () => receive({}, { type: "mouseDown", x: 1, y: 2, button: "left" });
  observeBrowserUserActivation(guest);
  observeBrowserUserActivation(guest);
  expect(attachments).toBe(1);
  await withBrowserAutomationInput(42, async () => {
    click();
    await expect(
      withBrowserAutomationInput(42, async () => {
        click();
        throw new Error("closed");
      }),
    ).rejects.toThrow("closed");
    click();
  });
  expect(sent).toEqual([]);
  click();
  expect(sent).toEqual([
    { channel: "otto:event:browser-user-activation", payload: { webContentsId: 42 } },
  ]);
});
