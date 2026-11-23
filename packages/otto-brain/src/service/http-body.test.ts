import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { expect, it } from "vitest";
import { readObject } from "./http-body.js";

it("rejects a truncated body once and absorbs the following native socket error", async () => {
  const socket = new Socket();
  const request = new IncomingMessage(socket);
  const reading = readObject(request, new AbortController().signal).catch(
    (error: Error) => error.message,
  );
  request.emit("aborted");
  expect(() => request.emit("error", new Error("ECONNRESET fixture"))).not.toThrow();
  expect(await reading).toContain("interrupted");
  request.emit("close");
  expect(request.listenerCount("error")).toBe(0);
  socket.destroy();
});

it("bounds a request by bytes without collecting or parsing the remaining body", async () => {
  const socket = new Socket();
  const request = new IncomingMessage(socket);
  const reading = readObject(request, new AbortController().signal, 4).catch(
    (error: Error) => error.message,
  );
  request.emit("data", Buffer.from("12345"));
  request.emit("data", Buffer.alloc(100));
  request.emit("end");
  expect(await reading).toContain("too large");
  request.emit("close");
  socket.destroy();
});
