import { expect, it } from "vitest";
import { BrainLogPublisher } from "./status-events.js";

it("replays bounded host-indexed history and continues the same live sequence", () => {
  const logs = new BrainLogPublisher();
  logs.publish("before subscription");
  const received: Array<{ line: string; index: number }> = [];
  const release = logs.subscribe((line, index) => received.push({ line, index }));
  logs.publish("after subscription");
  release();
  logs.publish("not subscribed");
  expect(received).toEqual([
    { line: "before subscription", index: 0 },
    { line: "after subscription", index: 1 },
  ]);
  const replay: number[] = [];
  logs.subscribe((_line, index) => replay.push(index))();
  expect(replay).toEqual([0, 1, 2]);
});

it("retains the newest 500 records without renumbering their absolute identities", () => {
  const logs = new BrainLogPublisher();
  for (let index = 0; index < 600; index++) logs.publish(`fixture line ${index}`);
  const replay: number[] = [];
  logs.subscribe((_line, index) => replay.push(index))();
  expect(replay).toHaveLength(500);
  expect(replay[0]).toBe(100);
  expect(replay.at(-1)).toBe(599);
});

it("bounds retained bytes and each complete UTF-8 line", () => {
  const logs = new BrainLogPublisher();
  for (let index = 0; index < 100; index++) logs.publish("😀".repeat(4096));
  const replay: string[] = [];
  logs.subscribe((line) => replay.push(line))();
  expect(replay.length).toBeLessThanOrEqual(64);
  expect(replay.every((line) => Buffer.byteLength(line) <= 8192 && !line.includes("�"))).toBe(true);
  expect(replay.reduce((bytes, line) => bytes + Buffer.byteLength(line), 0)).toBeLessThanOrEqual(
    512 * 1024,
  );
});

it("keeps repeated identical lines distinct and a broken listener cannot block another", () => {
  const logs = new BrainLogPublisher();
  logs.subscribe(() => {
    throw new Error("closed consumer");
  });
  const received: number[] = [];
  logs.subscribe((_line, index) => received.push(index));
  logs.publish("same");
  logs.publish("same");
  expect(received).toEqual([0, 1]);
});

it("releases a subscriber whose initial replay fails", () => {
  const logs = new BrainLogPublisher();
  logs.publish("retained evidence");
  let calls = 0;
  expect(() =>
    logs.subscribe(() => {
      calls++;
      throw new Error("reader closed during replay");
    }),
  ).toThrow("reader closed during replay");
  logs.publish("later evidence");
  expect(calls).toBe(1);
});
