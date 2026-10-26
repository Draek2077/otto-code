import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Text, type StyleProp, type ViewStyle } from "react-native";
import { Ellipsis, ExternalLink, Search } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert } from "@/components/ui/alert";
import { getDesktopHost } from "@/desktop/host";
import { getIsElectronMac, isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { BrowserFindBar } from "./find-bar.electron";
import { externalBrowserUrl, isFindShortcut } from "./action-policy";
import type { FindableGuest } from "./find-controller";

const MoreIcon = withUnistyles(Ellipsis);
const FindIcon = withUnistyles(Search);
const ExternalIcon = withUnistyles(ExternalLink);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
interface ActionsGuest extends FindableGuest {
  focus?(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
/** These are missing actions only: Paseo's visible toolbar and guest ownership stay intact. */
export function useOttoBrowserActions({
  browserId,
  pageUrl,
  active,
  guestRef,
  triggerStyle,
}: {
  browserId: string;
  pageUrl: string | null;
  active: boolean;
  guestRef: RefObject<ActionsGuest | null>;
  triggerStyle: (state: { hovered?: boolean; pressed?: boolean }) => StyleProp<ViewStyle>;
}) {
  const [findOpen, setFindOpen] = useState(false),
    [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState("");
  const findIcon = useMemo(() => <FindIcon size={16} uniProps={muted} />, []);
  const [opening, setOpening] = useState(false),
    [opened, setOpened] = useState(false);
  const openingRef = useRef(false);
  const openFind = useCallback(() => {
    setFindOpen(true);
    setFocusRequest((value) => value + 1);
  }, []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    guestRef.current?.focus?.();
  }, [guestRef]);
  useEffect(() => {
    if (!active) return;
    let listening = true;
    const release = getDesktopHost()?.events?.on?.("browser-shortcut", (payload) => {
      if (listening && isFindShortcut(payload, browserId)) openFind();
    });
    return () => {
      listening = false;
      if (typeof release === "function") release();
      else void release?.then((dispose) => dispose());
    };
  }, [active, browserId, openFind]);
  useEffect(() => {
    if (!isWeb || !active) return;
    const keyDown = (event: KeyboardEvent) => {
      const modifier = getIsElectronMac()
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (
        event.isComposing ||
        !modifier ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "f"
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openFind();
    };
    window.addEventListener("keydown", keyDown, true);
    return () => window.removeEventListener("keydown", keyDown, true);
  }, [active, openFind]);
  const url = externalBrowserUrl(pageUrl);
  const external = useCallback(async () => {
    if (!url || openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setOpened(false);
    setError("");
    try {
      const open = getDesktopHost()?.opener?.openUrl;
      if (!open) throw new Error("No desktop opener");
      await open(url);
      setOpened(true);
    } catch {
      setError("The page could not be opened in your external browser.");
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }, [url]);
  return {
    more: (
      <DropdownMenu>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger
              accessibilityLabel="More browser actions"
              testID="browser-more-actions"
              style={triggerStyle}
            >
              <MoreIcon size={16} uniProps={muted} />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <Text style={styles.tooltip}>More browser actions</Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem testID="browser-find-action" leading={findIcon} onSelect={openFind}>
            Find in page
          </DropdownMenuItem>
          <ExternalBrowserAction url={url} opening={opening} opened={opened} onSelect={external} />
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    findBar:
      findOpen && active ? (
        <BrowserFindBar guestRef={guestRef} focusRequest={focusRequest} onClose={closeFind} />
      ) : null,
    error: error ? <Alert variant="error" description={error} /> : null,
  };
}
function ExternalBrowserAction({
  url,
  opening,
  opened,
  onSelect,
}: {
  url: string | null;
  opening: boolean;
  opened: boolean;
  onSelect(): void;
}) {
  const icon = useMemo(() => <ExternalIcon size={16} uniProps={muted} />, []);
  let status: "pending" | "success" | "idle" = "idle";
  if (opening) status = "pending";
  else if (opened) status = "success";
  return (
    <DropdownMenuItem
      testID="browser-external-action"
      leading={icon}
      onSelect={onSelect}
      disabled={!url}
      status={status}
      closeOnSelect={false}
      pendingLabel="Opening external browser"
      successLabel="Opened external browser"
    >
      Open in external browser
    </DropdownMenuItem>
  );
}
const styles = StyleSheet.create((theme) => ({
  tooltip: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
}));
