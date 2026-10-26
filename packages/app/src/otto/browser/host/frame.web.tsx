import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type WheelEvent,
  type KeyboardEvent,
  type ClipboardEvent,
  type CompositionEvent,
} from "react";
import type { HostFrameProps } from "./frame-types";
import { hostPagePoint, hostPointerPhase, hostTouchPhase, hostWheelScale } from "./geometry";
const surface: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  outline: "none",
  touchAction: "none",
  overflow: "hidden",
  position: "relative",
};
const image: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
  pointerEvents: "none",
  userSelect: "none",
};
function mouseButton(value: number) {
  if (value === 2) return "right";
  if (value === 1) return "middle";
  return "left";
}
export function HostBrowserFrame({ frame, displayed, failed, input, focus }: HostFrameProps) {
  const [picture, setPicture] = useState<{ sequence: number; url: string } | null>(null);
  const contacts = useRef(new Map<number, { id: number; x: number; y: number }>());
  const keys = useRef(new Set<string>());
  const buttons = useRef(new Map<"left" | "right" | "middle", { x: number; y: number }>());
  useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(frame.jpeg)], { type: "image/jpeg" }),
    );
    setPicture({ sequence: frame.sequence, url });
    return () => URL.revokeObjectURL(url);
  }, [frame]);
  const point = useCallback(
    (element: HTMLDivElement, x: number, y: number, clamp = false) => {
      const box = element.getBoundingClientRect();
      return hostPagePoint({
        x: x - box.left,
        y: y - box.top,
        width: box.width,
        height: box.height,
        viewportWidth: frame.viewportWidth,
        viewportHeight: frame.viewportHeight,
        clamp,
      });
    },
    [frame.viewportWidth, frame.viewportHeight],
  );
  const pointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const phase = hostPointerPhase(event.type);
      const position = point(event.currentTarget, event.clientX, event.clientY, phase !== "down");
      if (!position) return;
      event.preventDefault();
      if (phase === "down") {
        focus();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (event.pointerType !== "touch") {
        const button = mouseButton(event.button);
        if (phase === "down") buttons.current.set(button, position);
        else if (phase === "up") buttons.current.delete(button);
        else for (const held of buttons.current.keys()) buttons.current.set(held, position);
        input({ kind: "pointer", phase, button, ...position });
      } else {
        const previous = contacts.current.get(event.pointerId);
        if (phase === "down") {
          const used = new Set(Array.from(contacts.current.values(), (value) => value.id));
          const id = Array.from({ length: 10 }, (_value, index) => index).find(
            (index) => !used.has(index),
          );
          if (id === undefined) return;
          contacts.current.set(event.pointerId, { id, ...position });
        } else if (!previous) return;
        else if (phase === "up") contacts.current.delete(event.pointerId);
        else contacts.current.set(event.pointerId, { id: previous.id, ...position });
        const points = Array.from(contacts.current.values());
        input({
          kind: "touch",
          phase: hostTouchPhase(points.length, phase === "down"),
          points,
        });
      }
      if (phase === "up" && event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [focus, input, point],
  );
  const cancel = useCallback(() => {
    for (const key of keys.current) input({ kind: "key", phase: "up", key });
    keys.current.clear();
    for (const [button, position] of buttons.current)
      input({ kind: "pointer", phase: "up", button, ...position });
    buttons.current.clear();
    if (contacts.current.size) {
      contacts.current.clear();
      input({ kind: "touch", phase: "cancel", points: [] });
    }
  }, [input]);
  const wheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      const position = point(event.currentTarget, event.clientX, event.clientY);
      if (!position) return;
      event.preventDefault();
      const scale = hostWheelScale(event.deltaMode, frame.viewportHeight);
      input({
        kind: "wheel",
        ...position,
        deltaX: Math.max(-100000, Math.min(100000, event.deltaX * scale)),
        deltaY: Math.max(-100000, Math.min(100000, event.deltaY * scale)),
      });
    },
    [frame.viewportHeight, input, point],
  );
  const key = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing || event.key === "Unidentified" || event.key === "Process")
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") return;
      event.preventDefault();
      event.stopPropagation();
      const phase = event.type === "keydown" ? "down" : "up";
      if (phase === "down") keys.current.add(event.key);
      else keys.current.delete(event.key);
      input({ kind: "key", phase, key: event.key });
    },
    [input],
  );
  const paste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      if (text.length <= 16384) input({ kind: "text", text });
    },
    [input],
  );
  const composed = useCallback(
    (event: CompositionEvent<HTMLDivElement>) => {
      if (event.data.length <= 16384) input({ kind: "text", text: event.data });
    },
    [input],
  );
  const loaded = useCallback(() => {
    if (picture) displayed(picture.sequence);
  }, [displayed, picture]);
  const broken = useCallback(() => {
    if (picture) failed(picture.sequence);
  }, [failed, picture]);
  const context = useCallback((event: React.MouseEvent) => event.preventDefault(), []);
  return (
    <div
      style={surface}
      tabIndex={0}
      role="application"
      aria-label="Host browser page"
      data-host-viewport-width={frame.viewportWidth}
      data-host-viewport-height={frame.viewportHeight}
      onPointerDown={pointer}
      onPointerMove={pointer}
      onPointerUp={pointer}
      onPointerCancel={cancel}
      onBlur={cancel}
      onWheel={wheel}
      onKeyDown={key}
      onKeyUp={key}
      onPaste={paste}
      onCompositionEnd={composed}
      onContextMenu={context}
    >
      {picture ? (
        <img
          src={picture.url}
          alt="Host browser page"
          style={image}
          onLoad={loaded}
          onError={broken}
          draggable={false}
        />
      ) : null}
    </div>
  );
}
