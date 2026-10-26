import type { HostBrowserInput } from "@getpaseo/plugin/otto/host-browser";
import type { ManagedHostPage } from "./runtime.js";
const touchTypes = {
  start: "touchStart",
  move: "touchMove",
  end: "touchEnd",
  cancel: "touchCancel",
} as const;
export async function dispatchHostBrowserInput(host: ManagedHostPage, input: HostBrowserInput) {
  host.assertUsable();
  const { page } = host;
  switch (input.kind) {
    case "pointer":
      await page.mouse.move(input.x, input.y);
      if (input.phase === "down") await page.mouse.down({ button: input.button });
      if (input.phase === "up") await page.mouse.up({ button: input.button });
      return;
    case "wheel":
      await page.mouse.move(input.x, input.y);
      await page.mouse.wheel(input.deltaX, input.deltaY);
      return;
    case "text":
      await page.keyboard.insertText(input.text);
      return;
    case "key":
      if (input.phase === "down") await page.keyboard.down(input.key);
      else await page.keyboard.up(input.key);
      return;
    case "touch":
      if (new Set(input.points.map((point) => point.id)).size !== input.points.length)
        throw new Error("Duplicate touch identities are not valid.");
      await host.cdp.send("Input.dispatchTouchEvent", {
        type: touchTypes[input.phase],
        touchPoints: input.points,
      });
      return;
  }
}
