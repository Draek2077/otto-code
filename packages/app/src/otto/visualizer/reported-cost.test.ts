import { expect, it } from "vitest";
import {
  reportedCost,
  summarizeReportedCost,
} from "../../../../../vendor/agent-flow/web/lib/reported-cost";

it.each([undefined, null, NaN, Infinity, -1, "0"])(
  "leaves unreported/invalid cost %s unknown",
  (value) => {
    expect(reportedCost(value)).toBeNull();
  },
);
it("distinguishes a real free endpoint from an unpriced endpoint", () => {
  expect(reportedCost(0)).toBe(0);
  expect(summarizeReportedCost([{ costUsd: 0 }])).toEqual({
    totalCostUsd: 0,
    costIsPartial: false,
  });
});
it("marks a subtotal even when the unknown provider reports no tokens", () => {
  expect(summarizeReportedCost([{ costUsd: 0.12 }, {}])).toEqual({
    totalCostUsd: 0.12,
    costIsPartial: true,
  });
});
it("does not turn the empty retired accumulator into a measured zero", () => {
  expect(summarizeReportedCost([{}, {}], 0)).toEqual({
    totalCostUsd: null,
    costIsPartial: false,
  });
});
it("retains reported retired cost without pricing an active unknown endpoint", () => {
  expect(summarizeReportedCost([{}], 0.5)).toEqual({
    totalCostUsd: 0.5,
    costIsPartial: true,
  });
});
