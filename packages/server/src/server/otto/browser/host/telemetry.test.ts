import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import { HostBrowserTelemetry } from "./telemetry.js";
test("page diagnostics retain bounded metadata and apply Paseo dialog policy", async () => {
  const page = new EventEmitter(),
    telemetry = new HostBrowserTelemetry(page);
  for (let index = 0; index < 205; index++)
    page.emit("console", {
      type: () => "log",
      text: () => `${index}:${"x".repeat(3000)}`,
      location: () => ({ url: "https://example.test", lineNumber: index }),
    });
  const logs = telemetry.logs(200);
  expect(logs.console).toHaveLength(200);
  expect(logs.console[0].message.startsWith("5:")).toBe(true);
  expect(logs.console.every((entry) => entry.message.length <= 2000)).toBe(true);
  const accept = vi.fn(async () => {}),
    dismiss = vi.fn(async () => {});
  page.emit("dialog", { type: () => "alert", message: () => "Notice", accept, dismiss });
  page.emit("dialog", { type: () => "confirm", message: () => "Confirm", accept, dismiss });
  expect(accept).toHaveBeenCalledTimes(1);
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(telemetry.takeDialogs().map((entry) => entry.action)).toEqual(["accepted", "dismissed"]);
  expect(telemetry.takeDialogs()).toEqual([]);
});
test("unregistered popup and download work is closed rather than admitted as another tab", async () => {
  const page = new EventEmitter();
  const telemetry = new HostBrowserTelemetry(page);
  const close = vi.fn(async () => {}),
    cancel = vi.fn(async () => {});
  page.emit("popup", { close });
  page.emit("download", { cancel });
  expect(close).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(telemetry.logs(200)).toEqual({ console: [], network: [] });
});
