import { afterEach, expect, test, vi } from "vitest";
import { ViewController } from "./view-controller";
import {
  INTERACTIVE_VIEW_MESSAGE_PREFIX as prefix,
  parseInteractiveViewGuestEvent,
  prepareInteractiveViewDocument,
} from "./view-bridge";
const state = {
  scale: 1,
  components: 2,
  relationships: 1,
  motion: null,
  finderOpen: false,
  lensOpen: false,
  routeOpen: false,
  mapOpen: false,
  guideOpen: false,
};
const event = (value: object, channel = "owner") => prefix + JSON.stringify({ ...value, channel });
afterEach(() => vi.useRealTimers());
test("foreign/malformed/nonfinite/oversized frames cannot create readiness or resolve commands", async () => {
  const controller = new ViewController("owner"),
    sent: { id: number }[] = [];
  controller.transport((message) => {
    sent.push(message);
  });
  controller.receive(event({ type: "ready", state }, "other"));
  expect(controller.getSnapshot().ready).toBe(false);
  expect(
    parseInteractiveViewGuestEvent(
      event({ type: "ready", state: { ...state, scale: null } }),
      "owner",
    ),
  ).toMatchObject({ state: { scale: 1 } });
  expect(
    parseInteractiveViewGuestEvent(
      event({ type: "result", id: 1.1, result: { ok: true, state } }),
      "owner",
    ),
  ).toBeNull();
  controller.receive(event({ type: "ready", state }));
  const waiting = controller.run({ type: "fit" });
  controller.receive(
    event({ type: "result", id: sent[0].id, result: { ok: true, state } }, "other"),
  );
  controller.receive(event({ type: "result", id: sent[0].id, result: { ok: true, state } }));
  expect(await waiting).toEqual({ ok: true, state });
  controller.close();
});
test("detaching or closing a frame settles pending controls and cancels deadlines", async () => {
  vi.useFakeTimers();
  const controller = new ViewController("owner");
  controller.transport(() => {});
  controller.receive(event({ type: "ready", state }));
  const waiting = controller.run({ type: "export", format: "png" });
  controller.transport(null);
  expect((await waiting).ok).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  controller.close();
  controller.activate();
  expect(controller.getSnapshot().ready).toBe(false);
  expect((await controller.run({ type: "fit" })).ok).toBe(false);
  controller.close();
});
test("unacknowledged commands are bounded in count and time", async () => {
  vi.useFakeTimers();
  const controller = new ViewController("owner");
  controller.transport(() => {});
  controller.receive(event({ type: "ready", state }));
  const pending = Array.from({ length: 8 }, () => controller.run({ type: "fit" }));
  expect((await controller.run({ type: "fit" })).ok).toBe(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect((await Promise.all(pending)).every((reply) => !reply.ok)).toBe(true);
  controller.close();
  expect(vi.getTimerCount()).toBe(0);
});
test("export payloads require a bounded supported data MIME and safe filename", () => {
  const parsed = parseInteractiveViewGuestEvent(
    event({
      type: "result",
      id: 1,
      result: {
        ok: true,
        state,
        file: {
          fileName: "../diagram.svg",
          mimeType: "image/svg+xml",
          dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      },
    }),
    "owner",
  );
  expect(parsed).toMatchObject({
    type: "result",
    result: { ok: true, file: { fileName: "..-diagram.svg" } },
  });
  for (const dataUrl of [
    "https://example.invalid/x",
    "data:text/html;base64,AA==",
    "data:image/png;base64," + "A".repeat(25165824),
  ]) {
    expect(
      parseInteractiveViewGuestEvent(
        event({
          type: "result",
          id: 1,
          result: { ok: true, state, file: { fileName: "x.png", mimeType: "image/png", dataUrl } },
        }),
        "owner",
      ),
    ).toMatchObject({ type: "result", result: { ok: false } });
  }
});
test("theme injection follows CSP and cannot close the style/script boundary", () => {
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src none">';
  const html = prepareInteractiveViewDocument(
    `<html><head>${csp}<script>viewer()</script></head></html>`,
    { scheme: "light", css: "a{}</style><script>bad()</script>", channel: "owner" },
  );
  expect(html.indexOf('id="otto-view-theme"')).toBeGreaterThan(html.indexOf(csp));
  expect(html.indexOf('id="otto-view-theme"')).toBeLessThan(html.indexOf("viewer()"));
  expect(html).not.toContain("</style><script>bad()");
});
