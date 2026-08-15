import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { getDesktopHost } from "@/desktop/host";
import { supportsZoomRecorder } from "@/desktop/zoom-recorder-capability";
import { useAppSettingValue } from "@/hooks/use-settings";
import type { AppSettings } from "@/hooks/use-settings/storage";
import { useHostRuntimeClient, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { parseServerIdFromPathname } from "@/utils/host-routes";
import {
  localTranscriptDeliveryStateForPolicy,
  resolveMeetingTranscriptDeliveryDestination,
} from "@/meetings/meeting-transcript-delivery-policy";

const selectZoomRecorderEnabled = (settings: AppSettings): boolean => settings.zoomRecorderEnabled;
const selectZoomRecorderPaused = (settings: AppSettings): boolean => settings.zoomRecorderPaused;
const selectMeetingTranscriptDeliveryPolicy = (settings: AppSettings) =>
  settings.meetingTranscriptDeliveryPolicy;

interface PendingTranscript {
  token: string;
  content: string;
  occurredAt: string;
}

function isPendingTranscript(value: unknown): value is PendingTranscript {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingTranscript>;
  return (
    typeof candidate.token === "string" &&
    typeof candidate.content === "string" &&
    typeof candidate.occurredAt === "string"
  );
}

const TRANSCRIPT_TITLE_PATTERN = /^Meeting notes #(\d+)$/i;

function nextTranscriptTitle(titles: readonly string[]): string {
  let highest = 0;
  for (const title of titles) {
    const match = TRANSCRIPT_TITLE_PATTERN.exec(title.trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Meeting notes #${highest + 1}`;
}

/** Owns the local recorder process for the whole desktop app session. */
export function ZoomRecorderHost() {
  const enabled = useAppSettingValue(selectZoomRecorderEnabled);
  const paused = useAppSettingValue(selectZoomRecorderPaused);
  const deliveryPolicy = useAppSettingValue(selectMeetingTranscriptDeliveryPolicy);
  const pathname = usePathname();
  const serverId = parseServerIdFromPathname(pathname) ?? "";
  const client = useHostRuntimeClient(serverId);
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  // COMPAT(meetingTranscripts): added in v0.8.11, remove gate after 2027-02-13.
  const meetingTranscriptsSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.meetingTranscripts === true,
  );
  const uploading = useRef(new Set<string>());
  const deliveringStored = useRef(new Set<string>());
  const nextTitleNumber = useRef<number | null>(null);
  const titleAllocation = useRef(Promise.resolve());

  const allocateTranscriptTitle = useCallback(async (): Promise<string> => {
    let release!: () => void;
    const previous = titleAllocation.current;
    titleAllocation.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (nextTitleNumber.current === null) {
        const [daemonRecords, localRecords] = await Promise.all([
          client?.meetingsTranscriptsList() ?? Promise.resolve([]),
          getDesktopHost()?.meetingTranscripts?.listLocal?.() ?? Promise.resolve([]),
        ]);
        const title = nextTranscriptTitle([
          ...daemonRecords.map((record) => record.title),
          ...localRecords.map((record) => record.title),
        ]);
        nextTitleNumber.current = Number(title.slice("Meeting notes #".length)) + 1;
        return title;
      }
      const title = `Meeting notes #${nextTitleNumber.current}`;
      nextTitleNumber.current += 1;
      return title;
    } finally {
      release();
    }
  }, [client]);

  useEffect(() => {
    const host = getDesktopHost();
    if (!supportsZoomRecorder(host)) return;
    const recorder = host?.zoomRecorder;
    const action = enabled && !paused ? recorder?.enable : recorder?.disable;
    if (!action) return;
    void action().catch((error: unknown) => {
      console.warn("[ZoomRecorder] Failed to update recorder state", error);
    });
  }, [enabled, paused]);

  const ingest = useCallback(
    async (transcript: PendingTranscript) => {
      if (uploading.current.has(transcript.token)) return;
      uploading.current.add(transcript.token);
      try {
        const title = await allocateTranscriptTitle();
        const storeLocally = async (
          deliveryState: "local_only" | "waiting_for_secure_connection" | "delivery_failed",
        ): Promise<void> => {
          const stored = await getDesktopHost()?.meetingTranscripts?.createLocal?.({
            provider: "zoom",
            title,
            content: transcript.content,
            occurredAt: transcript.occurredAt,
            deliveryState,
          });
          if (!stored) {
            throw new Error(
              "Otto Desktop must be updated before local transcript storage is available.",
            );
          }
        };
        const destination = resolveMeetingTranscriptDeliveryDestination({
          policy: deliveryPolicy,
          activeConnection: runtimeSnapshot?.activeConnection ?? null,
          daemonAvailable: client !== null && meetingTranscriptsSupported,
        });
        if (destination === "daemon" && client) {
          try {
            await client.meetingsTranscriptsCreate({
              provider: "zoom",
              title,
              content: transcript.content,
              occurredAt: transcript.occurredAt,
            });
          } catch (error) {
            console.warn(
              "[ZoomRecorder] Remote transcript delivery failed; retaining text locally",
              error,
            );
            await storeLocally("delivery_failed");
          }
        } else {
          await storeLocally(localTranscriptDeliveryStateForPolicy(deliveryPolicy));
        }
        await getDesktopHost()?.zoomRecorder?.acknowledgeTranscript?.(transcript.token);
      } catch (error) {
        console.warn("[ZoomRecorder] Failed to store finalized transcript", error);
      } finally {
        uploading.current.delete(transcript.token);
      }
    },
    [
      allocateTranscriptTitle,
      client,
      deliveryPolicy,
      meetingTranscriptsSupported,
      runtimeSnapshot?.activeConnection,
    ],
  );

  const deliverStoredTranscripts = useCallback(async () => {
    if (!client || !meetingTranscriptsSupported) return;
    if (
      resolveMeetingTranscriptDeliveryDestination({
        policy: deliveryPolicy,
        activeConnection: runtimeSnapshot?.activeConnection ?? null,
        daemonAvailable: true,
      }) !== "daemon"
    ) {
      return;
    }
    const localRecords = await getDesktopHost()?.meetingTranscripts?.listLocal?.();
    if (!localRecords) return;
    await Promise.all(
      localRecords
        .filter((record) => record.deliveryState !== "local_only")
        .map(async (record) => {
          if (deliveringStored.current.has(record.id)) return;
          deliveringStored.current.add(record.id);
          try {
            await client.meetingsTranscriptsCreate({
              provider: record.provider,
              title: record.title,
              content: record.content,
              occurredAt: record.occurredAt,
            });
            await getDesktopHost()?.meetingTranscripts?.deleteLocal?.(record.id);
          } catch (error) {
            console.warn("[ZoomRecorder] Failed to deliver locally retained transcript", error);
          } finally {
            deliveringStored.current.delete(record.id);
          }
        }),
    );
  }, [client, deliveryPolicy, meetingTranscriptsSupported, runtimeSnapshot?.activeConnection]);

  useEffect(() => {
    void deliverStoredTranscripts();
  }, [deliverStoredTranscripts]);

  useEffect(() => {
    let disposed = false;
    const enqueue = (value: unknown): void => {
      if (!disposed && isPendingTranscript(value)) void ingest(value);
    };
    void getDesktopHost()
      ?.zoomRecorder?.listPendingTranscripts?.()
      .then((transcripts) => transcripts?.forEach(enqueue))
      .catch((error: unknown) =>
        console.warn("[ZoomRecorder] Failed to read pending transcripts", error),
      );
    let unlisten: (() => void) | undefined;
    void listenToDesktopEvent<unknown>("zoom-recorder-transcript-ready", enqueue)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ingest]);

  return null;
}
