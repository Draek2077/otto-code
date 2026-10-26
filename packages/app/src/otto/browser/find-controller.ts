import { buildPageFindScript, type PageFindRequest, type PageFindResult } from "./page-find";

export interface FindableGuest {
  executeJavaScript?: (code: string) => Promise<unknown>;
}
export type PageFindOptions = Pick<
  PageFindRequest,
  "matchCase" | "matchDiacritics" | "wholeWords" | "highlightAll"
>;
export const DEFAULT_FIND_OPTIONS: PageFindOptions = {
  matchCase: false,
  matchDiacritics: false,
  wholeWords: false,
  highlightAll: true,
};
const EMPTY_RESULT: PageFindResult = { current: 0, total: 0, limited: false };
export function readPageFindResult(raw: unknown): PageFindResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const current: unknown = Reflect.get(raw, "current"),
    total: unknown = Reflect.get(raw, "total"),
    limited: unknown = Reflect.get(raw, "limited");
  if (
    typeof current !== "number" ||
    !Number.isInteger(current) ||
    current < 0 ||
    typeof total !== "number" ||
    !Number.isInteger(total) ||
    total < 0 ||
    total > 10000 ||
    current > total ||
    (total > 0 && current === 0) ||
    typeof limited !== "boolean"
  )
    return null;
  return { current, total, limited };
}
export interface PageFindState {
  query: string;
  options: PageFindOptions;
  result: PageFindResult;
  error: boolean;
}
/** Local find intent only. All evaluation uses the pane's existing guest; no browser is created. */
export class PageFindController {
  private state: PageFindState = {
    query: "",
    options: DEFAULT_FIND_OPTIONS,
    result: EMPTY_RESULT,
    error: false,
  };
  private readonly listeners = new Set<() => void>();
  private activation: object | null = null;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private lastGuest: FindableGuest | null = null;
  constructor(private readonly guest: () => FindableGuest | null) {}
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<PageFindState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    const activation = {};
    this.activation = activation;
    const initialGuest = this.guest();
    return () => {
      if (this.activation !== activation) return;
      this.activation = null;
      this.sequence++;
      clearTimeout(this.timer);
      // Capture this guest before queuing cleanup. A later tab must never be cleared.
      const guest = this.lastGuest ?? initialGuest;
      this.queue = this.queue.then(async () => {
        try {
          await guest?.executeJavaScript?.(
            buildPageFindScript({ query: "", ...DEFAULT_FIND_OPTIONS, direction: 0 }),
          );
        } catch {
          /* A destroyed or navigating guest has no surviving highlight to clear. */
        }
        return undefined;
      });
    };
  }
  setQuery(query: string) {
    this.publish({ query: query.slice(0, 2048), result: EMPTY_RESULT, error: false });
    this.schedule();
  }
  setOption(name: keyof PageFindOptions, value: boolean) {
    this.publish({
      options: { ...this.state.options, [name]: value },
      result: EMPTY_RESULT,
      error: false,
    });
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    this.sequence++;
    if (this.activation) this.timer = setTimeout(() => this.run(0), 150);
  }
  readonly refresh = () => this.run(0);
  run(direction: PageFindRequest["direction"]) {
    clearTimeout(this.timer);
    const activation = this.activation;
    if (!activation) return;
    const sequence = direction === 0 ? ++this.sequence : this.sequence,
      guest = this.guest();
    this.lastGuest = guest;
    const request: PageFindRequest = { query: this.state.query, ...this.state.options, direction };
    this.queue = this.queue.then(async () => {
      if (this.activation !== activation || sequence !== this.sequence) return undefined;
      try {
        if (!guest?.executeJavaScript) throw new Error("No guest evaluation port");
        const result = readPageFindResult(
          await guest.executeJavaScript(buildPageFindScript(request)),
        );
        if (!result) throw new Error("Invalid guest result");
        if (this.activation === activation && sequence === this.sequence)
          this.publish({ result, error: false });
      } catch {
        if (this.activation === activation && sequence === this.sequence)
          this.publish({ result: EMPTY_RESULT, error: true });
      }
      return undefined;
    });
  }
}
