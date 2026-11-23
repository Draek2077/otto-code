import { useEffect, useState } from "react";

export type ReadState<T> =
  | { status: "loading"; previous?: T }
  | { status: "ready"; value: T }
  | { status: "error"; message: string; previous?: T };

function lastValue<T>(state: ReadState<T>): T | undefined {
  return state.status === "ready" ? state.value : state.previous;
}

export function useRead<T>(input: {
  key: string;
  // Only matching scopes may retain a prior result during a refresh. Host and
  // project changes must never display another resource's previous data.
  scope?: string;
  enabled: boolean;
  load(): Promise<T>;
  errorMessage: string;
}): ReadState<T> {
  const [current, setCurrent] = useState<{ key: string; scope: string; result: ReadState<T> }>({
    key: "",
    scope: "",
    result: { status: "loading" },
  });
  const { key, enabled, load, errorMessage } = input;
  const scope = input.scope ?? key;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    setCurrent((previous) => ({
      key,
      scope,
      result: {
        status: "loading",
        previous: previous.scope === scope ? lastValue(previous.result) : undefined,
      },
    }));
    async function read() {
      try {
        const value = await load();
        if (!disposed) setCurrent({ key, scope, result: { status: "ready", value } });
      } catch {
        if (!disposed)
          setCurrent((previous) => ({
            key,
            scope,
            result: {
              status: "error",
              message: errorMessage,
              previous: previous.scope === scope ? lastValue(previous.result) : undefined,
            },
          }));
      }
    }
    void read();
    return () => {
      disposed = true;
    };
  }, [key, scope, enabled, load, errorMessage]);
  return current.key === key
    ? current.result
    : {
        status: "loading",
        previous: current.scope === scope ? lastValue(current.result) : undefined,
      };
}
