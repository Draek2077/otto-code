import { z } from "zod";
import type {
  BrowserAutomationCommand,
  BrowserAutomationResult,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import type { ManagedHostPage } from "./runtime.js";
import type { HostTab } from "./pages.js";
import { HostBrowserRefs } from "./ref-actions.js";
import { hostUploadFiles } from "./file-input.js";
import { hostEvaluation, HostEvaluationSchema } from "./evaluate.js";
import { hostScreenshot } from "./screenshot.js";
import { createBrowserToolsRequestError } from "../../../browser-tools/errors.js";
const heapSchema = z.object({ usedSize: z.number().nonnegative().finite() });
export class HostBrowserCommands {
  private readonly refs = new HostBrowserRefs();
  clear(browserId: string) {
    this.refs.clear(browserId);
  }
  async execute(
    tab: HostTab,
    host: ManagedHostPage,
    command: BrowserAutomationCommand,
  ): Promise<BrowserAutomationResult> {
    host.assertUsable();
    host.paint.input();
    const result =
      (await this.navigation(tab, host, command)) ??
      (await this.element(tab, host, command)) ??
      (await this.inspect(tab, host, command));
    if (!result)
      throw createBrowserToolsRequestError({
        code: "browser_unsupported",
        message: "This Host Browser command is not supported.",
      });
    const heap = heapSchema.parse(await host.cdp.send("Runtime.getHeapUsage"));
    if (heap.usedSize > 512 * 1024 * 1024) {
      await host.close();
      this.clear(tab.browserId);
      throw createBrowserToolsRequestError({
        code: "browser_tab_closed",
        message:
          "This page exceeded the 512 MiB JavaScript heap limit and was suspended. Reopen it explicitly.",
      });
    }
    return result;
  }
  private async navigation(
    tab: HostTab,
    host: ManagedHostPage,
    command: BrowserAutomationCommand,
  ): Promise<BrowserAutomationResult | null> {
    const { page } = host,
      browserId = tab.browserId;
    switch (command.command) {
      case "navigate":
        this.clear(browserId);
        await host.navigate(command.args.url);
        return { command: command.command, browserId, url: page.url() };
      case "back":
        this.clear(browserId);
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 });
        return { command: command.command, browserId };
      case "forward":
        this.clear(browserId);
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 15_000 });
        return { command: command.command, browserId };
      case "reload":
        this.clear(browserId);
        await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
        return { command: command.command, browserId };
      case "resize":
        if (command.args.width > 4096 || command.args.height > 4096)
          throw new Error("Host Browser viewport dimensions cannot exceed 4096 pixels.");
        await page.setViewportSize({ width: command.args.width, height: command.args.height });
        return {
          command: command.command,
          browserId,
          width: command.args.width,
          height: command.args.height,
        };
      case "wait":
        if (command.args.text)
          await page
            .getByText(command.args.text)
            .first()
            .waitFor({ state: "visible", timeout: command.args.timeoutMs ?? 5000 });
        else
          await page.waitForURL((url) => url.href.includes(command.args.url!), {
            timeout: command.args.timeoutMs ?? 5000,
          });
        return { command: command.command, browserId, matched: command.args.text ? "text" : "url" };
      default:
        return null;
    }
  }
  private async element(
    tab: HostTab,
    host: ManagedHostPage,
    command: BrowserAutomationCommand,
  ): Promise<BrowserAutomationResult | null> {
    const { page } = host,
      browserId = tab.browserId;
    switch (command.command) {
      case "fill":
      case "select":
        await this.refs.value(
          command.command,
          page,
          browserId,
          command.args.ref,
          command.args.value,
        );
        if (command.command === "fill")
          return { command: command.command, browserId, ref: command.args.ref };
        return {
          command: command.command,
          browserId,
          ref: command.args.ref,
          value: command.args.value,
        };
      case "click":
        await this.refs.withElement(page, browserId, command.args.ref, async (target) => {
          await target.click({
            button: command.args.button,
            clickCount: command.args.doubleClick ? 2 : 1,
            modifiers: command.args.modifiers,
          });
        });
        return { command: command.command, browserId, ref: command.args.ref };
      case "hover":
        await this.refs.withElement(page, browserId, command.args.ref, (target) => target.hover());
        return { command: command.command, browserId, ref: command.args.ref };
      case "drag":
        await this.refs.withElement(page, browserId, command.args.sourceRef, async (source) => {
          await this.refs.withElement(page, browserId, command.args.targetRef, async (target) => {
            const from = await source.boundingBox(),
              to = await target.boundingBox();
            if (!from || !to) throw new Error("The drag targets have no visible geometry.");
            await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
            await page.mouse.down();
            try {
              await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
            } finally {
              await page.mouse.up();
            }
          });
        });
        return {
          command: command.command,
          browserId,
          sourceRef: command.args.sourceRef,
          targetRef: command.args.targetRef,
        };
      case "type":
      case "keypress":
        if (command.args.ref)
          await this.refs.withElement(page, browserId, command.args.ref, (target) =>
            target.focus(),
          );
        if (command.command === "type") {
          await page.keyboard.insertText(command.args.text);
          return { command: command.command, browserId, ref: command.args.ref };
        }
        await page.keyboard.press(command.args.key);
        return {
          command: command.command,
          browserId,
          ref: command.args.ref,
          key: command.args.key,
        };
      case "upload": {
        const filePaths = await hostUploadFiles(tab.cwd, command.args.filePaths);
        await this.refs.withElement(page, browserId, command.args.ref, (target) =>
          target.setInputFiles(filePaths),
        );
        return { command: command.command, browserId, ref: command.args.ref, filePaths };
      }
      case "scroll":
        if (command.args.ref)
          await this.refs.withElement(page, browserId, command.args.ref, (target) =>
            target.hover(),
          );
        await page.mouse.wheel(command.args.deltaX, command.args.deltaY);
        return {
          command: command.command,
          browserId,
          ref: command.args.ref,
          deltaX: command.args.deltaX,
          deltaY: command.args.deltaY,
        };
      default:
        return null;
    }
  }
  private async inspect(
    tab: HostTab,
    host: ManagedHostPage,
    command: BrowserAutomationCommand,
  ): Promise<BrowserAutomationResult | null> {
    const { page } = host,
      browserId = tab.browserId;
    switch (command.command) {
      case "snapshot":
        return {
          command: command.command,
          browserId,
          workspaceId: tab.workspaceId,
          url: page.url(),
          title: (await page.title()).slice(0, 8192),
          ...(await this.refs.snapshots.snapshot({ browserId, page: this.refs.page(page) })),
        };
      case "logs":
        return {
          command: command.command,
          browserId,
          ...host.telemetry.logs(command.args.maxEntries),
        };
      case "screenshot":
        return {
          command: command.command,
          browserId,
          ...(await hostScreenshot(page, host.cdp, command.args.fullPage)),
        };
      case "evaluate": {
        const expression = command.args.ref
          ? this.refs.expression(browserId, command.args.ref)
          : null;
        return {
          command: command.command,
          browserId,
          ...HostEvaluationSchema.parse(
            await page.evaluate<unknown>(hostEvaluation(command.args.function, expression)),
          ),
        };
      }
      default:
        return null;
    }
  }
}
