import { expect, test } from "vitest";
import { hostPagePoint } from "./geometry";
const dimensions = { width: 1000, height: 1000, viewportWidth: 400, viewportHeight: 800 };
test("maps contained pixels to CSS coordinates without clicking letterboxes", () => {
  expect(hostPagePoint({ ...dimensions, x: 500, y: 500 })).toEqual({ x: 200, y: 400 });
  expect(hostPagePoint({ ...dimensions, x: 250, y: 0 })).toEqual({ x: 0, y: 0 });
  expect(hostPagePoint({ ...dimensions, x: 0, y: 500 })).toBeNull();
  expect(hostPagePoint({ ...dimensions, x: 0, y: 500, clamp: true })).toEqual({ x: 0, y: 400 });
});
test.each([0, -1, NaN, Infinity])("refuses hidden or invalid geometry %s", (width) => {
  expect(hostPagePoint({ ...dimensions, width, x: 0, y: 0 })).toBeNull();
});
