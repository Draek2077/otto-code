import { useEffect, useState } from "react";
import { readWakeCapability } from "./detector";
import type { WakeWordCapability } from "./bridge";
const initial: WakeWordCapability = {
  available: false,
  safePhraseSupported: false,
  reason: "Checking this device's local detector…",
};
export function useWakeCapability() {
  const [capability, setCapability] = useState(initial);
  useEffect(() => {
    let active = true;
    void readWakeCapability().then(
      (value) => {
        if (active) setCapability(value);
        return undefined;
      },
      () => {
        if (active)
          setCapability({
            available: false,
            safePhraseSupported: false,
            reason:
              "The local detector is unavailable. Update or reinstall this app to restore it.",
          });
        return undefined;
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return capability;
}
