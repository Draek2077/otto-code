interface Point {
  x: number;
  y: number;
}

export interface PendingTap {
  point: Point;
  timer: ReturnType<typeof setTimeout>;
}

interface TapState {
  current: PendingTap | null;
}
type SendTap = (point: Point, clickCount: 1 | 2) => void;

export function cancelHostedTap(state: TapState): void {
  if (state.current) clearTimeout(state.current.timer);
  state.current = null;
}

/** Delay a single click until a second press can be recognized as one host double click. */
export function queueHostedTap(state: TapState, point: Point, send: SendTap): void {
  const previous = state.current;
  if (previous) {
    cancelHostedTap(state);
    if (Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= 24) {
      send(point, 2);
      return;
    }
    send(previous.point, 1);
  }
  const timer = setTimeout(() => {
    state.current = null;
    send(point, 1);
  }, 300);
  state.current = { point, timer };
}
