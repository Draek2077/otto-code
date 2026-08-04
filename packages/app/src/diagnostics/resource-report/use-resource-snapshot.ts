import { useEffect, useState } from "react";

import { analyzeResourceTrend, type MetricTrend, type ResourceSample } from "./resource-trend";
import { resourceMonitor } from "./resource-monitor";

export interface ResourceSnapshot {
  latest: ResourceSample | null;
  /** Wall time covered by the retained series. */
  elapsedMs: number;
  samples: number;
  /** The worst monotonic climber, or null when nothing is growing. */
  topGrowth: MetricTrend | null;
  running: boolean;
}

const EMPTY_SNAPSHOT: ResourceSnapshot = {
  latest: null,
  elapsedMs: 0,
  samples: 0,
  topGrowth: null,
  running: false,
};

/**
 * Live view of the resource monitor for UI surfaces.
 *
 * Re-renders once per census tick (10s by default), not per frame - a readout
 * that repainted every frame would be measuring itself. The trend fit runs on
 * the same tick because it is over at most a few thousand samples of plain
 * numbers, which is cheaper than the census that produced them.
 */
export function useResourceSnapshot(): ResourceSnapshot {
  const [snapshot, setSnapshot] = useState<ResourceSnapshot>(() => buildSnapshot());

  useEffect(() => {
    setSnapshot(buildSnapshot());
    return resourceMonitor.subscribe(() => {
      setSnapshot(buildSnapshot());
    });
  }, []);

  return snapshot;
}

function buildSnapshot(): ResourceSnapshot {
  const samples = resourceMonitor.getSamples();
  if (samples.length === 0) {
    return { ...EMPTY_SNAPSHOT, running: resourceMonitor.running };
  }
  const trend = analyzeResourceTrend(samples);
  return {
    latest: samples[samples.length - 1],
    elapsedMs: trend.elapsedMs,
    samples: samples.length,
    topGrowth: trend.growing[0] ?? null,
    running: resourceMonitor.running,
  };
}
