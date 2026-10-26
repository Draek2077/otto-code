import type { HostBrowserInput } from "@getpaseo/plugin/otto/host-browser";
import type { ManagedHostPage } from "./runtime.js";
import type { Page, CDPSession } from "playwright-core";
import { HostBrowserInputs } from "./input-state.js";
const touchTypes = {
  start: "touchStart",
  move: "touchMove",
  end: "touchEnd",
  cancel: "touchCancel",
} as const;
export function createHostBrowserInputs(page: Page, cdp: CDPSession): HostBrowserInputs {
  return new HostBrowserInputs({
    pointer: async (input) => {
      await page.mouse.move(input.x, input.y);
      if (input.phase === "down") await page.mouse.down({ button: input.button });
      if (input.phase === "up") await page.mouse.up({ button: input.button });
    },
    releaseButton: (button) => page.mouse.up({ button }),
    wheel: async (input) => {
      await page.mouse.move(input.x, input.y);
      await page.mouse.wheel(input.deltaX, input.deltaY);
    },
    text: (text) => page.keyboard.insertText(text),
    key: async (input) => {
      if (input.phase === "down") await page.keyboard.down(input.key);
      else await page.keyboard.up(input.key);
    },
    touch: async (input) => {
      await cdp.send("Input.dispatchTouchEvent", {
        type: touchTypes[input.phase],
        touchPoints: input.points,
      });
    },
  });
}
export async function dispatchHostBrowserInput(
  host: ManagedHostPage,
  input: HostBrowserInput,
  ticket: string,
) {
  host.assertUsable();
  await host.inputs.dispatch(ticket, input);
}
