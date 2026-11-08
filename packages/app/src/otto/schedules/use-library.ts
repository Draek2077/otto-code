import { useCallback, useEffect, useRef, useState } from "react";
import { useFetchQuery } from "@/data/query";
import type { ScheduleScope } from "@getpaseo/plugin/otto/schedules";
import type { ScheduleApi } from "./api";
import { useScheduleActivity } from "./activity";

/** One canonical query cache, observed only while mounted. A failed watch stops;
 * reconnect/refetch is explicit. No timer, new socket or mutation retry. */
export function useScheduleLibrary(
  api: ScheduleApi,
  scope: ScheduleScope,
  input: {
    query: string;
    status?: "active" | "paused" | "completed";
    offset: number;
    diagnosticOffset: number;
  },
) {
  const active = useScheduleActivity();
  const [watchError, setWatchError] = useState("");
  const [watchAttempt, setWatchAttempt] = useState(0);
  const page = useFetchQuery({
    queryKey: ["otto-schedules", scope.hostId, scope.projectId, input],
    queryFn: () => api.list({ ...input, scope, includeLegacy: true, refresh: true }),
    dataShape: "value",
    staleTimeMs: 5000,
    retry: false,
    enabled: active,
  });
  // Filter/page changes must not create another outstanding long poll for every
  // keystroke. Retain the observed scope version while the new page is loading.
  const observed = useRef<number | undefined>(undefined);
  if (page.data) observed.current = Math.max(observed.current ?? 0, page.data.version);
  const version = observed.current;
  const { refetch } = page;
  useEffect(() => {
    if (!active || version === undefined || page.isError) return;
    const lifetime = new AbortController();
    async function observe() {
      let current = version;
      while (!lifetime.signal.aborted && current !== undefined) {
        try {
          const next = await api.watch({ scope, version: current });
          if (lifetime.signal.aborted) return;
          if (next.version !== current) {
            await refetch();
            return;
          }
          current = next.version;
        } catch {
          if (!lifetime.signal.aborted)
            setWatchError(
              "Live Schedule updates stopped. Reconnect and refresh to inspect current state.",
            );
          return;
        }
      }
    }
    void observe();
    return () => {
      lifetime.abort();
    };
  }, [api, scope, version, page.isError, refetch, watchAttempt, active]);
  const refresh = useCallback(() => {
    if (watchError) setWatchAttempt((attempt) => attempt + 1);
    setWatchError("");
    void refetch();
  }, [refetch, watchError]);
  return { page, watchError, refresh };
}
