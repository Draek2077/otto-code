import { useEffect, useMemo, useState } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import { formatMessageTimestamp, formatTimeAgo } from "@/utils/time";

// Coarse refresh keeps relative labels ("5m ago") from going stale while a
// chat sits idle. Absolute labels never tick.
const RELATIVE_REFRESH_MS = 60_000;

/**
 * Label for a chat message timestamp, honoring the chatTimestampDisplay
 * appearance setting: exact clock time ("10:11 PM") or relative ("5m ago").
 */
export function useChatTimestampLabel(timestampMs: number | undefined): string {
  const display = useAppSettings().settings.chatTimestampDisplay;
  const isRelative = display === "relative";
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isRelative) {
      return;
    }
    const id = setInterval(() => setNowMs(Date.now()), RELATIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [isRelative]);

  return useMemo(() => {
    if (timestampMs === undefined) {
      return "";
    }
    const date = new Date(timestampMs);
    return isRelative ? formatTimeAgo(date) : formatMessageTimestamp(date, new Date(nowMs));
  }, [isRelative, nowMs, timestampMs]);
}
