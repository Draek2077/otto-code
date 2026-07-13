import { memo, useEffect, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { formatDuration } from "@/utils/time";

interface LiveElapsedProps {
  startedAt: Date;
  active?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Ticks every second to render an elapsed duration. Isolated from parents so
 * only this component re-renders on each tick.
 */
export const LiveElapsed = memo(function LiveElapsed({
  startedAt,
  active = true,
  style,
  testID,
}: LiveElapsedProps) {
  const startedAtMs = startedAt.getTime();
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAtMs));
  const visibleElapsedMs = active ? Math.max(0, Date.now() - startedAtMs) : elapsedMs;

  useEffect(() => {
    if (!active) {
      return;
    }
    setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    const handle = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    }, 1000);
    return () => clearInterval(handle);
  }, [active, startedAtMs]);

  return (
    <Text style={style} testID={testID}>
      {formatDuration(visibleElapsedMs)}
    </Text>
  );
});
