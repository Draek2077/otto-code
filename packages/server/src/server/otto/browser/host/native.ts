import { z } from "zod";
import type { Page } from "playwright-core";
import { HostBrowserPages, type HostTab } from "./pages.js";
import { HostBrowserRuntime, type ManagedHostPage } from "./runtime.js";
import { HostBrowserCommands } from "./commands.js";
import { HostBrowserService } from "./service.js";
import { dispatchHostBrowserInput } from "./input.js";
import { hostBrowserDeadline } from "./deadline.js";
import type { BrowserToolsBroker } from "../../../browser-tools/broker.js";
const historySchema = z.object({
  currentIndex: z.number().int(),
  entries: z.array(z.unknown()).max(4096),
});
/** Composition is inert. HostBrowserPages creates native resources outside request-source async storage. */
export function createNativeHostBrowser(ports: {
  home: string;
  hostId: string;
  broker: BrowserToolsBroker;
  reportError?(error: unknown): void;
  runtimeState?(state: "started" | "closed"): void;
  workspaces: { get(id: string): Promise<{ cwd: string; archivedAt: string | null } | null> };
}) {
  const commands = new HostBrowserCommands();
  let pages: HostBrowserPages<ManagedHostPage>;
  const observed = new WeakMap<
    Page,
    { pending: boolean; running: boolean; error: string | null }
  >();
  async function update(tab: HostTab, page: Page, error: string | null) {
    const title = await page.title();
    if (page.isClosed()) return;
    const url = page.url();
    if (url.length > 8192) {
      pages.update(tab.workspaceId, tab.browserId, {
        title: title.slice(0, 8192),
        error:
          "This page's address exceeds the browser metadata budget. The last recorded address is shown; navigate to a shorter address before suspending the tab.",
        isLoading: false,
      });
      return;
    }
    pages.update(tab.workspaceId, tab.browserId, {
      url,
      title: title.slice(0, 8192),
      error,
      isLoading: false,
    });
  }
  function observe(tab: HostTab, page: Page, error: string | null) {
    const state = observed.get(page) ?? { pending: false, running: false, error: null };
    observed.set(page, state);
    state.pending = true;
    state.error = error;
    if (state.running) return;
    state.running = true;
    void (async () => {
      try {
        while (state.pending) {
          state.pending = false;
          await update(tab, page, state.error);
        }
      } catch {
        /* Closed/removed page events cannot recreate a tab or overwrite another workspace. */
      } finally {
        state.running = false;
      }
    })();
  }
  const runtime = new HostBrowserRuntime(ports.home, observe, ports.runtimeState);
  pages = new HostBrowserPages({
    open: async (tab) => {
      try {
        return await runtime.open(tab);
      } catch (error) {
        ports.reportError?.(error);
        throw error;
      }
    },
    close: () => runtime.close(),
  });
  async function refresh(tab: HostTab, host: ManagedHostPage) {
    if (host.isClosed()) return;
    await update(tab, host.page, host.lastNavigationError);
    const history = historySchema.parse(await host.cdp.send("Page.getNavigationHistory"));
    const viewport = host.page.viewportSize();
    pages.update(tab.workspaceId, tab.browserId, {
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
      ...(viewport ? { viewportWidth: viewport.width, viewportHeight: viewport.height } : {}),
    });
  }
  return new HostBrowserService({
    ...ports,
    pages,
    clear: (id) => commands.clear(id),
    dialogs: (host) => host.telemetry.takeDialogs(),
    execute: (tab, host, command) =>
      hostBrowserDeadline(
        async () => {
          try {
            const result = await commands.execute(tab, host, command);
            await refresh(tab, host);
            return result;
          } catch (error) {
            await refresh(tab, host).catch(() => {});
            throw error;
          }
        },
        async () => {
          commands.clear(tab.browserId);
          await host.close();
        },
        command.command === "wait" ? (command.args.timeoutMs ?? 5000) + 1000 : 15_000,
      ),
    input: (host, event, ticket) =>
      hostBrowserDeadline(
        () => dispatchHostBrowserInput(host, event, ticket),
        () => host.close(),
        10_000,
      ),
  });
}
