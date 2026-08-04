import fs from "node:fs";
import path from "node:path";

import * as results from "./results.js";
import type { DepthPoint, RunRecord, Stats, TaskColumn } from "./results.js";

/**
 * Renders stored benchmark runs as a self-contained HTML report.
 *
 * No external assets: a strict CSP environment must be able to open the file
 * offline, so every chart is inline SVG generated here and all CSS is local.
 *
 * Colour roles come from a validated categorical palette (four slots, checked
 * for CVD separation and lightness band in both light and dark surfaces). Three
 * light-mode slots fall below 3:1 against the light surface, so the relief rule
 * applies: every bar carries a visible direct label and a full table view ships
 * alongside the charts. Identity is never colour alone.
 */

const SERIES = [
  { light: "#2a78d6", dark: "#3987e5" },
  { light: "#eb6834", dark: "#d95926" },
  { light: "#1baf7a", dark: "#199e70" },
  { light: "#eda100", dark: "#c98500" },
];

// Two measures of different scale never share an axis, so latency and
// throughput are separate charts.
const LINE_SERIES_CAP = 3;

/** One series of depth-scaling points for a single model. */
interface DepthSeries {
  name: string;
  points: DepthPoint[];
}

/** Options controlling which measure a depth chart plots and how it formats. */
interface DepthChartOptions {
  valueOf: (p: DepthPoint) => number | undefined;
  label: string;
  unit: string;
  formatValue: (v: number) => string;
}

/** One point on the repeated-runs chart (x = run number). */
interface RunPoint {
  runIndex: number;
  score: number;
}

/** One series of repeated-run scores for a single model. */
interface RunSeries {
  name: string;
  points: RunPoint[];
}

/** A task column annotated with its score spread across runs. */
interface DiscriminationRow extends TaskColumn {
  spread: number | null;
  verdict: string;
  min?: number;
  max?: number;
}

function escapeHtml(text: string): string {
  return String(text).replace(
    /[&<>"']/g,
    (c) =>
      (
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<
          string,
          string
        >
      )[c],
  );
}

function formatGiB(bytes: number | null): string {
  return bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "-";
}

/**
 * Per-model score card: each task labelled directly with its weight, then the
 * weighted Overall on its own row so the headline number reads as the sum of its
 * parts. Every bar measures the same thing (a 0-100% score), so it is one hue
 * with a direct label - never the categorical palette, which is reserved for
 * distinguishing model series in the line charts and only defines four slots.
 * Colour-cycling it across a growing task list is what dropped later tasks
 * (extra-long-horizon) off the chart when they landed in an undefined slot.
 */
function groupedBars(
  records: RunRecord[],
  columns: TaskColumn[],
  weightOf: Map<string, number>,
): string {
  const rowHeight = 20;
  const barHeight = 12;
  const headerHeight = 30;
  const groupGap = 22;
  const labelWidth = 210;
  const chartWidth = 430;
  const valueGutter = 46;
  const width = labelWidth + chartWidth + valueGutter;
  const groupHeight = headerHeight + (columns.length + 1) * rowHeight + groupGap;
  const height = records.length * groupHeight + 8;

  const bar = (x: number, y: number, w: number, cls: string, title?: string): string =>
    `<rect x="${x}" y="${y}" width="${chartWidth}" height="${barHeight}" class="track"/>` +
    `<rect x="${x}" y="${y}" width="${Math.max(2, w).toFixed(1)}" height="${barHeight}" rx="4" class="${cls}">` +
    (title ? `<title>${title}</title>` : "") +
    `</rect>`;

  const parts: string[] = [];
  records.forEach((record, groupIndex) => {
    const top = groupIndex * groupHeight + 8;

    // Group header: model + config on the left, its overall score on the right.
    parts.push(
      `<text x="0" y="${top + 13}" class="grp">${escapeHtml(record.model.displayName.slice(0, 38))}</text>`,
    );
    const meta = [
      record.model.quant,
      `ctx ${(record.profile?.contextSize || 0).toLocaleString()}`,
      `rb ${record.profile?.reasoningBudget}`,
    ]
      .filter(Boolean)
      .join(" · ");
    parts.push(`<text x="0" y="${top + 26}" class="grpmeta">${escapeHtml(meta)}</text>`);
    parts.push(
      `<text x="${width}" y="${top + 15}" text-anchor="end" class="grpscore">${(record.overall * 100).toFixed(0)}%</text>`,
    );

    const bodyTop = top + headerHeight;
    columns.forEach((column, i) => {
      const task = record.tasks.find((t) => t.id === column.id);
      const score = task ? task.score : 0;
      const y = bodyTop + i * rowHeight;
      const weight = weightOf.get(column.id);
      const label = escapeHtml(column.category);
      parts.push(
        `<text x="0" y="${y + barHeight - 2}" class="tlabel">${label}</text>` +
          (weight
            ? `<text x="${labelWidth - 8}" y="${y + barHeight - 2}" text-anchor="end" class="twt">×${weight}</text>`
            : "") +
          bar(
            labelWidth,
            y,
            score * chartWidth,
            "scorebar",
            `${label}: ${(score * 100).toFixed(0)}%${weight ? ` (weight ${weight})` : ""} - ${escapeHtml(task ? task.summary : "not run")}`,
          ) +
          `<text x="${labelWidth + chartWidth + 8}" y="${y + barHeight - 2}" class="val">${task ? `${(score * 100).toFixed(0)}%` : "-"}</text>`,
      );
    });

    // The weighted Overall, set off by a divider so it reads as the sum of the
    // task rows above it rather than one more task.
    const oy = bodyTop + columns.length * rowHeight + 5;
    parts.push(`<line x1="0" y1="${oy - 3}" x2="${width}" y2="${oy - 3}" class="grid"/>`);
    parts.push(
      `<text x="0" y="${oy + barHeight - 2}" class="olabel">Overall</text>` +
        `<text x="${labelWidth - 8}" y="${oy + barHeight - 2}" text-anchor="end" class="twt">weighted</text>` +
        bar(labelWidth, oy, record.overall * chartWidth, "overallbar") +
        `<text x="${labelWidth + chartWidth + 8}" y="${oy + barHeight - 2}" class="oval">${(record.overall * 100).toFixed(0)}%</text>`,
    );
  });

  return (
    `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" ` +
    `aria-label="Task scores and weighted overall by model"><g>${parts.join("")}</g></svg>`
  );
}

/** Line chart for one measure across prompt depth. */
function depthChart(
  series: DepthSeries[],
  { valueOf, label, unit, formatValue }: DepthChartOptions,
): string {
  const width = 620;
  const height = 240;
  const pad = { top: 16, right: 18, bottom: 34, left: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const points = series.flatMap((s) => s.points);
  const xs = points.map((p) => p.promptTokens || 0);
  const ys = points.map(valueOf).filter((v): v is number => typeof v === "number");
  if (!ys.length) return `<p class="empty">No ${escapeHtml(label)} data recorded.</p>`;

  const xMax = Math.max(...xs, 1);
  const yMax = Math.max(...ys, 1) * 1.15;
  const sx = (x: number): number => pad.left + (x / xMax) * plotW;
  const sy = (y: number): number => pad.top + plotH - (y / yMax) * plotH;

  const parts: string[] = [];

  // Recessive grid and axis.
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i;
    const value = yMax - (yMax / 4) * i;
    parts.push(
      `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="grid"/>`,
    );
    parts.push(
      `<text x="${pad.left - 8}" y="${y + 4}" class="tick" text-anchor="end">${formatValue(value)}</text>`,
    );
  }
  parts.push(
    `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${width - pad.right}" y2="${pad.top + plotH}" class="axis"/>`,
  );

  for (let i = 0; i <= 3; i += 1) {
    const x = pad.left + (plotW / 3) * i;
    const value = (xMax / 3) * i;
    parts.push(
      `<text x="${x}" y="${height - 12}" class="tick" text-anchor="middle">` +
        `${value >= 1000 ? `${Math.round(value / 1000)}k` : Math.round(value)}</text>`,
    );
  }

  series.forEach((s, i) => {
    const ordered = [...s.points].sort((a, b) => (a.promptTokens || 0) - (b.promptTokens || 0));
    const d = ordered
      .filter((p) => typeof valueOf(p) === "number")
      .map(
        (p, j) =>
          `${j === 0 ? "M" : "L"}${sx(p.promptTokens || 0).toFixed(1)},${sy(valueOf(p) as number).toFixed(1)}`,
      )
      .join(" ");
    parts.push(
      `<path d="${d}" fill="none" stroke="var(--series-${i + 1})" stroke-width="2" ` +
        `stroke-linejoin="round" stroke-linecap="round"/>`,
    );

    for (const p of ordered) {
      const v = valueOf(p);
      if (typeof v !== "number") continue;
      // 2px surface ring keeps overlapping markers separable.
      parts.push(
        `<circle cx="${sx(p.promptTokens || 0).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="4.5" ` +
          `fill="var(--series-${i + 1})" stroke="var(--surface-1)" stroke-width="2">` +
          `<title>${escapeHtml(s.name)} - ${(p.promptTokens || 0).toLocaleString()} tokens: ` +
          `${formatValue(v)} ${escapeHtml(unit)}</title></circle>`,
      );
    }
  });

  return (
    `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" ` +
    `aria-label="${escapeHtml(label)} against prompt depth">${parts.join("")}</svg>`
  );
}

/** Overall score across repeated runs (x = run number, not wall time). */
function runsChart(series: RunSeries[]): string {
  const width = 620;
  const height = 240;
  const pad = { top: 16, right: 18, bottom: 34, left: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxRun = Math.max(2, ...series.flatMap((s) => s.points.map((p) => p.runIndex)));
  const sx = (x: number): number => pad.left + ((x - 1) / (maxRun - 1)) * plotW;
  const sy = (y: number): number => pad.top + plotH - Math.max(0, Math.min(1, y)) * plotH;

  const parts: string[] = [];
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i;
    parts.push(
      `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="grid"/>`,
    );
    parts.push(
      `<text x="${pad.left - 8}" y="${y + 4}" class="tick" text-anchor="end">${100 - 25 * i}%</text>`,
    );
  }
  parts.push(
    `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${width - pad.right}" y2="${pad.top + plotH}" class="axis"/>`,
  );
  for (let r = 1; r <= maxRun; r += 1) {
    parts.push(
      `<text x="${sx(r).toFixed(1)}" y="${height - 12}" class="tick" text-anchor="middle">${r}</text>`,
    );
  }

  series.forEach((s, i) => {
    const ordered = [...s.points].sort((a, b) => a.runIndex - b.runIndex);
    const d = ordered
      .map((p, j) => `${j === 0 ? "M" : "L"}${sx(p.runIndex).toFixed(1)},${sy(p.score).toFixed(1)}`)
      .join(" ");
    parts.push(
      `<path d="${d}" fill="none" stroke="var(--series-${i + 1})" stroke-width="2" ` +
        `stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    for (const p of ordered) {
      parts.push(
        `<circle cx="${sx(p.runIndex).toFixed(1)}" cy="${sy(p.score).toFixed(1)}" r="4.5" ` +
          `fill="var(--series-${i + 1})" stroke="var(--surface-1)" stroke-width="2">` +
          `<title>${escapeHtml(s.name)} - run ${p.runIndex}: ${(p.score * 100).toFixed(0)}%</title></circle>`,
      );
    }
  });

  return (
    `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" ` +
    `aria-label="Overall score across repeated runs">${parts.join("")}</svg>`
  );
}

function legend(items: string[]): string {
  return `<div class="legend">${items
    .map(
      (item, i) =>
        `<span class="lg"><i style="background:var(--series-${i + 1})"></i>${escapeHtml(item)}</span>`,
    )
    .join("")}</div>`;
}

/**
 * A task whose scores barely differ across models carries no information,
 * however good it looks. Measuring that spread here keeps a saturated task from
 * quietly inflating every model's overall score.
 */
function discrimination(records: RunRecord[], columns: TaskColumn[]): DiscriminationRow[] {
  return columns.map((column): DiscriminationRow => {
    const scores = records
      .map((r) => r.tasks.find((t) => t.id === column.id))
      .filter((t): t is RunRecord["tasks"][number] => Boolean(t))
      .map((t) => t.score);
    if (scores.length < 2) return { ...column, spread: null, verdict: "insufficient data" };
    const spread = Math.max(...scores) - Math.min(...scores);
    let verdict = "discriminating";
    if (spread < 0.05) verdict = "saturated";
    else if (spread < 0.15) verdict = "weak";
    return { ...column, spread, verdict, min: Math.min(...scores), max: Math.max(...scores) };
  });
}

function statTile(label: string, value: string | number, note: string): string {
  return (
    `<div class="tile"><div class="tl">${escapeHtml(label)}</div>` +
    `<div class="tv">${escapeHtml(String(value))}</div>` +
    `<div class="tn">${escapeHtml(note || "")}</div></div>`
  );
}

function build(records: RunRecord[], allRuns: RunRecord[] = records): string {
  if (!records.length) {
    return "<h1>No benchmark results yet</h1><p>Run <code>node src/index.js bench --model &lt;name&gt;</code> first.</p>";
  }

  const columns = results.taskColumns(records);
  const ranked = [...records].sort((a, b) => b.overall - a.overall);
  const best = ranked[0];

  // Overall is a weighted mean of the task scores (see bench/index.ts runSuite);
  // the report has to carry the weights or the headline number cannot be
  // reconciled with the per-task bars. Weight is persisted per task, so read it
  // from the records rather than re-importing the task table.
  const weightOf = new Map<string, number>();
  for (const record of records) {
    for (const task of record.tasks) if (!weightOf.has(task.id)) weightOf.set(task.id, task.weight);
  }

  // Consistency: how much the same config's overall score moves across reruns.
  const groups = results.grouped(allRuns);
  const meanOverall = (g: results.Group): number =>
    g.runs.reduce((a, r) => a + r.overall, 0) / g.runs.length;
  const repeated = groups
    .filter((g) => g.count > 1)
    .sort((a, b) => meanOverall(b) - meanOverall(a));
  const consistencySeries: RunSeries[] = repeated.slice(0, LINE_SERIES_CAP).map(
    (g): RunSeries => ({
      name: g.model.displayName,
      points: g.runs.map((r) => ({ runIndex: r.runIndex ?? 0, score: r.overall })),
    }),
  );
  const varianceRows = results.variance(allRuns);
  const healthRows = ranked.filter((r) => r.system && r.system.samples);

  // Depth series come from the depth-scaling task detail.
  const depthSeries: DepthSeries[] = ranked
    .slice(0, LINE_SERIES_CAP)
    .map((r): DepthSeries => {
      const task = r.tasks.find((t) => t.id === "context-depth");
      return {
        name: r.model.displayName,
        points: Array.isArray(task?.detail) ? (task?.detail as DepthPoint[]) : [],
      };
    })
    .filter((s) => s.points.length);

  const fastest = ranked
    .flatMap((r) => (r.tasks.find((t) => t.id === "context-depth")?.detail || []) as DepthPoint[])
    .reduce((max, p) => Math.max(max, p.generatePerSecond || 0), 0);

  const tableRows = ranked
    .map((r) => {
      const cells = columns
        .map((c) => {
          const task = r.tasks.find((t) => t.id === c.id);
          return `<td class="num">${task ? `${(task.score * 100).toFixed(0)}%` : "-"}</td>`;
        })
        .join("");
      return (
        `<tr><td>${escapeHtml(r.model.displayName)}</td><td>${escapeHtml(r.model.quant || "-")}</td>` +
        `<td class="num">${(r.profile?.contextSize || 0).toLocaleString()}</td>` +
        `<td class="num">${r.profile?.reasoningBudget ?? "-"}</td>` +
        `${cells}<td class="num strong">${(r.overall * 100).toFixed(0)}%</td>` +
        `<td class="num">${formatGiB(r.vramBytes)}</td>` +
        `<td class="muted">${escapeHtml(r.ranAt.slice(0, 16).replace("T", " "))}</td></tr>`
      );
    })
    .join("");

  const spreads = discrimination(ranked, columns);
  const saturated = spreads.filter((s) => s.verdict === "saturated");

  const notes: string[] = [];
  if (depthSeries.length && ranked.length > LINE_SERIES_CAP) {
    notes.push(
      `Depth charts show the top ${LINE_SERIES_CAP} models by overall score; ` +
        `${ranked.length - LINE_SERIES_CAP} further run(s) are in the table.`,
    );
  }
  if (records.some((r) => !r.executedCode)) {
    notes.push(
      "Some runs did not execute generated tests, so their long-horizon score is compile-only.",
    );
  }

  return `
<div class="viz-root">
  <header>
    <h1>Agentic coding scorecard</h1>
    <p class="sub">Locally measured on ${escapeHtml(best.gpu?.name || "this machine")}${
      best.runtime ? ` · llama.cpp ${escapeHtml(best.runtime)}` : ""
    }</p>
  </header>

  <section class="tiles">
    ${statTile("Best model", best.model.displayName.slice(0, 26), `${(best.overall * 100).toFixed(0)}% - ${best.grade}`)}
    ${statTile("Runs recorded", records.length, `${columns.length} task categories`)}
    ${statTile("Peak generation", fastest ? `${fastest.toFixed(0)} tok/s` : "-", "at shallowest depth measured")}
    ${statTile("VRAM at load", formatGiB(best.vramBytes), best.loadSeconds ? `loaded in ${best.loadSeconds.toFixed(1)}s` : "")}
  </section>

  <section class="card">
    <h2>Scores by task</h2>
    <p class="cap">Each row is one task, scored 0–100% from objectively verifiable outcomes - tool calls
      checked against expected name and arguments, generated code compiled and its tests executed. The
      <b>×N</b> after a task is its weight. <b>Overall</b> is the weighted mean of the task scores,
      <span class="mono">Σ(score × weight) ÷ Σ(weight)</span> - so a heavier task moves the headline
      number more, and it is not the plain average of the bars above it.</p>
    ${groupedBars(ranked, columns, weightOf)}
  </section>

  ${
    depthSeries.length
      ? `
  <section class="card">
    <h2>Latency against prompt depth</h2>
    <p class="cap">Time to first token as the prompt grows. Agent loops resend large prefixes,
      so behaviour at depth matters more than on an empty context.</p>
    ${legend(depthSeries.map((s) => s.name.slice(0, 30)))}
    ${depthChart(depthSeries, {
      valueOf: (p) => p.ttftSeconds,
      label: "Time to first token",
      unit: "seconds",
      formatValue: (v) => `${v.toFixed(1)}s`,
    })}
    <p class="axl">prompt tokens</p>
  </section>

  <section class="card">
    <h2>Throughput against prompt depth</h2>
    <p class="cap">Generation speed at the same depths. A collapse here usually means the KV cache
      spilled out of VRAM - the failure this tool's budget check exists to prevent.</p>
    ${legend(depthSeries.map((s) => s.name.slice(0, 30)))}
    ${depthChart(depthSeries, {
      valueOf: (p) => p.generatePerSecond,
      label: "Generation throughput",
      unit: "tokens per second",
      formatValue: (v) => v.toFixed(0),
    })}
    <p class="axl">prompt tokens</p>
  </section>`
      : ""
  }

  <section class="card">
    <h2>Does each task actually tell us anything?</h2>
    <p class="cap">A task every model passes cannot rank them, however hard it looks. This is the
      score spread across all runs - low spread means the task is saturated and its contribution to
      the overall figure is inflating everyone equally. The weight is how hard that task pulls on the
      overall score, so a saturated <em>heavy</em> task matters most.</p>
    <div class="scroll">
      <table>
        <thead><tr><th>Task</th><th class="num">Weight</th><th class="num">Lowest</th><th class="num">Highest</th>
          <th class="num">Spread</th><th>Verdict</th></tr></thead>
        <tbody>${spreads
          .map((s) => {
            const tone = s.verdict === "saturated" ? "bad" : s.verdict === "weak" ? "warn" : "good";
            return (
              `<tr><td>${escapeHtml(s.category)}</td>` +
              `<td class="num">×${weightOf.get(s.id) ?? "?"}</td>` +
              `<td class="num">${s.min === undefined ? "-" : `${(s.min * 100).toFixed(0)}%`}</td>` +
              `<td class="num">${s.max === undefined ? "-" : `${(s.max * 100).toFixed(0)}%`}</td>` +
              `<td class="num strong">${s.spread === null ? "-" : `${(s.spread * 100).toFixed(0)} pts`}</td>` +
              `<td class="v-${tone}">${escapeHtml(s.verdict)}</td></tr>`
            );
          })
          .join("")}</tbody>
      </table>
    </div>
    ${
      saturated.length
        ? `<ul class="notes"><li><strong>${saturated.map((s) => escapeHtml(s.category)).join(", ")}</strong>
      ${saturated.length === 1 ? "is" : "are"} saturated - every model scores the same, so
      ${saturated.length === 1 ? "it needs" : "they need"} to get harder before
      ${saturated.length === 1 ? "it" : "they"} can contribute to a ranking.</li></ul>`
        : ""
    }
  </section>

  <section class="card">
    <h2>Is the benchmark consistent?</h2>
    <p class="cap">The same model + settings, measured more than once. A method you can trust holds a
      flat line across runs; a jagged one means the score is noisy and small gaps between models are
      not real. Runs are numbered, not dated - only how many times we have measured matters.</p>
    ${
      consistencySeries.length
        ? `
      ${legend(consistencySeries.map((s) => s.name.slice(0, 30)))}
      ${runsChart(consistencySeries)}
      <p class="axl">run number</p>`
        : `
      <p class="empty">No config has been run more than once yet. Re-run a model a few times to see
      its spread - the table below shows mean ± spread as repeats accumulate.</p>`
    }
    <div class="scroll">
      <table>
        <thead><tr><th>Model</th><th class="num">Runs</th><th class="num">Mean</th>
          <th class="num">± spread</th><th class="num">Range</th></tr></thead>
        <tbody>${varianceRows
          .map((v) => {
            const o: Partial<Stats> = v.overall || {};
            const spreadPts = (o.std ?? 0) * 100;
            const tone = v.count < 2 ? "muted" : spreadPts > 8 ? "v-warn" : "v-good";
            return (
              `<tr><td>${escapeHtml(v.model.displayName)}</td>` +
              `<td class="num">${v.count}</td>` +
              `<td class="num strong">${o.mean === undefined ? "-" : `${(o.mean * 100).toFixed(0)}%`}</td>` +
              `<td class="num ${tone}">${v.count < 2 ? "-" : `${spreadPts.toFixed(1)} pts`}</td>` +
              `<td class="num">${v.count < 2 ? "-" : `${((o.min ?? 0) * 100).toFixed(0)}–${((o.max ?? 0) * 100).toFixed(0)}%`}</td></tr>`
            );
          })
          .join("")}</tbody>
      </table>
    </div>
  </section>

  ${
    healthRows.length
      ? `
  <section class="card">
    <h2>System health during runs</h2>
    <p class="cap">The machine state each score was measured under. A throttled or power-capped run is
      slower and lower for reasons that have nothing to do with the model - read those scores with
      suspicion, or re-run them once the GPU has cooled.</p>
    <div class="scroll">
      <table>
        <thead><tr><th>Model</th><th class="num">Peak temp</th><th class="num">Avg power</th>
          <th class="num">Avg GPU</th><th class="num">Peak VRAM</th><th>Throttled</th></tr></thead>
        <tbody>${healthRows
          .map((r) => {
            const h = r.system as results.SystemHealth;
            const throttled = h.thermalThrottle || h.powerThrottle;
            const label = h.thermalThrottle ? "thermal" : h.powerThrottle ? "power" : "no";
            return (
              `<tr><td>${escapeHtml(r.model.displayName)}</td>` +
              `<td class="num">${h.tempC ? `${h.tempC.max}°C` : "-"}</td>` +
              `<td class="num">${h.powerW ? `${h.powerW.avg.toFixed(0)} W` : "-"}</td>` +
              `<td class="num">${h.gpuUtilPct ? `${h.gpuUtilPct.avg.toFixed(0)}%` : "-"}</td>` +
              `<td class="num">${h.vramUsedMiB ? `${(h.vramUsedMiB.max / 1024).toFixed(1)} GB` : "-"}</td>` +
              `<td class="${throttled ? "v-bad" : "v-good"}">${throttled ? `⚠ ${label}` : "no"}</td></tr>`
            );
          })
          .join("")}</tbody>
      </table>
    </div>
  </section>`
      : ""
  }

  <section class="card">
    <h2>All runs</h2>
    <div class="scroll">
      <table>
        <thead><tr><th>Model</th><th>Quant</th><th class="num">Context</th><th class="num">Reasoning</th>
          ${columns.map((c) => `<th class="num">${escapeHtml(c.category)}<span class="wt">×${weightOf.get(c.id) ?? "?"}</span></th>`).join("")}
          <th class="num">Overall<span class="wt">wtd</span></th><th class="num">VRAM</th><th>Run at</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : ""}
  </section>
</div>`;
}

const STYLE = `
<style>
.viz-root{
  color-scheme:light;
  --surface-1:#fcfcfb; --plane:#f9f9f7;
  --text-primary:#0b0b0b; --text-secondary:#52514e; --muted:#898781;
  --grid:#e1e0d9; --axis:#c3c2b7; --border:rgba(11,11,11,0.10);
  --series-1:#2a78d6; --series-2:#eb6834; --series-3:#1baf7a; --series-4:#eda100;
  background:var(--plane); color:var(--text-primary);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
  max-width:1000px; margin:0 auto; padding:28px 20px 56px;
}
@media (prefers-color-scheme:dark){
  :root:where(:not([data-theme="light"])) .viz-root{
    color-scheme:dark;
    --surface-1:#1a1a19; --plane:#0d0d0d;
    --text-primary:#ffffff; --text-secondary:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,0.10);
    --series-1:#3987e5; --series-2:#d95926; --series-3:#199e70; --series-4:#c98500;
  }
}
:root[data-theme="dark"] .viz-root{
  color-scheme:dark;
  --surface-1:#1a1a19; --plane:#0d0d0d;
  --text-primary:#ffffff; --text-secondary:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,0.10);
  --series-1:#3987e5; --series-2:#d95926; --series-3:#199e70; --series-4:#c98500;
}
h1{font-size:1.55rem;margin:0 0 4px;letter-spacing:-0.01em}
h2{font-size:1.02rem;margin:0 0 4px}
.sub{color:var(--text-secondary);margin:0 0 22px;font-size:.88rem}
.cap{color:var(--text-secondary);font-size:.82rem;margin:0 0 14px;max-width:66ch;line-height:1.45}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.tile{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.tl{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.tv{font-size:1.5rem;font-weight:600;margin:4px 0 2px;line-height:1.15}
.tn{font-size:.76rem;color:var(--text-secondary)}
.card{background:var(--surface-1);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:16px}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:12px}
.lg{display:inline-flex;align-items:center;gap:6px;font-size:.78rem;color:var(--text-secondary)}
.lg i{width:11px;height:11px;border-radius:3px;display:inline-block;flex:none}
svg{display:block;overflow:visible}
.grp{font-size:11.5px;font-weight:600;fill:var(--text-primary)}
.grpmeta{font-size:10px;fill:var(--muted)}
.grpscore{font-size:13px;font-weight:700;fill:var(--text-primary);font-variant-numeric:tabular-nums}
.track{fill:var(--grid)}
.val{font-size:10.5px;fill:var(--text-secondary);font-variant-numeric:tabular-nums}
.tlabel{font-size:11px;fill:var(--text-secondary)}
.twt{font-size:9.5px;fill:var(--muted);font-variant-numeric:tabular-nums}
.scorebar{fill:var(--series-1)}
.overallbar{fill:var(--series-1);stroke:var(--text-primary);stroke-width:.75}
.olabel{font-size:11px;font-weight:600;fill:var(--text-primary)}
.oval{font-size:11px;font-weight:700;fill:var(--text-primary);font-variant-numeric:tabular-nums}
.grid{stroke:var(--grid);stroke-width:1}
.axis{stroke:var(--axis);stroke-width:1}
.tick{font-size:10px;fill:var(--muted);font-variant-numeric:tabular-nums}
.axl{text-align:center;font-size:.74rem;color:var(--muted);margin:6px 0 0}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.8rem}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
th{font-size:.71rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}
.strong{font-weight:600}
.muted{color:var(--muted)}
.mono{font-family:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;font-size:.78rem;background:var(--plane);border:1px solid var(--border);border-radius:4px;padding:1px 5px;white-space:nowrap}
.wt{color:var(--muted);font-weight:400;font-size:.72em;margin-left:4px}
.notes{margin:12px 0 0;padding-left:18px;color:var(--text-secondary);font-size:.78rem}
.empty{color:var(--muted);font-size:.82rem}
.v-good{color:var(--text-secondary)}
.v-warn{color:#ec835a;font-weight:600}
.v-bad{color:#d03b3b;font-weight:600}
circle:hover{r:6}
rect[fill^="var"]:hover{opacity:.82}
</style>`;

/** Write the report and return its path. */
function write(outFile?: string): { file: string; count: number } {
  const allRuns = results.loadAll();
  const records = results.latestPerConfig(allRuns);
  const html = `${STYLE}\n${build(records, allRuns)}`;
  const target = outFile || path.join(results.RESULTS_DIR, "report.html");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, "utf8");
  return { file: target, count: records.length };
}

export { write, build, STYLE, SERIES };
