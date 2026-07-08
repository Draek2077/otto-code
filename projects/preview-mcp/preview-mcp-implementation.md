# Claude Preview MCP Server — Reverse-Engineering & Rebuild Notes

> Compiled 2026-07-03 from a Claude Code session inspecting the built-in `Claude_Preview`
> MCP server. Purpose: enough detail to rebuild an equivalent preview/verification
> subsystem in your own AI coding-agent software.
>
> **Epistemic status:** The tool names, descriptions, and JSON schemas in §3 are
> **verbatim fact** (read directly from the tool definitions the agent holds).
> The MCP wire format in §2 is **spec fact**. The per-tool implementation mechanics
> in §4 are **high-confidence inference** — these tools map onto a small, standard
> set of browser-automation primitives (Chrome DevTools Protocol / Playwright), and
> any competent implementation looks substantially like what is described. Anthropic's
> actual source was not read.

---

## 1. What it is

`Claude_Preview` is a **built-in MCP server bundled with the Claude Code app**
(desktop/web client) — not user-configured, not in the repo. It backs the visual
"preview window" panel and exposes 13 tools (`preview_*`) that let the agent run a
dev server and verify browser-rendered changes without leaving the chat.

It is really **two subsystems behind one MCP façade**:

```
┌─────────────────────────────────────────────────────────────┐
│  Agent (LLM)                                                 │
│    │  JSON-RPC 2.0  (tools/list, tools/call)                 │
│    ▼                                                         │
│  MCP Server process  "Claude_Preview"                        │
│   ┌────────────────────────┐   ┌──────────────────────────┐ │
│   │ A. Dev-server manager   │   │ B. Browser controller     │ │
│   │  - spawn child procs    │   │  - launches Chromium      │ │
│   │  - track by serverId    │   │  - one page/tab           │ │
│   │  - ring-buffer stdout   │   │  - CDP or Playwright      │ │
│   │  - port health checks   │   │  - nav to server URL      │ │
│   └───────────┬────────────┘   └────────────┬─────────────┘ │
└───────────────┼──────────────────────────────┼───────────────┘
                ▼                              ▼
        your dev server (npm run dev)   embedded Chromium → renders it
        e.g. 127.0.0.1:8202             (this is the "preview window")
```

- **A. Dev-server manager** — pure process supervision. `preview_start` reads
  `.claude/launch.json`, spawns the configured command, assigns a `serverId`, and
  captures stdout/stderr into a bounded buffer. `preview_logs` reads that buffer;
  `preview_stop` kills the process tree; `preview_list` enumerates live servers.
- **B. Browser controller** — an automation session over a Chromium instance.
  Everything that reads or manipulates the _page_ (`snapshot`, `inspect`, `click`,
  `fill`, `eval`, `network`, `console_logs`, `screenshot`, `resize`) is this half.
  The visible preview panel is this browser's viewport.

The two halves are joined by `serverId`: a page tool uses it to find which browser
session is pointed at which dev server.

**Tool split at a glance:**

| Category                     | Tools                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Server lifecycle             | `preview_start`, `preview_stop`, `preview_list`, `preview_logs`                  |
| Read page state (text-first) | `preview_snapshot`, `preview_inspect`, `preview_console_logs`, `preview_network` |
| Interact                     | `preview_click`, `preview_fill`, `preview_eval`                                  |
| Verification helpers         | `preview_resize`, `preview_screenshot`                                           |

**Observed behavioral properties** (from live use in Claude Code):

- **Per-session** — the Preview MCP will not attach to a server another chat session
  started; each session gets its own instance/port (e.g. 8202, 8203, …).
- **One page at a time** — the preview window shows whatever URL the controlled
  browser is pointed at. In a git worktree, it still serves the **main checkout**
  unless you hand-start the worktree's server on an alt port and navigate to it.
- **Context cost** — the 13 tool definitions cost roughly 3,200 tokens of context
  (per-tool description token counts observed: start 355, network 341, resize 338,
  logs 326, eval 303, inspect 292, console_logs 266, click 203, fill 202,
  screenshot 199, snapshot 187, stop 122, list 98).

---

## 2. The MCP wire layer

MCP is **JSON-RPC 2.0**, typically over stdio (newline-delimited JSON) or SSE/HTTP.
Two methods matter here:

### `tools/list`

The server returns an array of tool descriptors. Note MCP names the schema field
**`inputSchema`** (the agent-side rendering calls it `parameters`, but on the wire
it is `inputSchema`):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "preview_inspect",
        "description": "Inspect a DOM element by CSS selector. ...",
        "inputSchema": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "serverId": { "type": "string", "description": "Server ID" },
            "selector": {
              "type": "string",
              "description": "CSS selector (e.g., '.button', '#header')"
            },
            "styles": {
              "type": "array",
              "items": { "type": "string" },
              "description": "CSS properties to return..."
            }
          },
          "required": ["serverId", "selector"]
        }
      }
    ]
  }
}
```

The `mcp__Claude_Preview__` prefix seen in the agent's tool list is added by the
**client** (namespacing `mcp__<server>__<tool>`), not advertised by the server.
The server just calls the tool `preview_inspect`.

### `tools/call`

Client sends:

```json
{ "name": "preview_inspect", "arguments": { "serverId": "...", "selector": ".btn" } }
```

Server replies with a **content array**:

```json
{
  "result": {
    "content": [
      { "type": "text", "text": "{ \"tagName\": \"BUTTON\", \"color\": \"rgb(...)\", ... }" }
    ],
    "isError": false
  }
}
```

Screenshots come back as an **image content block** — this is why the agent can
literally "see" the screenshot:

```json
{ "content": [{ "type": "image", "data": "<base64 JPEG>", "mimeType": "image/jpeg" }] }
```

Errors should be **returned** (with `isError: true`), not thrown, so the agent can
read the failure text and adapt.

---

## 3. Full verbatim tool JSON (all 13 tools)

These are the exact `name` / `description` / schema definitions as held by the
agent. (Field named `parameters` here as the client renders it; on the MCP wire it
is `inputSchema`. Strip the `mcp__Claude_Preview__` prefix for the server-side name.)

```json
[
  {
    "name": "mcp__Claude_Preview__preview_start",
    "description": "Start a dev server by name from .claude/launch.json. If .claude/launch.json doesn't exist, create it first with this format:\n{\n  \"version\": \"0.0.1\",\n  \"configurations\": [\n    {\n      \"name\": \"<unique-name>\",\n      \"runtimeExecutable\": \"<command>\",\n      \"runtimeArgs\": [\"<args>\"],\n      \"port\": <port>\n    }\n  ]\n}\nSet \"runtimeExecutable\" to the command (e.g. \"npm\"), \"runtimeArgs\" to the arguments (e.g. [\"run\", \"dev\"]), and \"port\" to the server port. Only include servers you actually need to preview. Reuses the server if already running. ALWAYS use this instead of Bash for running servers.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "name": { "description": "Server name from .claude/launch.json.", "type": "string" }
      },
      "required": ["name"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_stop",
    "description": "Stop a server started with preview_start.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "serverId": { "description": "Server ID to stop", "type": "string" }
      },
      "required": ["serverId"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_list",
    "description": "List servers started with preview_start. Returns serverIds for use with other preview_* tools.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "properties": {},
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_logs",
    "description": "Get server stdout/stderr output. Use to check for build errors, verify server behavior, or read debug output. Use 'level' to filter to errors only, or 'search' to filter for specific text. Use after preview_start.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "level": {
          "description": "Filter by level: 'all' (default) shows all output, 'error' shows only lines containing error/exception/failed/fatal",
          "enum": ["all", "error"],
          "type": "string"
        },
        "lines": { "description": "Max lines to return (default: 50)", "type": "number" },
        "search": {
          "description": "Filter to lines containing this text (e.g., '[DEBUG]', 'POST /api')",
          "type": "string"
        },
        "serverId": { "description": "Server ID", "type": "string" }
      },
      "required": ["serverId"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_console_logs",
    "description": "Get browser console output (log, info, warn, error, debug). Use to check runtime behavior, debug values, or client-side errors. Use 'level' to filter to errors or warnings only.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "level": {
          "description": "Filter by level: 'all' (default), 'error' (errors only), 'warn' (warnings + errors)",
          "enum": ["all", "error", "warn"],
          "type": "string"
        },
        "lines": { "description": "Max lines to return (default: 50, max: 200)", "type": "number" },
        "serverId": { "description": "Server ID", "type": "string" }
      },
      "required": ["serverId"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_network",
    "description": "List network requests or inspect a specific response body. Without requestId, lists all requests with URL, method, status, and requestId. With requestId, returns the full response body for that request (useful for inspecting API payloads).",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "filter": {
          "description": "Filter: 'all' (default) shows all requests, 'failed' shows only 4xx/5xx and network errors. Ignored when requestId is provided.",
          "enum": ["all", "failed"],
          "type": "string"
        },
        "requestId": {
          "description": "If provided, returns the response body for this specific request instead of listing all requests. Get requestIds from the listing output.",
          "type": "string"
        },
        "serverId": { "description": "Server ID", "type": "string" }
      },
      "required": ["serverId"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_snapshot",
    "description": "Get an accessibility tree snapshot of the page. Returns exact text content, roles, and element UIDs for use with click/fill/hover. PREFERRED over screenshot for verifying text, element presence, and page structure.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "serverId": { "description": "Server ID", "type": "string" }
      },
      "required": ["serverId"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_inspect",
    "description": "Inspect a DOM element by CSS selector. Returns text content, className, tagName, id, computed styles, and bounding box. BEST tool for verifying visual properties like colors, fonts, spacing, and dimensions — more accurate than screenshots.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "selector": {
          "description": "CSS selector (e.g., '.button', '#header')",
          "type": "string"
        },
        "serverId": { "description": "Server ID", "type": "string" },
        "styles": {
          "description": "CSS properties to return (e.g., ['padding', 'color']). Defaults to common properties.",
          "items": { "type": "string" },
          "type": "array"
        }
      },
      "required": ["serverId", "selector"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_click",
    "description": "Click an element by CSS selector (e.g., 'button.primary', '#submit', '[data-testid=\"btn\"]').",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "doubleClick": { "description": "Perform a double-click", "type": "boolean" },
        "selector": { "description": "CSS selector for the element to click", "type": "string" },
        "serverId": { "description": "Server ID", "type": "string" }
      },
      "required": ["serverId", "selector"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_fill",
    "description": "Fill an input, textarea, or select element with a value. For select elements, matches by value or text.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "selector": { "description": "CSS selector for the input element", "type": "string" },
        "serverId": { "description": "Server ID", "type": "string" },
        "value": { "description": "Value to fill", "type": "string" }
      },
      "required": ["serverId", "selector", "value"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_eval",
    "description": "Execute JavaScript in the preview page for DEBUGGING and INSPECTION only. Use for reading page state, DOM queries, checking variables, navigation, page reload, hover/type/key events. Do NOT use this to implement UI changes the user requests — edit the source code instead. Any DOM modifications via eval are temporary and lost on reload. Wrap multi-step logic in an IIFE.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "expression": {
          "description": "JavaScript expression to evaluate in the page context. Return values are serialized as JSON.",
          "type": "string"
        },
        "serverId": { "description": "Server ID", "type": "string" }
      },
      "required": ["serverId", "expression"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_resize",
    "description": "Resize the preview viewport to test responsive layouts. Presets: mobile (375x812), tablet (768x1024), desktop (1280x800). Also supports custom dimensions and color scheme emulation for dark mode testing.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "colorScheme": {
          "description": "Emulate prefers-color-scheme media feature for dark/light mode testing.",
          "enum": ["light", "dark"],
          "type": "string"
        },
        "height": { "description": "Viewport height in pixels", "type": "number" },
        "preset": {
          "description": "Device preset. Overrides width/height if provided.",
          "enum": ["mobile", "tablet", "desktop"],
          "type": "string"
        },
        "serverId": { "description": "Server ID", "type": "string" },
        "width": { "description": "Viewport width in pixels", "type": "number" }
      },
      "required": ["serverId"],
      "type": "object"
    }
  },
  {
    "name": "mcp__Claude_Preview__preview_screenshot",
    "description": "Take a screenshot of the page. Good for checking layout and general appearance, but DO NOT rely on it for verifying colors, font sizes, or precise styles — use preview_inspect with specific CSS properties instead. Returns a compressed JPEG image.",
    "parameters": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "additionalProperties": false,
      "properties": {
        "serverId": { "description": "Server ID", "type": "string" }
      },
      "required": ["serverId"],
      "type": "object"
    }
  }
]
```

Notes:

- `preview_list` is the only tool with no required `serverId` — it is how server IDs
  are discovered in the first place.
- All schemas are JSON Schema draft-07 with `additionalProperties: false` (strict).

---

## 4. How each tool is (almost certainly) implemented

Mapping each tool to its underlying browser-automation primitive. **CDP** = Chrome
DevTools Protocol domain; Playwright wraps these same calls.

| Tool                   | Underlying mechanism (inferred)                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview_start`        | `child_process.spawn(cmd, args)`; store `{serverId, pid, port, buffer}`. Poll the port (`net.connect`) until it accepts, or watch stdout for a ready line. "Reuses the server if already running" = registry lookup by name first.                                                                                                                                                                 |
| `preview_stop`         | Kill the process **tree** (Windows: `taskkill /PID <pid> /T /F`; POSIX: detached process group + `process.kill(-pid)`) — dev servers spawn children.                                                                                                                                                                                                                                               |
| `preview_list`         | Return the in-memory registry of live servers + ports/status.                                                                                                                                                                                                                                                                                                                                      |
| `preview_logs`         | Read the captured stdout/stderr **ring buffer**; `level`/`search`/`lines` are post-filters over stored lines (note `level: error` is a keyword grep for error/exception/failed/fatal per its own description).                                                                                                                                                                                     |
| `preview_console_logs` | Subscribe to CDP `Runtime.consoleAPICalled` + `Runtime.exceptionThrown` (Playwright: `page.on('console')` / `page.on('pageerror')`), buffer, return filtered.                                                                                                                                                                                                                                      |
| `preview_network`      | Enable CDP `Network` domain; record `Network.requestWillBeSent` / `responseReceived` / `loadingFinished` into a table. Listing = the table; `requestId` lookup = `Network.getResponseBody`. The list/body split is a deliberate token-budget design.                                                                                                                                               |
| `preview_snapshot`     | Accessibility tree via CDP `Accessibility.getFullAXTree` (or `page.accessibility.snapshot()`). The **"element UIDs"** are the key trick: assign each node a stable ref (e.g. `e17`) and keep a **ref→element map** so later click/fill can resolve a UID back to a live node. This is exactly how the official **Playwright MCP** server works (it injects `aria-ref` attributes during snapshot). |
| `preview_inspect`      | `page.evaluate` running `getComputedStyle(el)` + `el.getBoundingClientRect()` + `tagName/className/id/textContent` for the matched selector. `styles[]` filters which computed properties come back; a default set covers common props.                                                                                                                                                            |
| `preview_click`        | Resolve selector → element, scroll into view, dispatch a real trusted click: Playwright `locator.click()`, or CDP `Input.dispatchMouseEvent` (mousePressed/mouseReleased) at the element's center. `doubleClick` → clickCount 2.                                                                                                                                                                   |
| `preview_fill`         | Focus element, clear, set value + fire `input`/`change` events (Playwright `locator.fill()`). For `<select>`, match option by value or visible text.                                                                                                                                                                                                                                               |
| `preview_eval`         | `page.evaluate(expression)` — runs JS in page context, **JSON-serializes the return value**. General-purpose escape hatch: reload, hover, keypress, scroll are all routed through it rather than getting dedicated tools.                                                                                                                                                                          |
| `preview_resize`       | CDP `Emulation.setDeviceMetricsOverride` (width/height/deviceScaleFactor) for viewport; `Emulation.setEmulatedMedia({features:[{name:'prefers-color-scheme', value:'dark'}]})` for `colorScheme` (Playwright: `page.setViewportSize` + `page.emulateMedia`). Presets are named W×H pairs: mobile 375×812, tablet 768×1024, desktop 1280×800.                                                       |
| `preview_screenshot`   | CDP `Page.captureScreenshot({format:'jpeg', quality:…})`; return base64 as an MCP image content block. **JPEG, not PNG**, to keep the payload token-cheap.                                                                                                                                                                                                                                         |

### Design tells worth copying

1. **Accessibility-snapshot-with-refs over selectors-by-guesswork.** `snapshot`
   gives the agent structured text _plus_ stable handles, which is more robust than
   pixel-based interaction and far cheaper than screenshots. The description
   literally steers: "PREFERRED over screenshot."
2. **`eval` is walled off as debug-only** _in its own description_ ("Do NOT use this
   to implement UI changes… lost on reload"). A prompt-level guardrail baked into
   the schema so the agent edits source files instead of "fixing" the DOM.
3. **`screenshot` self-deprecates for precision work** ("DO NOT rely on it for
   verifying colors, font sizes…") and points at `inspect`. Descriptions as agent
   steering, not just API docs.
4. **Config-file-driven launch** (`.claude/launch.json`) with the file format
   embedded in the tool description, including instructions to create the file if
   missing. The tool teaches the agent how to bootstrap itself.
5. **Everything keyed by `serverId`** so multiple servers/sessions can coexist.

### The prescribed agent workflow (from the harness system prompt)

The client also injects usage policy around these tools — worth replicating in your
own agent's system prompt:

1. Only verify when the change is **observable in the browser preview** (skip for
   other runtimes, tests, types, tooling).
2. Ensure a server is running (`preview_start` if needed).
3. Reload if needed (`preview_eval`: `window.location.reload()`); skip if HMR.
4. Check `preview_console_logs` / `preview_logs` / `preview_network` for errors.
5. `preview_snapshot` for content and structure.
6. `preview_inspect` for CSS values.
7. `preview_click` / `preview_fill` to test interactions, then snapshot to confirm.
8. `preview_resize` for responsive / dark mode.
9. If issues found: read source → edit source → re-check (eval is debugging only).
10. Share **proof** with the user (`preview_screenshot` for visual, `preview_network`
    for API, `preview_logs` for server changes). Never ask the user to check manually.

---

## 5. Rebuild blueprint (TypeScript + MCP SDK + Playwright)

Shortest path: **TypeScript + `@modelcontextprotocol/sdk` + Playwright**. Raw CDP
works too but you'd reimplement much of Playwright.

### 5a. Skeleton

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium, Browser, Page } from "playwright";
import { spawn, ChildProcess } from "node:child_process";

interface Dev {
  id: string;
  proc: ChildProcess;
  port: number;
  log: string[];
}
const servers = new Map<string, Dev>();

let browser: Browser | null = null;
let page: Page | null = null;
const consoleBuf: string[] = [];
const netBuf: { id: string; url: string; method: string; status?: number }[] = [];

const server = new Server(
  { name: "my-preview", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
```

### 5b. Advertise tools (`tools/list`)

```ts
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "preview_start",
      description: "Start a dev server by name from launch.json ...",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
    },
    // ...one entry per tool; copy the schemas from §3 (rename parameters → inputSchema)
  ],
}));
```

### 5c. Dev-server manager (subsystem A)

```ts
async function startServer(name: string) {
  const cfg = readLaunchJson().configurations.find((c) => c.name === name);
  const proc = spawn(cfg.runtimeExecutable, cfg.runtimeArgs, { shell: true });
  const id = `srv_${servers.size + 1}`;
  const dev: Dev = { id, proc, port: cfg.port, log: [] };
  const cap = (b: Buffer) => {
    // bounded ring buffer
    dev.log.push(...b.toString().split("\n"));
    if (dev.log.length > 2000) dev.log.splice(0, dev.log.length - 2000);
  };
  proc.stdout.on("data", cap);
  proc.stderr.on("data", cap);
  servers.set(id, dev);
  await waitForPort(cfg.port); // net.connect retry loop
  return { serverId: id, port: cfg.port };
}
```

Correctness details people get wrong:

- **Kill the whole process tree.** `proc.kill()` orphans children. Windows:
  `taskkill /PID <pid> /T /F`; POSIX: spawn `detached: true` and `process.kill(-pid)`.
- **Bounded log buffer** so a chatty server doesn't OOM the MCP process.
- **Readiness detection** — poll the TCP port or regex stdout (`/Local:.*http/`).
  Returning before the server binds produces flaky first navigations.
- **Reuse-if-running** — check the registry (and/or the port) before spawning a
  duplicate.

### 5d. Browser controller (subsystem B)

```ts
async function ensurePage(port: number) {
  if (!browser) browser = await chromium.launch({ headless: true });
  if (!page) {
    page = await browser.newPage();
    page.on("console", (m) => push(consoleBuf, `[${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => push(consoleBuf, `[error] ${e.message}`));
    page.on("request", (r) => netBuf.push({ id: rid(r), url: r.url(), method: r.method() }));
    page.on("response", (r) => {
      const e = netBuf.find((x) => x.url === r.url());
      if (e) e.status = r.status();
    });
  }
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  return page;
}
```

Page tools are thin wrappers:

```ts
// preview_inspect
const data = await page.$eval(
  sel,
  (el, props) => {
    const cs = getComputedStyle(el),
      r = el.getBoundingClientRect();
    const out: any = {
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      text: el.textContent?.slice(0, 200),
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
    for (const p of props) out[p] = cs.getPropertyValue(p);
    return out;
  },
  styles ?? ["color", "background-color", "font-size", "padding", "margin", "display"],
);

// preview_click / preview_fill
await page.locator(sel).click({ clickCount: doubleClick ? 2 : 1 });
await page.locator(sel).fill(value);

// preview_eval
const result = await page.evaluate((expr) => eval(expr), expression);

// preview_resize
await page.setViewportSize({ width, height });
if (colorScheme) await page.emulateMedia({ colorScheme });

// preview_screenshot → image content block
const buf = await page.screenshot({ type: "jpeg", quality: 60 });
return { content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/jpeg" }] };
```

### 5e. Accessibility snapshot + ref map (the clever bit)

```ts
// Assign a stable UID to each node and remember how to resolve it later.
const refs = new Map<string, ElementHandle>();
async function snapshot() {
  const ax = await page.accessibility.snapshot({ interestingOnly: true });
  let n = 0;
  const walk = (node) => {
    const uid = `e${n++}`;
    // in practice: tag DOM nodes via evaluate and store handles keyed by uid
    return { uid, role: node.role, name: node.name, children: (node.children ?? []).map(walk) };
  };
  return walk(ax);
}
// click/fill can then accept a uid instead of a selector and resolve via `refs`.
```

The official **Playwright MCP** server (github.com/microsoft/playwright-mcp) does
this by injecting `aria-ref` attributes during snapshot and resolving `ref` back to
a locator. It is the closest public analog — study `browser_snapshot` /
`browser_click` there. Also relevant: the MCP TypeScript SDK
(github.com/modelcontextprotocol/typescript-sdk) and the CDP docs
(chromedevtools.github.io/devtools-protocol/).

### 5f. Return-value discipline

Every handler returns the MCP content shape. Return errors, don't throw:

```ts
return { content: [{ type: "text", text: JSON.stringify(data) }] };
// on failure:
return { content: [{ type: "text", text: `No element matched: ${sel}` }], isError: true };
```

---

## 6. The hard parts (where the engineering effort actually goes)

1. **Process lifecycle on Windows** — tree-kill, orphaned workers still holding the
   port, `--reload` servers that fork worker processes. (Real-world example: uvicorn
   `--reload` leaves spawn workers serving stale code; a supervisor must kill the
   port owner _and_ its spawn children.)
2. **Readiness & navigation races** — don't navigate before the server binds; don't
   snapshot before the SPA hydrates. `waitForPort` + `waitUntil`/`waitForLoadState`.
3. **Session isolation** — one browser+page per agent session; multiple sessions
   mean per-session ports (8202, 8203, …) and everything keyed by `serverId`.
   Decide whether foreign-server attach is allowed (Claude's implementation
   deliberately does not attach to servers it didn't start).
4. **Token economy** — this is a first-class design axis, not an afterthought:
   - screenshots as **JPEG** at moderate quality;
   - snapshots as **pruned accessibility trees**, never full DOM serialization;
   - network as a **summary table** with on-demand body fetch by `requestId`;
   - log tools with `lines` caps and `level`/`search` filters.
5. **Guardrails in descriptions** — write tool descriptions that _steer the agent_
   (eval-is-debug-only; screenshot-not-for-colors; prefer snapshot), not just
   document the API. This is prompt engineering embedded in the schema.
6. **Buffering async streams** — console and network arrive as push events, but
   tool calls are pull-based. Ring buffers accumulate between calls and get
   filtered on read.
7. **System-prompt workflow** — pair the tools with an injected verification
   workflow (§4, "prescribed agent workflow") so the agent knows when to verify,
   in what order, and that it must show proof rather than ask the user to check.
   Otto implements this for openai-compat agents in
   `openai-compat-agent.ts` (`buildPreviewWorkflowPrompt`), emitted only when the
   preview/browser tool groups are actually exposed.
8. **Deterministic tab enforcement** — descriptions steer, the daemon enforces.
   Otto goes beyond guardrail text: `browser_new_tab` and `browser_navigate`
   reject URLs that resolve to a running preview server's loopback port
   (`findPreviewServerForUrl` in `browser-tools/tools.ts`), returning an error
   that names the server's bound preview tab (or tells the agent to call
   `preview_start` when none is bound). Navigating the bound tab itself is
   allowed — that's how a wandered-off preview tab comes home. This closes the
   "agent opens a second, detached tab on the same URL" failure mode that
   description text alone cannot.

---

## 7. launch.json reference

`.claude/launch.json` (project root), format as embedded in the `preview_start`
description:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "<unique-name>",
      "runtimeExecutable": "<command>",
      "runtimeArgs": ["<args>"],
      "port": 8200
    }
  ]
}
```

- `runtimeExecutable` — the command (e.g. `"npm"`, `"pwsh"`, `"python"`)
- `runtimeArgs` — argument array (e.g. `["run", "dev"]`)
- `port` — the port the server will listen on (used for readiness + navigation)
- Observed extension in the wild: an `autoPort: true`-style behavior giving each
  session its own port (8202+) while sharing one backing DB — if you build
  multi-session support, an auto-increment port option is worth adding.

---

## 8. Minimal rebuild checklist

- [ ] MCP server scaffold (TS SDK, stdio transport), `tools/list` + `tools/call`
- [ ] launch.json reader; spawn + registry + ring-buffer capture; readiness poll
- [ ] Tree-kill on stop (Windows `taskkill /T /F`, POSIX process groups)
- [ ] Playwright Chromium session per agent session; goto on start
- [ ] Console + pageerror + network event buffers
- [ ] Tools: logs / console_logs / network (list + body-by-id)
- [ ] Tools: snapshot (AX tree + UID ref map), inspect (computed styles + bbox)
- [ ] Tools: click, fill, eval (JSON-serialized returns)
- [ ] Tools: resize (presets + colorScheme emulation), screenshot (JPEG image block)
- [ ] Error returns with `isError: true`, never thrown
- [ ] Tool descriptions with agent-steering guardrails
- [ ] System-prompt verification workflow for the host agent
- [ ] Optional: visible preview panel = embed the same Chromium view in your app UI
      (e.g. run headed Chromium in an app-managed window, or mirror via CDP
      screencast `Page.startScreencast` into your own panel)

---

## 9. Otto implementation status & decisions

Implementation lives in `packages/server/src/server/preview/`; it plugs into the
existing browser-tools subsystem rather than duplicating it.

**Architecture decision (user directive, 2026-07): the verification surface is
the Otto browser pane — the same tab the user watches — never a headless
Chromium and never the user's system browser.** Claude's preview panel is an
app-embedded browser the agent drives; Otto's equivalent is the browser pane in
the app, which already registers with the daemon's `BrowserToolsBroker` as an
automation host. §5d/§5e of the blueprint (Playwright controller, snapshot ref
map) are therefore _not built server-side_ — that half is the existing
`browser_*` toolset executing in the app host.

**Tab model: one designated tab per preview server ("it").** Otto allows many
browser tabs, so `preview_start` binds serverId → browserId
(`DevServerManager.bindTab`) and returns the browserId; verification uses that
tab only. If the user closed the tab, the next `preview_start` reopens it; if
the tab was navigated away, the result carries a warning note instead of
silently snapshotting the wrong page. No multi-tab preview orchestration.

Built:

- `launch-config.ts` — reads the same `.claude/launch.json` Claude Code writes
  (shared format, deliberate).
- `dev-server-manager.ts` — subsystem A: spawn/registry/ring-buffer/readiness
  poll/tree-kill/reuse, plus the tab binding.
- `preview-tools.ts` — `preview_start/stop/list/logs` in the Otto tool catalog
  (`otto-tools.ts`), guardrail descriptions included; `preview_start` opens or
  re-finds the designated tab through the broker (`new_tab`/`list_tabs`).

Prerequisites for live use: `daemon.browserTools.enabled: true` and
`daemon.mcp.injectIntoAgents: true` in the daemon config, plus a connected Otto
browser host (desktop app). Without a host the server still starts and the
result notes that no preview tab could be opened.

Also built: the `inspect` browser-automation command (`browser_inspect` agent
tool) — computed styles, bounding box, tag/id/class/text by CSS selector or
snapshot ref, executed in the Electron host via `executeJavaScript`; error code
`browser_element_not_found` for selector misses, stale-ref semantics for refs.
And the `network` command (`browser_network` agent tool) — a per-tab CDP
recorder in the Electron host (`webContents.debugger`, Network domain events
buffered into a 500-entry ring per tab) with the list/body split for token
economy: listing returns method/url/status/requestId, body-by-requestId uses
`Network.getResponseBody` capped at 30k chars. Capture is lazy — it attaches
on the tab's first `browser_network` call, so the tool description tells the
agent to reload after enabling to record the page's traffic. (`browser_logs`
still carries the lighter Performance-API entries.)

### Bootstrap negotiation (first-time projects)

Claude's "user friendliness" here is a canned **user-style message the app
auto-sends** when the preview panel is opened in a project with no
`.claude/launch.json`: "Detect my project's dev servers and save all their
configurations to .claude/launch.json, then ask which ones to start" plus the
file format. The agent does the detection with its ordinary tools and writes
the file; nothing server-side is involved.

Otto's canonical bootstrap prompt (for the app-side affordance):

> Detect this project's dev servers and save their configurations to
> `.claude/launch.json` (create it if missing) using the format from the
> `preview_start` tool description. Then ask me which ones to start, and call
> `preview_start` for each one I pick.

Agent-side self-serve already works without it: `preview_start`'s description
embeds the format with create-if-missing instructions, and a missing config
returns an actionable error naming the path.

**Built:** the app-side affordance is the Preview button in the workspace tab
row (next to New Browser), covered in §10 below — it auto-sends this exact
prompt when the focused chat's project has no `.claude/launch.json`.

Remaining: the system-prompt verification workflow for Otto's agents (teaching
agents when/how to use the preview tools without being asked).

## 10. Preview button (UI-initiated preview, not agent-initiated)

A second entry point into the same `DevServerManager`, for a human clicking a
button instead of an agent calling a tool. Lives in
`workspace-desktop-tabs-row.tsx` as `WorkspacePreviewButton`, rendered next to
the "New Browser" control in each pane's toolbar (Electron-only, same gate as
browser tabs).

**Enablement:** the button is only enabled when the pane's own active tab is a
chat (`target.kind === "agent"`) — the dev server to preview is resolved from
that agent's `cwd`, which may be a worktree distinct from the workspace root.
`SplitPaneView` (`split-container.tsx`) already computes this as
`activeTabDescriptor`; it's threaded down as the `focusedTab` prop.

**Click flow:**

1. `preview.list_config.request` — reads `.claude/launch.json` for the
   focused agent's cwd without starting anything.
2. Zero configured servers → auto-sends the canonical bootstrap prompt above
   into that chat via `client.sendAgentMessage`. No menu opens.
3. Exactly one configured server → starts it directly.
4. More than one → opens a small picker menu (server name + port); picking one
   starts it.
5. On successful start: creates the browser tab client-side (`isPreview: true`
   on the browser record, so its tab icon is always Play — never the favicon
   — making preview tabs visually unambiguous from user-opened ones), splits
   it into a new pane to the right of the button's own pane (not
   whatever pane happens to be globally focused), then calls
   `preview.bind_tab` so a later agent `preview_start` call for the same
   server finds this exact tab.

**Why three new RPCs instead of reusing `preview_start`:** `preview_start` is
an Otto tool wired through `OttoToolExecutionContext` and resolves its caller
from agent context; a UI click has no agent context. `preview.list_config`,
`preview.start`, and `preview.bind_tab`
(`packages/protocol/src/messages.ts`, dispatched in
`session.ts`'s `dispatchPreviewMessage`) are the same
dotted-namespace-with-direction-suffix shape as `checkout.github.*`, calling
straight into the same `DevServerManager` instance
(`packages/server/src/server/preview/dev-server-manager.ts`) `preview_start`
uses — one source of truth for server lifecycle, two callers.

**Split placement note:** unlike the agent-driven `browser_new_tab` /
`preview_start` flow (which infers a split target from whatever pane is
currently globally focused, via `layout.focusedPaneId` — see
`findSplitRightTarget` in `packages/app/src/browser-automation/handler.ts`),
the UI button already knows exactly which pane it lives in (`paneId`), so it
splits off that pane directly rather than inferring one.
