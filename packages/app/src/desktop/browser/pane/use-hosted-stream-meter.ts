import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSettingValue } from "@/hooks/use-settings";
import { formatStreamReading, StreamMeter } from "./hosted-stream-meter";

interface HostCounters {
  pushed: number;
  captures: number;
}

interface HostedStreamMeter {
  /** The reading to show, or empty while the metrics bar is off. */
  text: string;
  recordFrame: (sample: { at: number; bytes: number; presentMs: number }) => void;
  recordHost: (counters: HostCounters) => void;
}

/** Frames are always counted; the text refreshes only while it is shown. */
export function useHostedStreamMeter(presented: boolean): HostedStreamMeter {
  const shown = useAppSettingValue((settings) => settings.chatMetricsBar);
  const meter = useRef(new StreamMeter());
  const host = useRef<HostCounters>({ pushed: 0, captures: 0 });
  const [text, setText] = useState("");

  useEffect(() => {
    if (!shown || !presented) return;
    const refresh = () => {
      const { pushed, captures } = host.current;
      // Host counters: frames Chromium pushed, then screenshots taken instead.
      setText(
        `${formatStreamReading(meter.current.read(Date.now()))} · host ${pushed}/${captures}`,
      );
    };
    refresh();
    const interval = setInterval(refresh, 1_000);
    return () => clearInterval(interval);
  }, [shown, presented]);

  const recordFrame = useCallback<HostedStreamMeter["recordFrame"]>((sample) => {
    meter.current.record(sample);
  }, []);
  const recordHost = useCallback<HostedStreamMeter["recordHost"]>((counters) => {
    host.current = counters;
  }, []);
  return { text: shown ? text : "", recordFrame, recordHost };
}
