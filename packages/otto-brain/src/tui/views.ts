import type { App } from "./app.js";
import type { RunRecord } from "../ops/results.js";
import type { ModelMetadata } from "../types.js";
import { stripStyles, box, meter, pad, style, truncate, width } from "./screen.js";
import { formatGiB, GIB } from "../vram.js";

const CONFIG_MIN_WIDTH = 28;
const CONFIG_MAX_WIDTH = 46;
const MODEL_MIN_WIDTH = 24;
interface TaskDetail {
  concurrency?: number;
  genPerSecond?: number;
  promptPerSecond?: number;
  contextUtilization?: number;
  peakPromptTokens?: number;
  contextWindow?: number;
}
function taskDetail(detail: unknown): TaskDetail {
  function number(key: string): number | undefined {
    if (typeof detail !== "object" || detail === null) return undefined;
    const value: unknown = Reflect.get(detail, key);
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
  return {
    concurrency: number("concurrency"),
    genPerSecond: number("genPerSecond"),
    promptPerSecond: number("promptPerSecond"),
    contextUtilization: number("contextUtilization"),
    peakPromptTokens: number("peakPromptTokens"),
    contextWindow: number("contextWindow"),
  };
}

// Presentation recovered from otto-0.9-final. All observed state comes from App's host snapshot.
function drawSearch(app: App, cols: number): void {
  const search = app.search;
  if (!search) return;
  const inner = Math.min(cols - 4, 78);
  const rows: string[] = [];

  if (search.input) {
    rows.push(`${style.grey}query${style.reset} ${search.query}${style.brightCyan}▏${style.reset}`);
    rows.push("");
    rows.push(
      `${style.grey}Type a model name, or an exact owner/repo to open it directly.${style.reset}`,
    );
  } else if (search.loading) {
    rows.push(`${style.grey}searching Hugging Face…${style.reset}`);
  } else {
    const direct = app.directRepo(search.query);
    let i = 0;
    const line = (selected: boolean, text: string): string =>
      selected ? `${style.inverse}${pad(stripStyles(text), inner)}${style.reset}` : text;
    if (direct) {
      rows.push(line(search.index === 0, `▶ open ${direct} directly`));
      i = 1;
    }
    if (!search.results.length && !direct) {
      rows.push(`${style.yellow}no GGUF models matched${style.reset}`);
    }
    // Repos we already have on disk, so a search hit can be flagged.
    const installedRepos = new Set(
      app.catalog.map((x) => app.repoOf(x)?.toLowerCase()).filter((v): v is string => Boolean(v)),
    );
    for (let r = 0; r < search.results.length; r += 1) {
      const m = search.results[r];
      const dl = m.downloads >= 1000 ? `${Math.round(m.downloads / 1000)}k` : String(m.downloads);
      const have = installedRepos.has(m.repo.toLowerCase())
        ? ` ${style.brightGreen}have${style.reset}`
        : "";
      const text =
        `${pad(truncate(m.repo, inner - 24), inner - 24)} ` +
        `${style.grey}${dl.padStart(6)} dl  ${String(m.likes).padStart(4)}♥${m.gated ? " gated" : ""}${style.reset}${have}`;
      rows.push(line(search.index === i, text));
      i += 1;
    }
  }

  const footer = search.input
    ? `${style.grey}enter search · esc cancel${style.reset}`
    : `${style.grey}↑↓ select · enter view quants · esc edit query${style.reset}`;
  const lines = [renderHeader(app, cols), ""];
  lines.push(
    ...box({
      title: "Search Hugging Face for models",
      lines: rows,
      innerWidth: inner,
      footer,
      accent: style.brightCyan,
    }),
  );
  app.renderFitted(lines);
}

function drawPicker(app: App, cols: number): void {
  const picker = app.picker;
  if (!picker) return;
  const inner = Math.min(cols - 4, 72);
  const rows: string[] = [];
  if (picker.loading) {
    rows.push(`${style.grey}fetching available quantizations…${style.reset}`);
  } else if (!picker.options.length) {
    rows.push(`${style.yellow}no GGUF quantizations found in this repo${style.reset}`);
  } else {
    // Reserve the same 1.5G VRAM the budget does, as a rough "will it fit" hint.
    const vramBudget = app.gpuInfo ? app.gpuInfo.totalBytes - 1.5 * GIB : null;
    for (let i = 0; i < picker.options.length; i += 1) {
      const q = picker.options[i];
      const marker = i === picker.index ? "▶" : " ";
      let state = `${style.grey}available${style.reset}`;
      if (q.installed) state = `${style.brightGreen}installed${style.reset}`;
      else if (vramBudget !== null && q.sizeBytes > vramBudget)
        state = `${style.yellow}heavy for VRAM${style.reset}`;
      const plain = `${marker} ${pad(q.quant, 12)} ${formatGiB(q.sizeBytes).padStart(8)}`;
      rows.push(
        i === picker.index
          ? `${style.inverse}${pad(plain, inner)}${style.reset}`
          : `${plain}  ${state}`,
      );
    }
  }
  const lines = [renderHeader(app, cols), ""];
  lines.push(
    ...box({
      title: `Download quant - ${truncate(picker.repo, Math.max(8, inner - 18))}`,
      lines: rows,
      innerWidth: inner,
      footer: picker.loading
        ? `${style.grey}esc cancel${style.reset}`
        : `${style.grey}↑↓ select · enter download · esc cancel${style.reset}`,
      accent: style.brightCyan,
    }),
  );
  app.renderFitted(lines);
}

export function draw(app: App): void {
  if (!app.screen.entered) return;
  const cols = app.screen.columns;

  if (cols < 60 || app.screen.rows < 18) {
    app.renderFitted([
      renderHeader(app, cols),
      "Brain needs at least 60 columns and 18 rows.",
      "Resize the terminal. q / Ctrl-C quit",
    ]);
    return;
  }
  if (["catalog", "runtimes", "jobs"].includes(app.viewMode)) {
    drawAuxiliary(app, cols);
    return;
  }
  if (app.picker) {
    drawPicker(app, cols);
    return;
  }
  if (app.search) {
    drawSearch(app, cols);
    return;
  }
  if (app.viewMode === "logs") {
    drawLogs(app, cols);
    return;
  }
  if (app.viewMode === "help") {
    drawHelp(app, cols);
    return;
  }
  if (app.viewMode === "bench") {
    drawBench(app, cols);
    return;
  }

  // Give the model list the width; keep config compact. Hold the combined
  // panel row to cols-2 so nothing spills into the terminal's last column
  // (writing there scrolls the view, which read as "config goes off screen").
  const rightWidth = Math.max(
    CONFIG_MIN_WIDTH,
    Math.min(CONFIG_MAX_WIDTH, Math.round(cols * 0.38)),
  );
  const leftWidth = Math.max(MODEL_MIN_WIDTH, cols - rightWidth - 7);

  // Render the fixed-height chrome first and measure it, then hand the panels
  // exactly the rows that are left. The status panel grows once CPU/GPU and
  // telemetry lines appear, so a static guess pushes the footer off-screen.
  const header = renderHeader(app, cols);
  const budget = budgetPanel(app, cols - 2);
  const status = statusPanel(app, cols - 2);
  const footer = keybindings(app, cols - 1);

  // Lines around the panels: header + blank + [panels] + blank + budget +
  // blank + status + blank + footer. The panel box adds 3 rows of its own
  // chrome (title, its footer, bottom border) on top of listRows.
  const overhead = 1 + 1 + 3 + 1 + budget.length + 1 + status.length + 1 + footer.length;
  const listRows = Math.max(1, app.screen.rows - 1 - overhead);

  const lines = [header, ""];
  const left = modelPanel(app, leftWidth, listRows);
  const right = configPanel(app, rightWidth, listRows);
  const height = Math.max(left.length, right.length);
  for (let i = 0; i < height; i += 1) {
    const l = left[i] ?? " ".repeat(leftWidth + 2);
    const r = right[i] ?? "";
    lines.push(`${l} ${r}`);
  }

  lines.push("");
  lines.push(...budget);
  lines.push("");
  lines.push(...status);
  if (app.renaming) {
    lines.push("");
    lines.push(renameLine(app, cols - 1));
  }
  lines.push("");
  lines.push(...footer);

  app.renderFitted(lines);
}

function renameLine(app: App, cols: number): string {
  const model = app.model;
  const name = model ? model.displayName : "";
  return truncate(
    `${style.brightYellow}rename${style.reset}  ${style.grey}${name}${style.reset} → ` +
      `${app.renameBuffer}${style.brightCyan}▏${style.reset}`,
    cols,
  );
}

function drawBench(app: App, cols: number): void {
  // Keep this identical to draw()'s split so the Benchmark sidebar lands at the
  // same width as the Configuration panel and the model list does not jump when
  // toggling between the two screens.
  const rightWidth = Math.max(
    CONFIG_MIN_WIDTH,
    Math.min(CONFIG_MAX_WIDTH, Math.round(cols * 0.38)),
  );
  const leftWidth = Math.max(MODEL_MIN_WIDTH, cols - rightWidth - 7);

  const header = renderHeader(app, cols);
  const bottom = benchBottom(app, cols - 2);
  const footer = keybindings(app, cols - 1);
  const overhead = 1 + 1 + 3 + 1 + bottom.length + 1 + footer.length;
  const listRows = Math.max(1, app.screen.rows - 1 - overhead);

  const lines = [header, ""];
  const left = modelPanel(app, leftWidth, listRows);
  const right = benchSidebar(app, rightWidth, listRows);
  const height = Math.max(left.length, right.length);
  for (let i = 0; i < height; i += 1) {
    const l = left[i] ?? " ".repeat(leftWidth + 2);
    const r = right[i] ?? "";
    lines.push(`${l} ${r}`);
  }

  lines.push("");
  lines.push(...bottom);
  lines.push("");
  lines.push(...footer);
  app.renderFitted(lines);
}

function benchSidebar(app: App, innerWidth: number, rows: number): string[] {
  const lines: string[] = [];
  const model = app.model;
  if (!model) {
    lines.push(`${style.grey}no model selected${style.reset}`);
  } else {
    lines.push(`${style.bold}${truncate(model.displayName, innerWidth)}${style.reset}`);
    lines.push(`${style.grey}${model.quant || "?"}  ${formatGiB(model.sizeBytes)}${style.reset}`);
    lines.push("");

    const rec = app.benchResults.find((r) => r.model.id === model.id) || null;
    const ranking = app.rankOf(model);

    if (app.benchRunning && app.benchModelId === model.id) {
      lines.push(`${style.brightYellow}benchmarking now…${style.reset}`);
    } else if (!ranking || !rec) {
      lines.push(`${style.yellow}not benchmarked yet${style.reset}`);
      lines.push(`${style.grey}press r to run the suite${style.reset}`);
    } else {
      lines.push(
        `${style.grey}rank${style.reset} ${style.bold}#${ranking.rank}${style.reset}${style.grey} of ${app.rankedModels.length}${style.reset}`,
      );
      lines.push(
        `${style.grey}overall${style.reset} ${app.scoreColour(ranking.overall)}${(ranking.overall * 100).toFixed(0)}%  ${ranking.grade}${style.reset}`,
      );
      lines.push(
        `${style.grey}mean of ${ranking.runs} run${ranking.runs === 1 ? "" : "s"}${ranking.runs > 1 ? ` · ±${(ranking.std * 100).toFixed(1)}pts` : ""}${style.reset}`,
      );
      lines.push("");
      for (const t of rec.tasks) {
        lines.push(
          `${pad(truncate(t.category, 16), 16)} ${app.scoreColour(t.score)}${(t.score * 100).toFixed(0).padStart(3)}%${style.reset}`,
        );
      }
      lines.push(...benchmarkTaskDetails(app, rec));
      lines.push(`${style.grey}ran ${rec.ranAt.slice(0, 10)} · ${rec.grade}${style.reset}`);
    }
  }
  while (lines.length < rows) lines.push("");
  return box({
    title: "Benchmark",
    lines,
    innerWidth,
    footer: `${style.grey}r run · esc back${style.reset}`,
    accent: style.brightCyan,
  });
}

function benchBottom(app: App, innerWidth: number): string[] {
  if (app.benchRunning) {
    const lines = app.benchProgress.slice(-6).map((line) => truncate(`  ${line}`, innerWidth - 4));
    while (lines.length < 6) lines.push("");
    return box({
      title: "Benchmark progress",
      lines,
      innerWidth: innerWidth - 2,
      accent: style.brightYellow,
    });
  }

  if (!app.rankedModels.length) {
    return box({
      title: "Leaderboard",
      lines: [
        `${style.grey}no benchmarks yet - select a model and press r to run one${style.reset}`,
      ],
      innerWidth: innerWidth - 2,
    });
  }

  const lines: string[] = [];
  lines.push(
    `${style.grey}${pad("#", 3)}${pad("model", 38)}${"mean".padStart(8)}${"runs".padStart(6)}${"grade".padStart(10)}${"gen tok/s".padStart(11)}${style.reset}`,
  );
  for (const entry of app.rankedModels.slice(0, 8)) {
    const latest = app.benchResults.find(
      (r) => (entry.id && r.model.id === entry.id) || r.model.displayName === entry.displayName,
    );
    const conc = latest && latest.tasks.find((t) => t.id === "concurrency");
    const tps = conc && conc.detail ? taskDetail(conc.detail).genPerSecond : null;
    const selected = app.model && entry.displayName === app.model.displayName;
    const row =
      `${pad(String(entry.rank), 3)}${pad(truncate(entry.displayName, 37), 38)}` +
      `${`${(entry.overall * 100).toFixed(0)}%`.padStart(8)}${String(entry.runs).padStart(6)}` +
      `${entry.grade.padStart(10)}${(tps != null ? tps.toFixed(0) : "-").padStart(11)}`;
    lines.push(selected ? `${style.inverse}${pad(row, innerWidth - 2)}${style.reset}` : row);
  }
  return box({
    title: `Leaderboard ${style.grey}(${app.rankedModels.length} ranked, mean of runs)${style.reset}`,
    lines,
    innerWidth: innerWidth - 2,
  });
}

function drawLogs(app: App, cols: number): void {
  const logs = app.snapshot.logs;
  const s = app.hostStatus();
  const header = renderHeader(app, cols);
  const status = statusPanel(app, cols - 2);
  const footer = keybindings(app, cols - 1);
  const title = truncate(
    `${style.brightCyan}Brain log${style.reset}  ` +
      `${style.grey}${s.state}${logs.length ? ` · ${logs.length} lines` : ""} · esc or l to go back${style.reset}`,
    cols - 1,
  );

  // header + blank + title + blank + [body] + blank + status + blank + footer.
  const overhead = 1 + 1 + 1 + 1 + 1 + status.length + 1 + footer.length;
  const bodyRows = Math.max(1, app.screen.rows - 1 - overhead);

  const body: string[] = [];
  if (logs.length === 0) {
    body.push(
      `${style.grey}no logs yet - start a model or operation to see Brain output${style.reset}`,
    );
  } else {
    for (const line of logs.slice(Math.max(0, logs.length - bodyRows)))
      body.push(truncate(line, cols));
  }
  while (body.length < bodyRows) body.push("");

  const lines = [header, "", title, "", ...body, "", ...status, "", ...footer];
  app.renderFitted(lines);
}

function renderHeader(app: App, cols: number): string {
  const title = `${style.bold}${style.brightCyan}Otto Brain${style.reset}${style.grey} v${app.snapshot.version}${style.reset}`;
  const rt = `${style.grey}llama.cpp ${app.snapshot.runtime?.label ?? "not installed"} v${app.snapshot.runtime?.version ?? ""}${style.reset}`;
  const g = app.gpuInfo
    ? `${style.grey}${app.gpuInfo.name} · ${app.gpuInfo.usedBytes === null ? "usage unavailable" : `${formatGiB(app.gpuInfo.usedBytes)}/`}${formatGiB(app.gpuInfo.totalBytes)}${style.reset}`
    : `${style.yellow}no supported GPU memory budget detected${style.reset}`;
  const endpoint = app.snapshot.endpoint
    ? `${style.grey}serving ${app.snapshot.endpoint}${style.reset}`
    : `${style.red}host endpoint unavailable${style.reset}`;
  return truncate(`${title}  ${rt}  ${g}  ${endpoint}`, cols - 1);
}

function modelPanel(app: App, innerWidth: number, rows: number): string[] {
  const list = app.visible;
  if (app.selected < app.scrollTop) app.scrollTop = app.selected;
  if (app.selected >= app.scrollTop + rows) app.scrollTop = app.selected - rows + 1;

  const lines: string[] = [];
  for (let i = app.scrollTop; i < Math.min(list.length, app.scrollTop + rows); i += 1) {
    const m = list[i];
    const isSelected = i === app.selected;
    const running = app.snapshot.residents.some(
      (resident) => resident.modelId === m.id && resident.phase === "ready",
    );

    const marker = running ? `${style.brightGreen}●${style.reset}` : " ";
    const quant = m.quant ? m.quant.padEnd(7) : "-".padEnd(7);
    const size = formatGiB(m.sizeBytes).padStart(6);
    const isReasoning = Boolean(m.metadata?.reasoning || m.thinking);
    const tags = [
      m.mmprojPath ? `${style.cyan}V${style.reset}` : " ",
      m.features.mtp ? `${style.magenta}M${style.reset}` : " ",
      isReasoning ? `${style.green}R${style.reset}` : " ",
    ].join("");

    // Benchmark score badge: how this model ranks by our latest measurement.
    const rank = app.rankOf(m);
    const score = rank
      ? `${app.scoreColour(rank.overall)}${String(Math.round(rank.overall * 100)).padStart(3)}%${style.reset}`
      : `${style.grey}   –${style.reset}`;

    const nameWidth = innerWidth - 7 - 7 - 3 - 2 - 5;
    const name = truncate(m.displayName, nameWidth);
    const row = `${marker}${pad(name, nameWidth)} ${score} ${quant}${size} ${tags}`;
    lines.push(
      isSelected
        ? `${style.inverse}${pad(truncate(stripStyles(row), innerWidth), innerWidth)}${style.reset}`
        : row,
    );
  }
  while (lines.length < rows) lines.push("");

  const title = app.filterMode
    ? `Models  ${style.brightYellow}/${app.filter}${style.reset}`
    : `Models ${style.grey}(${list.length})${style.reset}`;
  const footer = `${style.grey}%=benchmark  V=vision  M=MTP  R=reasoning${style.reset}`;
  return box({
    title,
    lines,
    innerWidth,
    footer,
    accent: app.focus === "models" ? style.brightCyan : style.grey,
  });
}

function configPanel(app: App, innerWidth: number, rows: number): string[] {
  // Build the full content first, remembering which line holds the focused
  // field, then window it to exactly `rows` so the box height always matches
  // the model list and never runs off the bottom of the screen.
  const content: string[] = [];
  let focusLine = 0;
  const model = app.model;
  const profile = app.profile;
  if (!model || !profile) {
    content.push(`${style.grey}no model selected${style.reset}`);
  } else {
    const md: ModelMetadata = model.metadata ?? {};
    content.push(
      `${style.grey}arch${style.reset} ${md.arch || "?"}   ` +
        `${style.grey}layers${style.reset} ${md.blockCount ?? "?"}   ` +
        `${style.grey}kv heads${style.reset} ${md.headCountKv ?? "?"}`,
    );
    if (model.features.mtp || model.features.distilled) {
      const flags = [
        model.features.mtp ? "multi-token prediction" : null,
        model.features.distilled ? "distilled" : null,
      ]
        .filter(Boolean)
        .join(", ");
      content.push(`${style.grey}${flags}${style.reset}`);
    }
    content.push("");

    const fieldRows = configurationFields(app);
    focusLine = content.length + fieldRows.focusLine;
    content.push(...fieldRows.content);

    content.push(...sweepRows(app, innerWidth));
  }

  // Window to `rows`, keeping the focused field on screen when it overflows.
  let lines: string[];
  if (content.length <= rows) {
    lines = content;
    while (lines.length < rows) lines.push("");
  } else {
    const start = Math.max(0, Math.min(focusLine - Math.floor(rows / 2), content.length - rows));
    lines = content.slice(start, start + rows);
  }

  const stale = app.row?.calibrationStale ?? false;
  let calibrationLabel = `${style.yellow}not calibrated${style.reset}`;
  if (stale) calibrationLabel = `${style.yellow}recalibrate${style.reset}`;
  else if (app.calibration) calibrationLabel = `${style.brightGreen}calibrated${style.reset}`;
  return box({
    title: `Configuration  ${calibrationLabel}`,
    lines,
    innerWidth,
    footer: `${style.grey}←→ change · enter edit${style.reset}`,
    accent: app.focus === "config" ? style.brightCyan : style.grey,
  });
}

function budgetPanel(app: App, innerWidth: number): string[] {
  const b = app.budget;
  if (!b) {
    return box({
      title: "VRAM budget",
      lines: [`${style.grey}unavailable${style.reset}`],
      innerWidth: innerWidth - 2,
    });
  }

  const cells = Math.max(20, Math.min(60, innerWidth - 40));
  const bar = meter(b.utilization, cells);
  const verdict = b.fits
    ? `${style.brightGreen}fits entirely on GPU${style.reset}`
    : `${style.red}EXCEEDS VRAM by ${formatGiB(-b.headroomBytes)}${style.reset}`;

  const breakdown =
    `weights ${formatGiB(b.weightsBytes)}` +
    (b.mmprojBytes ? ` + projector ${formatGiB(b.mmprojBytes)}` : "") +
    ` + kv ${formatGiB(b.kvBytes)}` +
    ` + overhead ${formatGiB(b.overheadBytes)}` +
    ` = ${style.bold}${formatGiB(b.totalBytes)}${style.reset}`;

  const kvLabel = `kv ${(b.kvBytesPerToken / 1024).toFixed(1)} KB/token`;
  const cal = app.calibration;
  const stale = app.row?.calibrationStale ?? false;
  let sourceNote: string;
  if (b.source === "measured") {
    sourceNote = `${style.grey}${kvLabel} (measured)${style.reset}`;
    if (cal?.inherited)
      sourceNote = `${style.yellow}${kvLabel} (measured on a relative - press c to calibrate this model)${style.reset}`;
    else if (stale)
      sourceNote = `${style.yellow}${kvLabel} (last measurement - press c to recalibrate)${style.reset}`;
  } else {
    const hint = stale
      ? "recalibrate to refresh this value"
      : "press c to calibrate; usually unlocks more context";
    sourceNote = `${style.yellow}${kvLabel} (theoretical - ${hint})${style.reset}`;
  }

  return box({
    title: "VRAM budget",
    lines: [
      `${bar}  ${formatGiB(b.totalBytes)} / ${formatGiB(b.usableBytes)} usable   ${verdict}`,
      breakdown,
      sourceNote,
    ],
    innerWidth: innerWidth - 2,
  });
}

function statusPanel(app: App, innerWidth: number): string[] {
  const s = app.hostStatus();
  const tone = {
    info: style.grey,
    good: style.brightGreen,
    warn: style.brightYellow,
    bad: style.red,
  }[app.status.tone];
  const stateColour =
    {
      ready: style.brightGreen,
      starting: style.brightYellow,
      stopping: style.yellow,
      failed: style.red,
      stopped: style.grey,
    }[s.state] || style.grey;

  const lines = [
    `${style.grey}server${style.reset} ${stateColour}${s.state}${style.reset}` +
      (s.model ? `  ${truncate(s.model, 40)}` : "") +
      (s.pid ? `  ${style.grey}pid ${s.pid}${style.reset}` : ""),
    `${tone}${truncate(app.status.text, innerWidth - 4)}${style.reset}`,
  ];

  lines.push(...systemLines(app));

  // Disk: total space the models take, and free space where new downloads land.
  const modelBytes = app.disk?.modelBytes ?? 0;
  const diskLine =
    `${style.grey}disk${style.reset} models ${formatGiB(modelBytes)}` +
    (app.disk
      ? `  ${formatGiB(app.disk.freeBytes)} free of ${formatGiB(app.disk.totalBytes)}`
      : "");
  lines.push(diskLine);

  const t = app.snapshot.telemetry;
  if (t.requests) {
    lines.push(
      `${style.grey}requests${style.reset} ${t.requests}  ` +
        `${style.brightGreen}ok ${t.ok}${style.reset}  ` +
        `${t.reasoningOnly ? style.red : style.grey}reasoning-only ${t.reasoningOnly}${style.reset}  ` +
        `${t.truncated ? style.brightYellow : style.grey}truncated ${t.truncated}${style.reset}`,
    );
  }
  const warning = app.snapshot.telemetry.warning;
  if (warning)
    lines.push(`${style.brightYellow}${truncate(warning, innerWidth - 4)}${style.reset}`);

  for (const resident of app.snapshot.residents) {
    const phases = resident.slots.map((slot) => `${slot.slot}:${slot.phase}`).join(" ");
    lines.push(
      `${style.grey}${truncate(resident.displayName, 28)} [${resident.residentId.slice(0, 8)}]${style.reset} ${resident.phase} ${phases}`,
    );
  }
  const job = app.snapshot.jobs.find(
    (entry) => entry.state === "running" || entry.state === "queued",
  );
  if (job)
    lines.push(
      `${style.brightYellow}${job.operation} ${job.state}${style.reset} ${job.progress.at(-1) ?? ""} · J jobs`,
    );
  if (app.snapshot.connection !== "connected")
    lines.push(`${style.yellow}${app.snapshot.connection}${style.reset}`);
  if (app.snapshot.message) lines.push(app.snapshot.message);

  return box({ title: "Status", lines, innerWidth: innerWidth - 2 });
}

function drawHelp(app: App, cols: number): void {
  const inner = Math.min(cols - 4, 76);
  const rows: string[] = [];
  const section = (t: string): void => {
    rows.push("", `${style.brightCyan}${t}${style.reset}`);
  };
  const item = (k: string, d: string): void => {
    rows.push(`  ${style.brightCyan}${pad(k, 12)}${style.reset}${style.grey}${d}${style.reset}`);
  };

  section("Navigate");
  item("↑ ↓", "move within the focused panel");
  item("PgUp PgDn", "jump by 8");
  item("Tab", "switch between the Models and Configuration panels");
  section("Change settings (Configuration panel)");
  item("← →", "change the selected field (toggle / cycle / ± step)");
  item("- +", "same as ← →");
  item("Enter", "edit a number field - type digits, Enter saves, Esc cancels");
  item("m", "set context to the largest size that fits in VRAM");
  section("Run the model");
  item("s", "start / load the selected model");
  item("x", "stop the running model");
  item("c", "calibrate - measure real VRAM per token");
  item("w", "sweep - find the best reasoning budget");
  section("Manage models");
  item("f", "find on Hugging Face - search and add a new model");
  item("g", "get a quant - pick Q4/Q5/Q6… to download for this repo");
  item("D", "delete the selected model (frees disk, asks to confirm)");
  item("R", "rename the selected model (Enter saves, Esc cancels)");
  item("u", "reset the selected model's name to its default (asks to confirm)");
  section("Views");
  item("b", "benchmark mode - rank models, run the coding suite");
  item("l", "view the live Brain log");
  item("/", "filter the model list (Enter apply, Esc clear)");
  item("r", "rescan the models folder");
  item("?", "this help");
  item("C / t / J", "catalog / runtimes / jobs (cancel with x)");
  item("r", "after a failed save, confirm discarding the draft and reload");
  section("Anywhere");
  item("Esc", "leave logs / help / the current mode");
  item("q  Ctrl-C", "quit Otto Brain");

  const lines = [renderHeader(app, cols), ""];
  lines.push(
    ...box({
      title: "Help - every key and what it does",
      lines: rows,
      innerWidth: inner,
      footer: `${style.grey}esc or ? to go back${style.reset}`,
      accent: style.brightCyan,
    }),
  );
  app.renderFitted(lines);
}

function keybindings(app: App, cols: number): string[] {
  let groups: string[][][];
  if (app.renaming) {
    groups = [
      [
        ["type", "rename"],
        ["enter", "save"],
        ["esc", "cancel"],
      ],
    ];
  } else if (app.confirming) {
    const label = "confirm";
    groups = [
      [
        ["y", label],
        ["n", "cancel"],
      ],
    ];
  } else if (app.filterMode) {
    groups = [
      [
        ["type", "to filter"],
        ["enter", "apply"],
        ["esc", "clear & exit"],
      ],
    ];
  } else if (app.editing) {
    groups = [
      [
        ["0-9", "type value"],
        ["enter", "save"],
        ["esc", "cancel"],
      ],
    ];
  } else if (app.viewMode === "logs") {
    groups = [
      [
        ["esc", "back"],
        ["l", "back"],
        ["q", "quit"],
      ],
    ];
  } else if (app.viewMode === "help") {
    groups = [
      [
        ["esc", "back"],
        ["?", "back"],
        ["q", "quit"],
      ],
    ];
  } else if (app.viewMode === "bench") {
    groups = [
      [
        ["↑↓", "model"],
        ["r", "run benchmark"],
        ["x", "stop"],
        ["b", "serve mode"],
        ["q", "quit"],
      ],
    ];
  } else {
    groups = [
      // Navigation - line one.
      [
        ["↑↓", "select"],
        ["tab", "panel"],
        ["←→", "change"],
        ["enter", "edit"],
      ],
      // Actions - line two onward.
      [
        ["C", "catalog"],
        ["t", "runtimes"],
        ["J", "jobs"],
        ["s", "start"],
        ["x", "stop"],
        ["m", "max ctx"],
        ["c", "calibrate"],
        ["w", "sweep"],
        ["f", "find on HF"],
        ["g", "get quant"],
        ["D", "delete"],
        ["R", "rename"],
        ["u", "reset name"],
        ["b", "benchmarks"],
        ["l", "logs"],
        ["/", "filter"],
        ["r", "rescan"],
        ["?", "help"],
        ["q", "quit"],
      ],
    ];
  }

  const gap = "   ";
  const lines: string[] = [];
  for (const group of groups) {
    const cells = group.map(([key, label]) => {
      const action = app.actionForKey(key);
      const disabled = action !== null && !app.can(action);
      const color = disabled ? style.grey : style.brightCyan;
      return `${color}${key}${style.reset} ${style.grey}${label}${disabled ? " (unavailable)" : ""}${style.reset}`;
    });
    let line = "";
    for (const cell of cells) {
      const candidate = line ? `${line}${gap}${cell}` : cell;
      if (line && width(candidate) > cols) {
        lines.push(line);
        line = cell;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

function drawAuxiliary(app: App, cols: number): void {
  const rows = app.auxiliaryRows();
  app.auxiliaryIndex = Math.min(app.auxiliaryIndex, Math.max(0, rows.length - 1));
  const cap = Math.max(1, app.screen.rows - 13);
  const start = Math.max(0, app.auxiliaryIndex - cap + 1);
  const visible = rows
    .slice(start, start + cap)
    .map((row, index) =>
      index + start === app.auxiliaryIndex
        ? `${style.inverse}${truncate(row, cols - 5)}${style.reset}`
        : truncate(row, cols - 5),
    );
  if (!visible.length) visible.push("No entries reported by this host.");
  let hint = "↑↓ select";
  if (app.viewMode === "jobs")
    hint += app.can("job.cancel") ? " · x cancel job" : " · cancellation unavailable";
  if (app.viewMode === "catalog")
    hint += app.can("catalog.pull") ? " · enter download" : " · download unavailable";
  if (app.viewMode === "runtimes") {
    hint += app.can("runtime.install") ? " · enter install" : " · install unavailable";
    hint += app.can("runtime.select") ? "/select" : " · selection unavailable";
    hint += app.can("runtime.remove") ? " · D remove" : " · removal unavailable";
  }
  app.renderFitted([
    renderHeader(app, cols),
    "",
    ...box({ title: app.viewMode, lines: visible, innerWidth: cols - 4, accent: style.brightCyan }),
    "",
    ...statusPanel(app, cols - 2),
    "",
    app.confirming ? app.confirming.label + " y / n" : hint + " · r refresh · esc back · q quit",
  ]);
}

function benchmarkTaskDetails(app: App, rec: RunRecord): string[] {
  const lines: string[] = [];
  const conc = rec.tasks.find((t) => t.id === "concurrency");
  if (conc && conc.detail) {
    const detail = taskDetail(conc.detail);
    lines.push("");
    lines.push(`${style.grey}throughput @${detail.concurrency}${style.reset}`);
    lines.push(`  ${style.grey}gen${style.reset} ${(detail.genPerSecond ?? 0).toFixed(0)} tok/s`);
    lines.push(
      `  ${style.grey}prompt${style.reset} ${(detail.promptPerSecond ?? 0).toFixed(0)} tok/s`,
    );
  }

  // Peak context held by the long-horizon / agentic tasks. It rides in the
  // live run summary but is lost from the persisted scorecard otherwise, so
  // surface it here alongside throughput.
  const held = rec.tasks
    .map((t) => ({ task: t, detail: taskDetail(t.detail) }))
    .filter((x) => typeof x.detail?.contextUtilization === "number");
  if (held.length) {
    lines.push("");
    lines.push(`${style.grey}context held${style.reset}`);
    for (const { task, detail } of held) {
      const pct = Math.round((detail?.contextUtilization ?? 0) * 100);
      const peak = detail?.peakPromptTokens
        ? ` ${style.grey}${(detail.peakPromptTokens / 1000).toFixed(1)}k tok${style.reset}`
        : "";
      lines.push(
        `  ${style.grey}${pad(truncate(task.category, 14), 14)}${style.reset} ${app.scoreColour(1 - pct / 100)}${String(pct).padStart(3)}%${style.reset}${peak}`,
      );
    }
  }

  lines.push("");
  return lines;
}

function systemLines(app: App): string[] {
  const lines: string[] = [];
  // Live resource line: CPU, system RAM, GPU utilisation and VRAM.
  const sys = app.sys;
  if (sys) {
    const bits: string[] = [];
    if (typeof sys.cpu === "number") {
      bits.push(
        `${style.grey}cpu${style.reset} ${(sys.cpu * 100).toFixed(0).padStart(3)}%` +
          `${style.grey}/${sys.cpuCount}c${style.reset}`,
      );
    }
    bits.push(
      `${style.grey}ram${style.reset} ${formatGiB(sys.ramUsedBytes)}/${formatGiB(sys.ramTotalBytes)}`,
    );
    const gpuSample = sys.gpu;
    if (gpuSample) {
      if (gpuSample.utilization !== null) {
        const hot = gpuSample.utilization >= 90 ? style.brightGreen : style.reset;
        bits.push(
          `${style.grey}gpu${style.reset} ${hot}${String(gpuSample.utilization).padStart(3)}%${style.reset}`,
        );
      }
      bits.push(
        `${style.grey}vram${style.reset} ${gpuSample.usedBytes === null ? "usage unavailable · " : `${formatGiB(gpuSample.usedBytes)}/`}${formatGiB(gpuSample.totalBytes)}`,
      );
      if (typeof gpuSample.temperature === "number" && gpuSample.temperature > 0) {
        bits.push(`${style.grey}${gpuSample.temperature}C${style.reset}`);
      }
    }
    lines.push(bits.join("  "));

    const slotInfo = app.slotSummary();
    if (slotInfo) {
      const busyColour = slotInfo.busy > 0 ? style.brightGreen : style.grey;
      lines.push(
        `${style.grey}slots${style.reset} ${busyColour}${slotInfo.busy} busy${style.reset}` +
          `${style.grey} / ${slotInfo.total} total${style.reset}` +
          `${slotInfo.busy >= slotInfo.total ? `  ${style.brightYellow}saturated - further requests queue${style.reset}` : ""}`,
      );
    }
  }

  return lines;
}

function configurationFields(app: App): { content: string[]; focusLine: number } {
  const content: string[] = [];
  let focusLine = 0;
  const profile = app.profile;
  if (!profile) return { content, focusLine };
  const usable = app.usableFields();
  for (const index of usable) {
    const field = app.fields[index];
    const focused = app.focus === "config" && index === app.fieldIndex;
    const active = app.editing;
    const value =
      active && active.field.key === field.key
        ? `${style.brightYellow}${active.buffer}_${style.reset}`
        : field.format(profile);
    const arrow = focused ? `${style.brightCyan}›${style.reset}` : " ";
    if (focused) focusLine = content.length;
    content.push(`${arrow} ${pad(field.label, 17)} ${value}`);
    // The cachedChats estimate is a ProfileWarning, not a field note: it is
    // computed once in profile-edit.ts, colored by how much of the machine's
    // RAM it would take, and the app editor renders the very same object.
    const cachedWarning = app.row?.warnings.find((warning) => warning.field === field.key);
    const note = cachedWarning?.message;
    if (note) {
      const colors = { error: style.red, warn: style.yellow, info: style.grey };
      const tone = colors[cachedWarning?.severity ?? "info"];
      content.push(`  ${tone}  ${note}${style.reset}`);
    }
  }

  return { content, focusLine };
}

function sweepRows(app: App, innerWidth: number): string[] {
  const content: string[] = [];
  const sweepResult = app.sweepResult;
  if (sweepResult) {
    content.push("");
    content.push(`${style.grey}sweep results${style.reset}`);
    for (const r of sweepResult.results) {
      if (r.error) {
        content.push(
          `  ${String(r.budget).padStart(5)}  ${style.red}${truncate(r.error, innerWidth - 10)}${style.reset}`,
        );
        continue;
      }
      const best = r.budget === sweepResult.recommended;
      const mark = best ? `${style.brightGreen}✓${style.reset}` : " ";
      content.push(
        `  ${String(r.budget).padStart(5)} ${mark} ${(r.contentChars / 1024).toFixed(1).padStart(5)}KB  ` +
          `${r.filesDelivered}/4 files  ${(r.elapsedSeconds ?? 0).toFixed(0).padStart(3)}s`,
      );
    }
  }
  return content;
}
