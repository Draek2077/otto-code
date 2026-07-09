import { z } from "zod";
import { BrowserAutomationBrowserIdSchema } from "@otto-code/protocol/browser-automation/rpc-schemas";
import type { BrowserToolsBroker } from "./broker.js";
import type { BrowserToolsResponsePayload } from "./errors.js";
import type { DevServerManager, PreviewServerSummary } from "../preview/dev-server-manager.js";
import type {
  OttoToolConfig,
  OttoToolExecutionContext,
  OttoToolResult,
} from "../agent/tools/types.js";

interface CallerAgentContext {
  id: string;
  cwd: string;
  workspaceId?: string;
}

export interface RegisterBrowserToolsOptions {
  registerTool: (
    name: string,
    config: OttoToolConfig,
    handler: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool inputs are validated by the catalog before execution.
      input: any,
      context: OttoToolExecutionContext,
    ) => Promise<OttoToolResult>,
  ) => void;
  broker: Pick<BrowserToolsBroker, "execute">;
  callerAgentId?: string;
  resolveCallerAgent: () => CallerAgentContext | null;
  /**
   * Running preview dev servers, when the preview subsystem is enabled. Used to
   * redirect browser_new_tab / browser_navigate calls that target a preview
   * server's URL back to that server's designated preview tab, so agents can't
   * end up verifying against a detached duplicate tab.
   */
  previewServers?: Pick<DevServerManager, "list"> | null;
}

const HTTP_URL_ONLY_MESSAGE = "URL must use http/https only";
const WORKSPACE_CONTEXT_MESSAGE =
  "This browser tool needs a workspace. Start the agent from a Otto workspace before calling browser_new_tab or browser_list_tabs.";
const URL_WHITESPACE_PATTERN = /\s/;
const NON_HTTP_EXPLICIT_SCHEME_PATTERN = /^(?!https?:\/\/)[a-z][a-z0-9+.-]*:\/\//i;

const BrowserHttpUrlInputSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    const normalized = normalizeHttpUrlInput(value);
    if (!normalized) {
      context.addIssue({
        code: "custom",
        message: HTTP_URL_ONLY_MESSAGE,
      });
      return z.NEVER;
    }
    return normalized;
  });
const BrowserRefInputSchema = z.string().regex(/^@e\d+$/);
const BrowserClickButtonInputSchema = z.enum(["left", "right", "middle"]);
const BrowserClickModifierInputSchema = z.enum(["Alt", "Control", "Meta", "Shift"]);
const BrowserWaitInputSchema = z
  .object({
    text: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(30_000).optional(),
    browserId: BrowserAutomationBrowserIdSchema,
  })
  .refine((input) => Number(Boolean(input.text)) + Number(Boolean(input.url)) === 1, {
    message: "browser_wait requires exactly one of text or url",
  });

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function urlPort(url: URL): number {
  if (url.port) {
    return Number(url.port);
  }
  return url.protocol === "https:" ? 443 : 80;
}

/**
 * Find the running preview server a URL points at, if any. Preview servers
 * always bind loopback, so a match means "loopback host + same port" — the
 * agent may write localhost where the server registered 127.0.0.1.
 */
function findPreviewServerForUrl(params: {
  previewServers: Pick<DevServerManager, "list"> | null | undefined;
  cwd: string | undefined;
  url: string;
}): PreviewServerSummary | null {
  const { previewServers, cwd, url } = params;
  if (!previewServers || !cwd) {
    return null;
  }
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (!LOOPBACK_HOSTS.has(target.hostname)) {
    return null;
  }
  const port = urlPort(target);
  for (const server of previewServers.list(cwd)) {
    if (server.status !== "exited" && server.port === port) {
      return server;
    }
  }
  return null;
}

/**
 * Deterministic backstop behind the tool-description guardrails: opening a
 * preview server's URL anywhere but its designated tab is rejected with a
 * message pointing at the right browserId (or at preview_start when no tab is
 * bound yet), instead of trusting the agent to have read the descriptions.
 */
function previewTabRedirectResult(params: {
  server: PreviewServerSummary;
  context: { agentId?: string; cwd?: string; workspaceId?: string; browserId?: string };
}): OttoToolResult {
  const { server, context } = params;
  const message = server.boundBrowserId
    ? `${server.url} belongs to the preview server "${server.name}" started with preview_start. ` +
      `Use its designated preview tab instead of opening another one: pass browserId=${server.boundBrowserId} ` +
      `to browser_snapshot, browser_navigate, browser_screenshot, and the other browser tools.`
    : `${server.url} belongs to the preview server "${server.name}", which has no designated preview tab yet. ` +
      `Call preview_start with name "${server.name}" — it opens (or re-finds) the tab and returns its browserId.`;
  return browserToolResult({
    payload: {
      requestId: "browser-tools-preview-redirect",
      ok: false,
      error: {
        code: "browser_denied",
        message,
        retryable: false,
      },
    },
    context,
  });
}

export function registerBrowserTools(options: RegisterBrowserToolsOptions): void {
  options.registerTool(
    "browser_list_tabs",
    {
      title: "List browser tabs",
      description:
        "List open Otto browser tabs for this agent's workspace across connected browser automation hosts. Use returned browserId values with tab-scoped tools.",
      inputSchema: {},
    },
    async () => {
      const context = resolveBrowserToolContext(options);
      const missingWorkspace = requireWorkspaceContext(context);
      if (missingWorkspace) {
        return missingWorkspace;
      }
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
        command: {
          command: "list_tabs",
          args: {},
        },
      });
      return browserToolResult({ payload, context });
    },
  );

  options.registerTool(
    "browser_new_tab",
    {
      title: "Create browser tab",
      description:
        "Create a new Otto browser tab in this agent's workspace on the most recently connected browser automation host, opened in the background without switching the user's view. Pass an http(s) URL or a scheme-less host URL, which is treated as http; the returned browserId is used by tab-scoped tools. " +
        "Do NOT use this to open or view a dev server — preview_start opens the server's designated preview tab and returns its browserId. Use this tool only for external sites and general browsing.",
      inputSchema: {
        url: BrowserHttpUrlInputSchema.optional(),
      },
    },
    async ({ url }) => {
      const context = resolveBrowserToolContext(options);
      const missingWorkspace = requireWorkspaceContext(context);
      if (missingWorkspace) {
        return missingWorkspace;
      }
      if (url) {
        const previewServer = findPreviewServerForUrl({
          previewServers: options.previewServers,
          cwd: context.cwd,
          url,
        });
        if (previewServer) {
          return previewTabRedirectResult({ server: previewServer, context });
        }
      }
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
        command: {
          command: "new_tab",
          args: url ? { url } : {},
        },
      });
      return browserToolResult({ payload, context });
    },
  );

  options.registerTool(
    "browser_snapshot",
    {
      title: "Snapshot browser page",
      description:
        "Return a model-readable snapshot of a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; refs come from the latest browser_snapshot of the same tab and expire when the page changes.",
      inputSchema: {
        browserId: BrowserAutomationBrowserIdSchema,
      },
    },
    async ({ browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "snapshot",
          args: {
            browserId,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_click",
    {
      title: "Click browser element",
      description:
        "Click an element in a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; refs come from the latest browser_snapshot of the same tab and expire when the page changes.",
      inputSchema: {
        ref: BrowserRefInputSchema,
        browserId: BrowserAutomationBrowserIdSchema,
        button: BrowserClickButtonInputSchema.optional(),
        doubleClick: z.boolean().optional(),
        modifiers: z.array(BrowserClickModifierInputSchema).optional(),
      },
    },
    async ({ ref, browserId, button, doubleClick, modifiers }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "click",
          args: {
            browserId,
            ref,
            button: button ?? "left",
            doubleClick: doubleClick ?? false,
            modifiers: modifiers ?? [],
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_fill",
    {
      title: "Fill browser element",
      description:
        "Fill an input-like element in a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; refs come from the latest browser_snapshot of the same tab and expire when the page changes.",
      inputSchema: {
        ref: BrowserRefInputSchema,
        value: z.string(),
        browserId: BrowserAutomationBrowserIdSchema,
      },
    },
    async ({ ref, value, browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "fill",
          args: {
            browserId,
            ref,
            value,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_wait",
    {
      title: "Wait for browser condition",
      description:
        "Wait until a Otto browser tab contains text or reaches a URL fragment. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; waits up to 5s by default on the browser host.",
      inputSchema: BrowserWaitInputSchema,
    },
    async ({ text, url, timeoutMs, browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        ...(timeoutMs ? { timeoutMs: timeoutMs + 1_000 } : {}),
        command: {
          command: "wait",
          args: {
            browserId,
            ...(text ? { text } : {}),
            ...(url ? { url } : {}),
            ...(timeoutMs ? { timeoutMs } : {}),
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_type",
    {
      title: "Type into browser",
      description:
        "Type text into an element, or into the focused element when ref is omitted. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; refs come from the latest browser_snapshot of the same tab and expire when the page changes.",
      inputSchema: {
        text: z.string(),
        ref: BrowserRefInputSchema.optional(),
        browserId: BrowserAutomationBrowserIdSchema,
      },
    },
    async ({ text, ref, browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "type",
          args: {
            browserId,
            ...(ref ? { ref } : {}),
            text,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_keypress",
    {
      title: "Press browser key",
      description:
        "Dispatch a keypress to an element, or to the focused element when ref is omitted. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; refs come from the latest browser_snapshot of the same tab and expire when the page changes.",
      inputSchema: {
        key: z.string().min(1),
        ref: BrowserRefInputSchema.optional(),
        browserId: BrowserAutomationBrowserIdSchema,
      },
    },
    async ({ key, ref, browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "keypress",
          args: {
            browserId,
            ...(ref ? { ref } : {}),
            key,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_navigate",
    {
      title: "Navigate browser",
      description:
        "Navigate a Otto browser tab to a URL. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; pass an http(s) URL or a scheme-less host URL, which is treated as http. " +
        "Dev server URLs can only be opened in the server's designated preview tab — the browserId returned by preview_start.",
      inputSchema: { url: BrowserHttpUrlInputSchema, browserId: BrowserAutomationBrowserIdSchema },
    },
    async ({ url, browserId }) => {
      const context = resolveBrowserToolContext(options);
      const previewServer = findPreviewServerForUrl({
        previewServers: options.previewServers,
        cwd: context.cwd,
        url,
      });
      if (previewServer && previewServer.boundBrowserId !== browserId) {
        return previewTabRedirectResult({
          server: previewServer,
          context: { ...context, browserId },
        });
      }
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "navigate",
          args: {
            browserId,
            url,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  for (const toolConfig of [
    {
      name: "browser_back",
      command: "back",
      title: "Browser back",
      description:
        "Go back in a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing.",
    },
    {
      name: "browser_forward",
      command: "forward",
      title: "Browser forward",
      description:
        "Go forward in a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing.",
    },
    {
      name: "browser_reload",
      command: "reload",
      title: "Browser reload",
      description:
        "Reload a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing.",
    },
  ] as const) {
    options.registerTool(
      toolConfig.name,
      {
        title: toolConfig.title,
        description: toolConfig.description,
        inputSchema: { browserId: BrowserAutomationBrowserIdSchema },
      },
      async ({ browserId }) => {
        const context = resolveBrowserToolContext(options);
        const payload = await options.broker.execute({
          agentId: context.agentId,
          cwd: context.cwd,
          ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

          command: {
            command: toolConfig.command,
            args: {
              browserId,
            },
          },
        });
        return browserToolResult({ payload, context: { ...context, browserId } });
      },
    );
  }

  options.registerTool(
    "browser_screenshot",
    {
      title: "Capture browser screenshot",
      description:
        "Capture a PNG screenshot of a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing. Set fullPage to true to capture the full page.",
      inputSchema: {
        browserId: BrowserAutomationBrowserIdSchema,
        fullPage: z.boolean().default(false),
      },
    },
    async ({ browserId, fullPage }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "screenshot",
          args: {
            browserId,
            fullPage: fullPage ?? false,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_upload",
    {
      title: "Upload files in browser",
      description:
        "Set workspace files on a file input in a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; refs come from the latest browser_snapshot of the same tab and expire when the page changes.",
      inputSchema: {
        ref: BrowserRefInputSchema,
        filePaths: z.array(z.string().min(1)).min(1),
        browserId: BrowserAutomationBrowserIdSchema,
      },
    },
    async ({ ref, filePaths, browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "upload",
          args: {
            browserId,
            ref,
            filePaths,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  for (const toolConfig of [
    {
      name: "browser_hover",
      command: "hover",
      title: "Hover browser element",
      description:
        "Hover an element in a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; refs come from the latest browser_snapshot of the same tab and expire when the page changes.",
    },
  ] as const) {
    options.registerTool(
      toolConfig.name,
      {
        title: toolConfig.title,
        description: toolConfig.description,
        inputSchema: { ref: BrowserRefInputSchema, browserId: BrowserAutomationBrowserIdSchema },
      },
      async ({ ref, browserId }) => {
        const context = resolveBrowserToolContext(options);
        const payload = await options.broker.execute({
          agentId: context.agentId,
          cwd: context.cwd,
          ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

          command: {
            command: toolConfig.command,
            args: {
              browserId,
              ref,
            },
          },
        });
        return browserToolResult({ payload, context: { ...context, browserId } });
      },
    );
  }

  options.registerTool(
    "browser_select",
    {
      title: "Select browser option",
      description:
        "Set a select element in a Otto browser tab to a value. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; refs come from the latest browser_snapshot of the same tab and expire when the page changes.",
      inputSchema: {
        ref: BrowserRefInputSchema,
        value: z.string(),
        browserId: BrowserAutomationBrowserIdSchema,
      },
    },
    async ({ ref, value, browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "select",
          args: {
            browserId,
            ref,
            value,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_drag",
    {
      title: "Drag browser element",
      description:
        "Drag one element onto another in a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; refs come from the latest browser_snapshot of the same tab and expire when the page changes.",
      inputSchema: {
        sourceRef: BrowserRefInputSchema,
        targetRef: BrowserRefInputSchema,
        browserId: BrowserAutomationBrowserIdSchema,
      },
    },
    async ({ sourceRef, targetRef, browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "drag",
          args: {
            browserId,
            sourceRef,
            targetRef,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_logs",
    {
      title: "Read browser logs",
      description:
        "Read recent console messages and browser performance network entries for a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; maxEntries defaults to 50.",
      inputSchema: {
        maxEntries: z.number().int().positive().max(200).optional(),
        browserId: BrowserAutomationBrowserIdSchema,
      },
    },
    async ({ maxEntries, browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "logs",
          args: {
            browserId,
            maxEntries: maxEntries ?? 50,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_inspect",
    {
      title: "Inspect browser element",
      description:
        "Inspect a DOM element in a Otto browser tab by CSS selector or snapshot ref. Returns tag/id/class, text content, bounding box, and computed styles. " +
        "BEST tool for verifying visual properties like colors, fonts, spacing, and dimensions — more accurate than screenshots. " +
        "Pass styles to select which CSS properties to return; defaults to common layout and typography properties. Use browserId from preview_start, browser_new_tab, or browser_list_tabs.",
      inputSchema: {
        browserId: BrowserAutomationBrowserIdSchema,
        selector: z
          .string()
          .min(1)
          .optional()
          .describe("CSS selector (e.g., '.button', '#header'); the first match is inspected"),
        ref: BrowserRefInputSchema.optional().describe(
          "Element ref from the latest browser_snapshot (alternative to selector)",
        ),
        styles: z
          .array(z.string().min(1))
          .max(50)
          .optional()
          .describe("CSS properties to return (e.g., ['padding', 'color'])"),
      },
    },
    async ({
      browserId,
      selector,
      ref,
      styles,
    }: {
      browserId: string;
      selector?: string;
      ref?: string;
      styles?: string[];
    }) => {
      if (Number(Boolean(selector)) + Number(Boolean(ref)) !== 1) {
        return browserToolResult({
          payload: {
            requestId: "browser-tools-inspect-target",
            ok: false,
            error: {
              code: "browser_denied",
              message: "browser_inspect requires exactly one of selector or ref",
              retryable: false,
            },
          },
          context: resolveBrowserToolContext(options),
        });
      }
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "inspect",
          args: {
            browserId,
            ...(selector ? { selector } : {}),
            ...(ref ? { ref } : {}),
            ...(styles && styles.length > 0 ? { styles } : {}),
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_network",
    {
      title: "Inspect browser network traffic",
      description:
        "List captured network requests in a Otto browser tab, or fetch a specific response body. " +
        "Without requestId, lists requests with method, URL, status, and requestId. With requestId, returns that request's full response body (useful for inspecting API payloads). " +
        "Capture starts on the first call for a tab — reload the page (browser_reload) after the first call to record its traffic. " +
        "Use filter 'failed' to show only 4xx/5xx and network errors. Use browserId from preview_start, browser_new_tab, or browser_list_tabs.",
      inputSchema: {
        browserId: BrowserAutomationBrowserIdSchema,
        filter: z
          .enum(["all", "failed"])
          .optional()
          .describe("Filter: 'all' (default) or 'failed' (4xx/5xx and network errors)"),
        requestId: z
          .string()
          .min(1)
          .optional()
          .describe(
            "If provided, returns the response body for this captured request instead of listing",
          ),
      },
    },
    async ({
      browserId,
      filter,
      requestId,
    }: {
      browserId: string;
      filter?: "all" | "failed";
      requestId?: string;
    }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "network",
          args: {
            browserId,
            filter: filter ?? "all",
            ...(requestId ? { requestId } : {}),
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_evaluate",
    {
      title: "Evaluate browser JavaScript",
      description:
        "Evaluate a JavaScript function in a Otto browser tab. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; when ref is provided, refs come from the latest browser_snapshot and the resolved element is passed as the first argument.",
      inputSchema: {
        function: z.string().min(1),
        ref: BrowserRefInputSchema.optional(),
        browserId: BrowserAutomationBrowserIdSchema,
      },
    },
    async ({ function: functionSource, ref, browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "evaluate",
          args: {
            browserId,
            function: functionSource,
            ...(ref ? { ref } : {}),
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_scroll",
    {
      title: "Scroll browser",
      description:
        "Scroll a Otto browser tab by deltaX/deltaY CSS pixels. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing; optional ref comes from the latest browser_snapshot and centers the wheel input over that element.",
      inputSchema: {
        browserId: BrowserAutomationBrowserIdSchema,
        ref: BrowserRefInputSchema.optional(),
        deltaX: z.number(),
        deltaY: z.number(),
      },
    },
    async ({ browserId, ref, deltaX, deltaY }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "scroll",
          args: {
            browserId,
            ...(ref ? { ref } : {}),
            deltaX,
            deltaY,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_resize",
    {
      title: "Resize browser viewport",
      description:
        "Resize a Otto browser tab's resident webview viewport. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing.",
      inputSchema: {
        browserId: BrowserAutomationBrowserIdSchema,
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      },
    },
    async ({ browserId, width, height }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "resize",
          args: {
            browserId,
            width,
            height,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );

  options.registerTool(
    "browser_close_tab",
    {
      title: "Close browser tab",
      description:
        "Close a Otto browser tab, remove its resident webview, and unregister it from the browser automation host. Use browserId from preview_start when verifying a dev server, or from browser_new_tab / browser_list_tabs for general browsing.",
      inputSchema: {
        browserId: BrowserAutomationBrowserIdSchema,
      },
    },
    async ({ browserId }) => {
      const context = resolveBrowserToolContext(options);
      const payload = await options.broker.execute({
        agentId: context.agentId,
        cwd: context.cwd,
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),

        command: {
          command: "close_tab",
          args: {
            browserId,
          },
        },
      });
      return browserToolResult({ payload, context: { ...context, browserId } });
    },
  );
}

function resolveBrowserToolContext(options: RegisterBrowserToolsOptions): {
  agentId?: string;
  cwd?: string;
  workspaceId?: string;
} {
  const callerAgent = options.resolveCallerAgent();
  return {
    ...(options.callerAgentId ? { agentId: options.callerAgentId } : {}),
    ...(callerAgent?.cwd ? { cwd: callerAgent.cwd } : {}),
    ...(callerAgent?.workspaceId ? { workspaceId: callerAgent.workspaceId } : {}),
  };
}

function normalizeHttpUrlInput(value: string): string | null {
  if (value.length === 0) {
    return null;
  }

  const explicitHttpUrl = /^https?:\/\//i.test(value);
  if (explicitHttpUrl) {
    return isValidHttpUrl(value) ? value : null;
  }

  if (URL_WHITESPACE_PATTERN.test(value) || NON_HTTP_EXPLICIT_SCHEME_PATTERN.test(value)) {
    return null;
  }

  const normalized = `http://${value}`;
  return isValidHttpUrl(normalized) ? normalized : null;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function requireWorkspaceContext(context: {
  agentId?: string;
  cwd?: string;
  workspaceId?: string;
}): OttoToolResult | null {
  if (context.workspaceId) {
    return null;
  }

  return browserToolResult({
    payload: {
      requestId: "browser-tools-workspace-context",
      ok: false,
      error: {
        code: "browser_denied",
        message: WORKSPACE_CONTEXT_MESSAGE,
        retryable: false,
      },
    },
    context,
  });
}

function browserToolResult(params: {
  payload: BrowserToolsResponsePayload;
  context: { agentId?: string; cwd?: string; workspaceId?: string; browserId?: string };
}): OttoToolResult {
  const { payload, context } = params;
  if (payload.ok) {
    return {
      content: browserToolSuccessContent(payload),
      structuredContent: {
        ok: true,
        result: browserToolStructuredResult(payload.result),
        ...(payload.dialogs ? { dialogs: payload.dialogs } : {}),
        context,
      },
    };
  }

  return {
    content: [
      {
        type: "text",
        text: appendDialogSummary(summarizeBrowserError(payload.error), payload.dialogs),
      },
    ],
    structuredContent: {
      ok: false,
      error: payload.error,
      ...(payload.dialogs ? { dialogs: payload.dialogs } : {}),
      context,
    },
  };
}

function browserToolStructuredResult(
  result: Extract<BrowserToolsResponsePayload, { ok: true }>["result"],
): Extract<BrowserToolsResponsePayload, { ok: true }>["result"] | Record<string, unknown> {
  if (result.command !== "screenshot") {
    return result;
  }

  const { dataBase64: _dataBase64, ...metadata } = result;
  return metadata;
}

function browserToolSuccessContent(
  payload: Extract<BrowserToolsResponsePayload, { ok: true }>,
): OttoToolResult["content"] {
  const textContent = { type: "text" as const, text: summarizeBrowserSuccess(payload) };
  const imageContent = browserToolImageContent(payload.result);
  return imageContent ? [textContent, imageContent] : [textContent];
}

function browserToolImageContent(
  result: Extract<BrowserToolsResponsePayload, { ok: true }>["result"],
): OttoToolResult["content"][number] | null {
  if (result.command !== "screenshot") {
    return null;
  }

  return {
    type: "image",
    data: result.dataBase64,
    mimeType: result.mimeType,
  };
}

function summarizeBrowserSuccess(
  payload: Extract<BrowserToolsResponsePayload, { ok: true }>,
): string {
  const withDialogs = (summary: string) => appendDialogSummary(summary, payload.dialogs);
  const controlSummary = summarizeBrowserControlSuccess(payload.result);
  if (controlSummary) {
    return withDialogs(controlSummary);
  }

  const refActionSummary = summarizeBrowserRefActionSuccess(payload.result);
  if (refActionSummary) {
    return withDialogs(refActionSummary);
  }

  const diagnosticsSummary = summarizeBrowserDiagnosticsSuccess(payload.result);
  if (diagnosticsSummary) {
    return withDialogs(diagnosticsSummary);
  }

  const keyboardSummary = summarizeBrowserKeyboardSuccess(payload.result);
  if (keyboardSummary) {
    return withDialogs(keyboardSummary);
  }

  const navigationSummary = summarizeBrowserNavigationSuccess(payload.result);
  if (navigationSummary) {
    return withDialogs(navigationSummary);
  }

  const mediaSummary = summarizeBrowserMediaSuccess(payload.result);
  if (mediaSummary) {
    return withDialogs(mediaSummary);
  }

  if (payload.result.command === "list_tabs") {
    const count = payload.result.tabs.length;
    if (count === 0) {
      return "No Otto browser tabs are open. Call browser_new_tab to create one.";
    }
    const tabLines = payload.result.tabs.map((tab) => {
      const active = tab.isActive ? " active" : "";
      return `- browserId=${tab.browserId}${active} title=${JSON.stringify(tab.title || "Untitled")} url=${tab.url}`;
    });
    return withDialogs(
      [
        `Found ${count} Otto browser tab${count === 1 ? "" : "s"}. Use these browserId values for tab-scoped browser tools.`,
        ...tabLines,
      ].join("\n"),
    );
  }

  if (payload.result.command === "new_tab") {
    return withDialogs(
      `Created browser tab browserId=${payload.result.browserId} url=${payload.result.url}. Use this browserId for tab-scoped browser tools.`,
    );
  }

  if (payload.result.command === "snapshot") {
    return withDialogs(
      [
        `Snapshot captured ${payload.result.stats.nodeCount} node${payload.result.stats.nodeCount === 1 ? "" : "s"} with ${payload.result.stats.refCount} ref${payload.result.stats.refCount === 1 ? "" : "s"}.`,
        `Title: ${payload.result.title || "Untitled"}`,
        `URL: ${payload.result.url}`,
        "",
        payload.result.snapshot,
      ].join("\n"),
    );
  }

  if (payload.result.command === "wait") {
    return withDialogs(`Browser wait matched ${payload.result.matched}.`);
  }

  return withDialogs(`Browser ${payload.result.command} complete.`);
}

function appendDialogSummary(
  summary: string,
  dialogs: BrowserToolsResponsePayload["dialogs"],
): string {
  if (!dialogs || dialogs.length === 0) {
    return summary;
  }
  return `${summary}\nHandled browser dialog${dialogs.length === 1 ? "" : "s"}: ${dialogs
    .map((dialog) => `${dialog.action} ${dialog.type} ${JSON.stringify(dialog.message)}`)
    .join("; ")}.`;
}

function summarizeBrowserMediaSuccess(
  result: Extract<BrowserToolsResponsePayload, { ok: true }>["result"],
): string | null {
  if (result.command === "screenshot") {
    return `Captured browser screenshot (${result.width}x${result.height}).`;
  }
  if (result.command === "upload") {
    const count = result.filePaths.length;
    return `Uploaded ${count} file${count === 1 ? "" : "s"} to browser element ${result.ref}.`;
  }
  return null;
}

function summarizeBrowserKeyboardSuccess(
  result: Extract<BrowserToolsResponsePayload, { ok: true }>["result"],
): string | null {
  if (result.command === "type") {
    return result.ref
      ? `Typed into browser element ${result.ref}.`
      : "Typed into the focused browser element.";
  }

  if (result.command === "keypress") {
    return result.ref
      ? `Pressed ${result.key} on browser element ${result.ref}.`
      : `Pressed ${result.key} in the browser.`;
  }

  return null;
}

function summarizeBrowserNavigationSuccess(
  result: Extract<BrowserToolsResponsePayload, { ok: true }>["result"],
): string | null {
  if (result.command === "navigate") {
    return `Navigated browser to ${result.url}.`;
  }

  if (result.command === "back" || result.command === "forward" || result.command === "reload") {
    return `Browser ${result.command} complete.`;
  }

  return null;
}

function summarizeBrowserDiagnosticsSuccess(
  result: Extract<BrowserToolsResponsePayload, { ok: true }>["result"],
): string | null {
  if (result.command === "evaluate") {
    return [
      "Browser evaluate returned:",
      result.resultJson,
      ...(result.truncated ? ["Result was truncated."] : []),
    ].join("\n");
  }

  if (result.command !== "logs") {
    return null;
  }

  const consoleCount = result.console.length;
  const networkCount = result.network.length;
  return `Read ${consoleCount} console log${consoleCount === 1 ? "" : "s"} and ${networkCount} network entr${networkCount === 1 ? "y" : "ies"}.`;
}

function summarizeBrowserRefActionSuccess(
  result: Extract<BrowserToolsResponsePayload, { ok: true }>["result"],
): string | null {
  if (result.command === "click") {
    return `Clicked browser element ${result.ref}.`;
  }

  if (result.command === "fill") {
    return `Filled browser element ${result.ref}.`;
  }

  return null;
}

function summarizeBrowserControlSuccess(
  result: Extract<BrowserToolsResponsePayload, { ok: true }>["result"],
): string | null {
  if (result.command === "select") {
    return `Selected ${result.value} in browser element ${result.ref}.`;
  }

  if (result.command === "hover") {
    return `Hovered browser element ${result.ref}.`;
  }

  if (result.command === "drag") {
    return `Dragged browser element ${result.sourceRef} to ${result.targetRef}.`;
  }

  if (result.command === "scroll") {
    return result.ref
      ? `Scrolled browser element ${result.ref} by ${result.deltaX}, ${result.deltaY}.`
      : `Scrolled browser by ${result.deltaX}, ${result.deltaY}.`;
  }

  if (result.command === "resize") {
    return `Resized browser viewport to ${result.width}x${result.height}.`;
  }

  if (result.command === "close_tab") {
    return `Closed browser tab ${result.browserId}.`;
  }

  return null;
}

function summarizeBrowserError(
  error: Extract<BrowserToolsResponsePayload, { ok: false }>["error"],
): string {
  switch (error.code) {
    case "browser_disabled":
      return "Browser tools are disabled. Enable browser tools on the host, then try again.";
    case "browser_no_host":
      return error.message;
    case "browser_timeout":
      return "The browser did not respond before the timeout. Try again or check the browser host.";
    case "screenshot_no_frame":
      return error.message;
    case "browser_unsupported":
      return error.message;
    case "browser_stale_ref":
      return "That browser element reference is stale. Take a new browser snapshot and try again.";
    default:
      return error.message;
  }
}
