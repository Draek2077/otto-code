// Released Otto 0.9.35 geometry and timing. No chat/session state lives here.
export const SPINNER_PERIOD_MS = 5600;
export const WOBBLE_PERIOD_MS = 1400;
export const PULSE_PERIOD_MS = 3000;
export const WOBBLE_AMPLITUDE = 0.045;
export type MotionKind = "spin-a" | "spin-b" | "wobble" | "halo";

export function motionFrame(kind: MotionKind, now: number) {
  "worklet";
  if (kind === "halo") {
    const phase = (now % PULSE_PERIOD_MS) / (PULSE_PERIOD_MS / 2);
    const t = phase <= 1 ? phase : 2 - phase;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    return {
      opacity: 0.68 + 0.32 * eased,
      scaleX: 0.9 + 0.1 * eased,
      scaleY: 0.9 + 0.1 * eased,
      rotate: 0,
    };
  }
  if (kind === "wobble") {
    const wave =
      Math.sin(((now % WOBBLE_PERIOD_MS) / WOBBLE_PERIOD_MS) * Math.PI * 2) * WOBBLE_AMPLITUDE;
    return { opacity: 1, scaleX: 1 + wave, scaleY: 1 - wave, rotate: 0 };
  }
  return {
    opacity: 1,
    scaleX: 1,
    scaleY: 1,
    rotate: ((now % SPINNER_PERIOD_MS) / SPINNER_PERIOD_MS) * 360 * (kind === "spin-a" ? 2 : 3),
  };
}

export function motionKeyframes(kind: MotionKind): {
  frames: Keyframe[];
  timing: KeyframeAnimationOptions;
} {
  if (kind === "halo") {
    const frames = Array.from({ length: 21 }, (_, index) => {
      const frame = motionFrame(kind, (index * PULSE_PERIOD_MS) / 40);
      return { offset: index / 20, opacity: frame.opacity, transform: `scale(${frame.scaleX})` };
    });
    return {
      frames,
      timing: { duration: PULSE_PERIOD_MS / 2, direction: "alternate", iterations: Infinity },
    };
  }
  if (kind === "wobble")
    return {
      frames: [0, 0.25, 0.5, 0.75, 1].map((offset) => {
        const frame = motionFrame(kind, offset * WOBBLE_PERIOD_MS);
        return {
          offset,
          transform: `scale(${frame.scaleX}, ${frame.scaleY})`,
          easing: "ease-in-out",
        };
      }),
      timing: { duration: WOBBLE_PERIOD_MS, iterations: Infinity },
    };
  return {
    frames: [
      { transform: "rotate(0deg)" },
      { transform: `rotate(${kind === "spin-a" ? 720 : 1080}deg)` },
    ],
    timing: { duration: SPINNER_PERIOD_MS, iterations: Infinity },
  };
}
