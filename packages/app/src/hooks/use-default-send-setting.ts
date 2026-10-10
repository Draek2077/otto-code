import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDefaultSendBehavior } from "@/hooks/use-default-send-behavior";
import type { SendBehavior } from "@/hooks/use-settings";

export interface DefaultSendOption {
  value: SendBehavior;
  label: string;
  disabled: boolean;
}

export interface DefaultSendSetting {
  behavior: SendBehavior;
  error: string | null;
  isSaving: boolean;
  options: DefaultSendOption[];
  onChange: (behavior: SendBehavior) => void;
}

/**
 * The Settings row for Default send: the host-authoritative value from
 * useDefaultSendBehavior plus a single-flight save. A second pick while one is
 * saving is dropped (the options are disabled meanwhile), and a failed save
 * surfaces its message on the row instead of silently reverting.
 */
export function useDefaultSendSetting(serverId: string | null): DefaultSendSetting {
  const { t } = useTranslation();
  const { behavior, setBehavior } = useDefaultSendBehavior(serverId);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  const onChange = useCallback(
    (next: SendBehavior) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setIsSaving(true);
      setError(null);
      void setBehavior(next)
        .catch((caught: unknown) => {
          setError(caught instanceof Error ? caught.message : String(caught));
        })
        .finally(() => {
          savingRef.current = false;
          setIsSaving(false);
        });
    },
    [setBehavior],
  );

  const options = useMemo<DefaultSendOption[]>(
    () => [
      {
        value: "interrupt",
        label: t("settings.general.defaultSend.options.interrupt"),
        disabled: isSaving,
      },
      {
        value: "steer",
        label: t("settings.general.defaultSend.options.steer"),
        disabled: isSaving,
      },
      {
        value: "queue",
        label: t("settings.general.defaultSend.options.queue"),
        disabled: isSaving,
      },
    ],
    [isSaving, t],
  );

  return { behavior, error, isSaving, options, onChange };
}
