#!/usr/bin/env node
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Interactive bootstrapper for the demo capture pipeline. Every question is a
 * menu you drive with the arrow keys — nothing to type or remember (no scenario
 * names, no directory names, no env var syntax). Sets every required env var
 * programmatically via child_process's `env` option, so there's nothing to
 * mistype across PowerShell/bash either. This is the entry point
 * demo/README.md points at for anyone who doesn't want to hand-assemble
 * commands themselves.
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "../..");
const outRoot = path.resolve(appRoot, "demo/.out");
const DEMO_CONFIG = "playwright.demo.config.ts";
const ELECTRON_CONFIG = "playwright.demo-electron.config.ts";

// Sentinel returned by select() when the user backs out (q / Esc). Distinct
// from any real menu value so callers can tell "cancelled" from a choice.
const CANCEL = Symbol("cancel");

// Scenarios in their natural numbered order (01→09). The numbered walkthrough
// is the series people step through; anything without a number is a one-off and
// lives under "Extras" so the numbered list stays in order and easy to scan.
const SCENARIOS = [
  {
    id: "01-agent-live",
    label: "Agent working live — create, stream, tool calls, finish",
    kind: "real",
    providerChoice: true,
    badges: ["tokens"],
  },
  {
    id: "02-preview-verify",
    label: "Preview verify — launch config, dev server, agent proof",
    kind: "electron-real",
    providerChoice: true,
    badges: ["tokens", "electron"],
  },
  {
    id: "03-diff-review",
    label: "Diff review — file explorer, tabs, changes list, diffs",
    kind: "free",
    badges: ["free"],
  },
  {
    id: "04-personalities",
    label: "Personalities — roster, tabbed editor, composer picker",
    kind: "free",
    badges: ["free"],
  },
  {
    id: "05-agent-teams",
    label: "Agent teams — creation, switcher, picker",
    kind: "free",
    badges: ["free"],
  },
  {
    id: "06-model-picker",
    label: "Model picker across chat/schedule/artifact surfaces",
    kind: "free",
    badges: ["free"],
  },
  { id: "07-subagent-track", label: "Sub-agent tracking", kind: "real", badges: ["tokens"] },
  {
    id: "08-visualizer",
    label: "Visualizer — live agent constellation",
    kind: "real",
    badges: ["tokens"],
  },
  {
    id: "09-composer-intelligence",
    label: "Ghost prompts + suggested tasks",
    kind: "real",
    badges: ["tokens"],
  },
];

const EXTRAS = [
  {
    id: "feature-spread",
    label: "Feature spread — stills sweep (desktop + mobile + tablet + iOS)",
    kind: "spread",
    badges: ["free"],
  },
  {
    id: "hero-shot",
    label: "Hero shot — flagship chat+Visualizer split (Atlas)",
    kind: "real",
    badges: ["tokens"],
  },
  {
    id: "electron-smoke",
    label: "Electron smoke test — proves the desktop capture lane works",
    kind: "electron-free",
    badges: ["free", "electron"],
  },
];

// ── Terminal styling ────────────────────────────────────────────────────────
const ESC = "\x1b";
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const useMenu = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);

const style = {
  reset: useColor ? `${ESC}[0m` : "",
  bold: useColor ? `${ESC}[1m` : "",
  dim: useColor ? `${ESC}[2m` : "",
  cyan: useColor ? `${ESC}[36m` : "",
};

function paint(text, ...codes) {
  if (!useColor) return text;
  return codes.join("") + text + style.reset;
}

/** Small inverse-video pill, e.g. ` $ tokens `. Falls back to `[label]` without color. */
function pill(label, bg) {
  if (!useColor) return `[${label}]`;
  return `${ESC}[${bg}m${ESC}[30m ${label} ${ESC}[0m`;
}

const BADGE = {
  free: () => pill("free", 42), // green
  tokens: () => pill("$ tokens", 43), // yellow
  electron: () => pill("electron", 45), // magenta
};

function renderBadges(badges) {
  if (!badges || badges.length === 0) return "";
  return " " + badges.map((b) => BADGE[b]()).join(" ");
}

// ── The one input primitive: an arrow-key menu ──────────────────────────────
// items: [{ label, value, badges? } | { header } | { divider: true }]. Headers
// and dividers aren't selectable and are skipped when navigating. Returns the
// chosen `value`, or CANCEL if the user hits q / Esc. Number keys 1-9 jump to
// (and immediately pick) the Nth selectable row.
function select(title, items, { initialIndex = 0 } = {}) {
  const selectable = [];
  items.forEach((item, i) => {
    if (!item.header && !item.divider) selectable.push(i);
  });
  if (selectable.length === 0) return Promise.resolve(CANCEL);

  if (!useMenu) return selectFallback(title, items, selectable);

  let pos = Math.min(Math.max(initialIndex, 0), selectable.length - 1);

  return new Promise((resolve) => {
    let painted = 0;

    const render = () => {
      if (painted > 0) process.stdout.write(`${ESC}[${painted}A`);
      const lines = [paint(title, style.bold, style.cyan)];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.divider) {
          lines.push("");
          continue;
        }
        if (item.header) {
          lines.push(paint(item.header, style.dim));
          continue;
        }
        const active = i === selectable[pos];
        const pointer = active ? paint("❯", style.cyan) : " ";
        const label = active ? paint(item.label, style.bold) : item.label;
        lines.push(`${pointer} ${label}${renderBadges(item.badges)}`);
      }
      lines.push(paint("↑/↓ move · enter select · q back", style.dim));
      process.stdout.write(lines.map((l) => `${ESC}[2K${l}`).join("\n") + "\n");
      painted = lines.length;
    };

    const cleanup = () => {
      process.stdin.off("keypress", onKey);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write(`${ESC}[?25h`); // show cursor
    };

    const onKey = (str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
        return;
      }
      if (key.name === "up" || key.name === "k") {
        pos = (pos - 1 + selectable.length) % selectable.length;
        render();
      } else if (key.name === "down" || key.name === "j") {
        pos = (pos + 1) % selectable.length;
        render();
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(items[selectable[pos]].value);
      } else if (key.name === "q" || key.name === "escape") {
        cleanup();
        resolve(CANCEL);
      } else if (str && /^[1-9]$/.test(str)) {
        const n = Number(str) - 1;
        if (n < selectable.length) {
          cleanup();
          resolve(items[selectable[n]].value);
        }
      }
    };

    process.stdout.write(`${ESC}[?25l`); // hide cursor
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKey);
    render();
  });
}

/** Non-TTY fallback (pipes / CI): print a numbered list, read one line. */
function selectFallback(title, items, selectable) {
  console.log(`\n${title}`);
  selectable.forEach((i, n) => console.log(`  ${n + 1}. ${items[i].label}`));
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Pick a number: ", (raw) => {
      rl.close();
      const n = Number(String(raw).trim());
      if (Number.isInteger(n) && n >= 1 && n <= selectable.length) {
        resolve(items[selectable[n - 1]].value);
      } else {
        resolve(CANCEL);
      }
    });
  });
}

function buildMainMenuItems() {
  const items = [{ header: "Scenarios" }];
  for (const s of SCENARIOS)
    items.push({ label: `${s.id} · ${s.label}`, value: s, badges: s.badges });
  items.push({ divider: true }, { header: "Extras" });
  for (const s of EXTRAS) items.push({ label: `${s.id} · ${s.label}`, value: s, badges: s.badges });
  items.push({ divider: true }, { header: "Other" });
  items.push({ label: "Convert an already-captured run into site assets", value: "postprocess" });
  items.push({ label: "Quit", value: "quit" });
  return items;
}

async function chooseTheme() {
  return select("Which theme?", [
    { label: "Both Twilight and Daylight", value: ["demo-twilight", "demo-daylight"] },
    { label: "Twilight only (faster/cheaper to iterate)", value: ["demo-twilight"] },
    { label: "Daylight only", value: ["demo-daylight"] },
  ]);
}

async function chooseProvider() {
  return select("Which provider/model?", [
    { label: "Claude — Sonnet 5 (cheap, full feature set)", value: { DEMO_PROVIDER: "claude" } },
    {
      label: "Claude — Opus (pricier, sometimes plans more thoroughly)",
      value: { DEMO_PROVIDER: "claude", DEMO_MODEL: "opus" },
    },
    {
      label: "Local-AI — your LM Studio setup (needs .env.test configured)",
      value: { DEMO_PROVIDER: "local-ai", E2E_LOCAL_AI: "1" },
    },
  ]);
}

// Desktop UI zoom → DEMO_ZOOM, read by demo/helpers/resolution.ts. Higher =
// bigger UI but less content and less logical height; 3.0 is the ceiling before
// the app drops to its compact/mobile layout (see MAX_DESKTOP_CAPTURE_SCALE).
// Labels show the resulting logical layout size (output 2560×1440 ÷ zoom).
async function chooseZoom() {
  return select(
    "Desktop UI zoom (bigger = larger UI, less on screen):",
    [
      { label: "2.0× — more content, smaller UI (1280×720 layout)", value: "2" },
      { label: "2.5× — balanced (1024×576 layout)", value: "2.5" },
      { label: "3.0× — biggest UI, least content (853×480 layout)", value: "3" },
    ],
    { initialIndex: 1 },
  );
}

async function confirmSpend(themeCount) {
  const cost =
    themeCount > 1 ? "TWO real provider turns (one per theme)" : "one real provider turn";
  const answer = await select(`This run spends real provider tokens — ${cost}.`, [
    { label: "Yes, run it", value: true },
    { label: "No, cancel", value: false },
  ]);
  return answer === true;
}

async function confirmAgain() {
  const answer = await select(
    "Run another?",
    [
      { label: "Yes", value: true },
      { label: "No, exit", value: false },
    ],
    { initialIndex: 1 },
  );
  return answer === true;
}

function baseEnv() {
  const env = { ...process.env };
  // Chrome/Chromium isn't installed by default on Windows dev machines;
  // Edge is. Only set it if the caller hasn't already picked a channel.
  if (process.platform === "win32" && !env.E2E_BROWSER_CHANNEL) {
    env.E2E_BROWSER_CHANNEL = "msedge";
  }
  return env;
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: appRoot, env, stdio: "inherit", shell: true });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function printReviewHint(outDirs) {
  console.log("\nDone. Review before trusting it:");
  for (const dir of outDirs) {
    console.log(`  packages/app/demo/.out/${dir}/shots/`);
  }
  console.log(
    "Open every PNG and look at the WHOLE frame — both staged repos in the sidebar, no error " +
      "banners, forms filled, nothing scrolled out of view. A passing test is not the bar.",
  );
}

async function runFreeOrReal(scenario) {
  const zoom = await chooseZoom();
  if (zoom === CANCEL) return;
  const themes = await chooseTheme();
  if (themes === CANCEL) return;
  const env = baseEnv();
  env.DEMO_ZOOM = zoom;
  const outDirs = themes.map((project) => `${scenario.id}-${project.replace("demo-", "")}`);

  if (scenario.kind === "real") {
    env.DEMO_REAL = "1";
    if (scenario.providerChoice) {
      const provider = await chooseProvider();
      if (provider === CANCEL) return;
      Object.assign(env, provider);
    }
    if (!(await confirmSpend(themes.length))) {
      console.log("Cancelled.");
      return;
    }
  }

  // `--project` is variadic in Playwright's CLI: the space form
  // (`--project foo bar`) greedily swallows the trailing scenario filter as
  // another project name. The `=` form binds one value per flag, leaving the
  // scenario id to land as the positional test filter it's meant to be.
  const args = ["playwright", "test", "--config", DEMO_CONFIG];
  for (const project of themes) args.push(`--project=${project}`);
  args.push(scenario.id);

  const code = await run("npx", args, env);
  if (code !== 0) {
    console.log(`\nRun exited with code ${code} — check the output above for the failing step.`);
    return;
  }
  printReviewHint(outDirs);
}

async function runSpread() {
  // Zoom drives the desktop spread shots; the mobile/tablet/ios projects keep
  // their own store-listing viewports and ignore it.
  const zoom = await chooseZoom();
  if (zoom === CANCEL) return;
  const env = baseEnv();
  env.DEMO_ZOOM = zoom;
  const args = [
    "playwright",
    "test",
    "--config",
    DEMO_CONFIG,
    "--project=spread-twilight",
    "--project=spread-daylight",
    "--project=spread-mobile",
    "--project=spread-tablet",
    "--project=spread-ios",
  ];
  const code = await run("npx", args, env);
  if (code !== 0) {
    console.log(`\nRun exited with code ${code} — check the output above.`);
    return;
  }
  printReviewHint([
    "feature-spread-twilight",
    "feature-spread-daylight",
    "feature-spread-mobile",
    "feature-spread-tablet",
    "feature-spread-ios",
  ]);
}

async function runElectron(scenario) {
  const zoom = await chooseZoom();
  if (zoom === CANCEL) return;
  const env = baseEnv();
  env.DEMO_ZOOM = zoom;
  const outDirs = [
    scenario.id === "02-preview-verify" ? "02-preview-verify-twilight" : "electron-smoke",
  ];

  if (scenario.kind === "electron-real") {
    env.DEMO_REAL = "1";
    if (scenario.providerChoice) {
      const provider = await chooseProvider();
      if (provider === CANCEL) return;
      Object.assign(env, provider);
    }
    if (!(await confirmSpend(1))) {
      console.log("Cancelled.");
      return;
    }
  }

  console.log("\nBuilding the desktop app's main process first (needed for every Electron run)...");
  const build = spawnSync("npm", ["--prefix", "../desktop", "run", "build:main"], {
    cwd: appRoot,
    env,
    stdio: "inherit",
    shell: true,
  });
  if (build.status !== 0) {
    console.log(`\nbuild:main failed with code ${build.status} — fix that before continuing.`);
    return;
  }

  const args = ["playwright", "test", "--config", ELECTRON_CONFIG, scenario.id];
  const code = await run("npx", args, env);
  if (code !== 0) {
    console.log(`\nRun exited with code ${code} — check the output above.`);
    return;
  }
  printReviewHint(outDirs);
}

/** Scenario base name from a .out/ directory name — strips a trailing theme suffix. */
function baseNameOf(dirName) {
  return dirName.replace(/-(twilight|daylight|mobile|tablet|ios)$/, "");
}

async function discoverCaptures() {
  let entries;
  try {
    entries = await readdir(outRoot, { withFileTypes: true });
  } catch {
    return new Map();
  }
  const byBase = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const base = baseNameOf(entry.name);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(entry.name);
  }
  return byBase;
}

async function runPostprocess() {
  const byBase = await discoverCaptures();
  if (byBase.size === 0) {
    console.log("\nNo captures found in demo/.out/ yet — run a scenario first.");
    return;
  }
  const items = [...byBase.entries()].map(([base, dirs]) => {
    const themes = dirs.map((d) => d.replace(`${base}-`, "")).filter((t) => t !== base);
    const label = themes.length > 0 ? `${base} (${themes.join(", ")})` : base;
    return { label, value: dirs };
  });
  const dirs = await select("Convert which capture into site assets?", items);
  if (dirs === CANCEL) return;
  const code = await run("node", ["demo/scripts/postprocess.mjs", ...dirs], baseEnv());
  if (code === 0) {
    console.log("\nDone — check packages/website/public/demos/ for the site-ready assets.");
  }
}

async function main() {
  readline.emitKeypressEvents(process.stdin);
  for (;;) {
    const choice = await select("Otto demo capture pipeline", buildMainMenuItems());
    if (choice === "quit" || choice === CANCEL) break;
    if (choice === "postprocess") {
      await runPostprocess();
    } else if (choice.kind === "spread") {
      await runSpread();
    } else if (choice.kind === "electron-free" || choice.kind === "electron-real") {
      await runElectron(choice);
    } else {
      await runFreeOrReal(choice);
    }
    if (!(await confirmAgain())) break;
  }
  process.stdout.write(`${ESC}[?25h`); // show cursor
}

main().catch((err) => {
  process.stdout.write(`${ESC}[?25h`); // restore cursor on any crash path
  // Stdin closing mid-prompt (Ctrl+D, or any non-interactive invocation) —
  // treat it as "done", not a crash with a stack trace.
  if (err && err.code === "ERR_USE_AFTER_CLOSE") {
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
