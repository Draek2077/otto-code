export interface WakeWordDetectorTuning {
  maxActivePaths: number;
  numTrailingBlanks: number;
  keywordsScore: number;
  keywordsThreshold: number;
}

/**
 * Map the user-facing sensitivity to Sherpa's two independent KWS controls.
 * A larger score keeps the keyword path alive during beam search, while a
 * lower threshold makes the surviving path easier to trigger.
 */
export function resolveWakeWordDetectorTuning(sensitivity: number): WakeWordDetectorTuning {
  const normalized = Number.isFinite(sensitivity) ? Math.max(0, Math.min(1, sensitivity)) : 0.7;
  return {
    maxActivePaths: 4,
    numTrailingBlanks: 1,
    keywordsScore: 1.5 + normalized * 1.5,
    keywordsThreshold: 0.24 - normalized * 0.14,
  };
}
