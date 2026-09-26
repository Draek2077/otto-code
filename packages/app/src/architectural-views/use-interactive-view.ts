import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import type { Theme } from "@/styles/theme";
import {
  prepareInteractiveViewDocument,
  type InteractiveViewCommand,
  type InteractiveViewCommandResult,
  type InteractiveViewExportFile,
  type InteractiveViewExportFormat,
  type InteractiveViewGuestEvent,
  type InteractiveViewState,
} from "@/architectural-views/view-bridge";
import { buildInteractiveViewTheme, type InteractiveViewThemePayload } from "./view-theme";
import { resolveInteractiveViewFontFace } from "./view-font";
import type { InteractiveViewFrameHandle } from "@/components/architectural-views/interactive-view-frame-types";

export type InteractiveViewPendingAction = InteractiveViewExportFormat | "copy" | null;

export interface InteractiveViewController {
  /** The prepared guest document, or null until the Otto theme is known. */
  document: string | null;
  background: string;
  handleRef: React.MutableRefObject<InteractiveViewFrameHandle | null>;
  state: InteractiveViewState | null;
  pending: InteractiveViewPendingAction;
  notice: string | null;
  dismissNotice: () => void;
  onGuestEvent: (event: InteractiveViewGuestEvent) => void;
  onTheme: (theme: Theme) => void;
  run: (command: InteractiveViewCommand) => Promise<void>;
  exportAs: (format: InteractiveViewExportFormat) => Promise<InteractiveViewExportFile | null>;
  copyImage: () => Promise<boolean>;
}

function saveExportFile(file: InteractiveViewExportFile): void {
  // The app shell's download flow, the same one chat exports use.
  const link = document.createElement("a");
  link.href = file.dataUrl;
  link.download = file.fileName;
  link.click();
}

/**
 * Host-side state for one rendered Interactive View: the prepared document,
 * the live Otto theme, the guest's reported state, and the actions Otto's
 * toolbar and status bar invoke.
 */
export function useInteractiveView(html: string | null): InteractiveViewController {
  const handleRef = useRef<InteractiveViewFrameHandle | null>(null);
  const [themePayload, setThemePayload] = useState<InteractiveViewThemePayload | null>(null);
  const [background, setBackground] = useState("transparent");
  const [state, setState] = useState<InteractiveViewState | null>(null);
  const [pending, setPending] = useState<InteractiveViewPendingAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const themePayloadRef = useRef<InteractiveViewThemePayload | null>(null);
  const themeRevisionRef = useRef(0);
  const readyRef = useRef(false);

  const onTheme = useCallback((theme: Theme) => {
    const revision = ++themeRevisionRef.current;
    setBackground(theme.colors.surface0);
    void Promise.all([
      resolveInteractiveViewFontFace(theme.fontFamily.ui),
      resolveInteractiveViewFontFace(theme.fontFamily.mono),
    ]).then((fontFaces) => {
      if (revision !== themeRevisionRef.current) return;
      const payload = buildInteractiveViewTheme({ theme, fontFaces });
      themePayloadRef.current = payload;
      setThemePayload(payload);
      return undefined;
    });
  }, []);

  // A new document is prepared with whichever theme is current when it
  // arrives; later theme changes are pushed live, so the reader's pan, zoom,
  // and open panels survive a theme switch.
  const hasTheme = themePayload !== null;
  const document_ = useMemo(() => {
    const payload = themePayloadRef.current;
    if (!html || !payload) return null;
    return prepareInteractiveViewDocument(html, payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, hasTheme]);

  useEffect(() => {
    readyRef.current = false;
    setState(null);
    setNotice(null);
  }, [document_]);

  const pushTheme = useCallback(async () => {
    const payload = themePayloadRef.current;
    const handle = handleRef.current;
    if (!payload || !handle || !readyRef.current) return;
    await handle.run({ type: "theme", scheme: payload.scheme, css: payload.css });
  }, []);

  useEffect(() => {
    void pushTheme();
  }, [themePayload, pushTheme]);

  const onGuestEvent = useCallback(
    (event: InteractiveViewGuestEvent) => {
      if (event.type === "ready") {
        readyRef.current = true;
        setState(event.state);
        // The theme may have changed while the document loaded.
        void pushTheme();
        return;
      }
      if (event.type === "state") {
        setState(event.state);
        return;
      }
      if (event.type === "notice" && event.message.trim()) {
        setNotice(event.message.trim());
      }
    },
    [pushTheme],
  );

  const applyResult = useCallback((result: InteractiveViewCommandResult) => {
    if (result.ok) {
      setState(result.state);
      return true;
    }
    setNotice(result.error);
    return false;
  }, []);

  const run = useCallback(
    async (command: InteractiveViewCommand) => {
      const handle = handleRef.current;
      if (!handle) return;
      applyResult(await handle.run(command));
    },
    [applyResult],
  );

  const requestExport = useCallback(
    async (format: InteractiveViewExportFormat): Promise<InteractiveViewExportFile | null> => {
      const handle = handleRef.current;
      if (!handle) return null;
      const result = await handle.run({ type: "export", format });
      if (!applyResult(result) || !result.ok || !result.file) return null;
      return result.file;
    },
    [applyResult],
  );

  const exportAs = useCallback(
    async (format: InteractiveViewExportFormat) => {
      if (pending) return null;
      setPending(format);
      try {
        const file = await requestExport(format);
        if (file) saveExportFile(file);
        return file;
      } finally {
        setPending(null);
      }
    },
    [pending, requestExport],
  );

  const copyImage = useCallback(async () => {
    if (pending) return false;
    setPending("copy");
    try {
      const file = await requestExport("png");
      if (!file) return false;
      const base64 = file.dataUrl.slice(file.dataUrl.indexOf(",") + 1);
      await Clipboard.setImageAsync(base64);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The image could not be copied.");
      return false;
    } finally {
      setPending(null);
    }
  }, [pending, requestExport]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    document: document_,
    background,
    handleRef,
    state,
    pending,
    notice,
    dismissNotice,
    onGuestEvent,
    onTheme,
    run,
    exportAs,
    copyImage,
  };
}
