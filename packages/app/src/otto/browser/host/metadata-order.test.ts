import { expect, test } from "vitest";
import { HostBrowserMetadataOrder } from "./metadata-order";
test("an older inventory reply cannot replace a newer watch or navigation result", () => {
  const order = new HostBrowserMetadataOrder();
  expect(order.accept("browser", 2)).toBe(true);
  expect(order.accept("browser", 4)).toBe(true);
  expect(order.accept("browser", 3)).toBe(false);
  expect(order.accept("browser", 4)).toBe(false);
  expect(order.accept("browser", 5)).toBe(true);
  expect(order.accept("peer", 0)).toBe(true);
});
test.each([undefined, NaN, Infinity, -1, 0.5])(
  "missing or invalid host revisions cannot rebase records: %s",
  (revision) => {
    const order = new HostBrowserMetadataOrder();
    expect(() => order.accept("browser", revision)).toThrow("revisioned");
  },
);
