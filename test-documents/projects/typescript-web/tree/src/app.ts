import { formatNumber, percentChange, trendOf, type Metric } from "./format.ts";
import { sparklineSvg } from "./sparkline.ts";

const METRICS: readonly Metric[] = [
  { id: "p50", label: "p50 latency", unit: "ms", samples: [82, 79, 84, 81, 78, 80, 77] },
  { id: "p95", label: "p95 latency", unit: "ms", samples: [210, 224, 219, 231, 248, 266, 301] },
  { id: "p99", label: "p99 latency", unit: "ms", samples: [540, 532, 549, 541, 538, 545, 536] },
  { id: "err", label: "error rate", unit: "%", samples: [0.4, 0.5, 0.4, 0.3, 0.3, 0.2, 0.2] },
];

export function renderCard(metric: Metric): string {
  const latest = metric.samples[metric.samples.length - 1] ?? 0;
  const trend = trendOf(metric.samples);
  return [
    `<article class="card">`,
    `<p class="card__label">${metric.label}</p>`,
    `<p class="card__value">${formatNumber(latest, metric.unit)}`,
    ` <span class="card__delta" data-trend="${trend}">${percentChange(metric.samples)}</span></p>`,
    `<div class="card__spark">${sparklineSvg(metric)}</div>`,
    `</article>`,
  ].join("");
}

export function renderAll(metrics: readonly Metric[] = METRICS): string {
  return metrics.map(renderCard).join("");
}

// Guarded so the module stays importable from Node for tests: `document` only
// exists in the browser, and a bare reference would throw at import time.
if (typeof document !== "undefined") {
  const host = document.querySelector("#metrics");
  if (host) {
    host.innerHTML = renderAll();
  }
}
