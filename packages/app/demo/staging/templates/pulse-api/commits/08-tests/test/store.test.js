import { expect, test } from "vitest";
import { EventStore } from "../src/store.js";

test("evicts oldest events once capacity is reached", () => {
  const store = new EventStore(3);
  for (const name of ["a", "b", "c", "d"]) {
    store.push({ name });
  }

  expect(store.size).toBe(3);
  expect(store.recent(10).map((event) => event.name)).toEqual(["d", "c", "b"]);
});

test("recent respects the limit", () => {
  const store = new EventStore(10);
  for (const name of ["a", "b", "c"]) {
    store.push({ name });
  }

  expect(store.recent(2).map((event) => event.name)).toEqual(["c", "b"]);
});
