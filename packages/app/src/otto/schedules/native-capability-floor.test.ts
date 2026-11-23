import { expect, test } from "vitest";
import { nativeScheduleCapabilityFloor } from "../../../e2e/support/helpers/schedule-native-capability-floor";

test.each(["session", "flat"])(
  "native %s fixture removes only the extension capability",
  (shape) => {
    const payload = {
      status: "server_info",
      serverId: "host",
      features: { scheduleTargets: true, workspaceMultiplicity: true },
    };
    const original =
      shape === "session"
        ? { type: "session", offset: 3, message: { type: "status", payload, future: "retained" } }
        : { type: "status", payload };
    const expectedPayload = { ...payload, features: { workspaceMultiplicity: true } };
    const expected =
      shape === "session"
        ? { ...original, message: { type: "status", payload: expectedPayload, future: "retained" } }
        : { ...original, payload: expectedPayload };
    const result = nativeScheduleCapabilityFloor(JSON.stringify(original));
    expect(result.serverInfo).toBe(true);
    expect(JSON.parse(String(result.message))).toEqual(expected);
    expect(payload.features.scheduleTargets).toBe(true);
  },
);
test("an already-old host is observed without rewriting its frame", () => {
  const frame = '{ "type":"status", "payload":{"status":"server_info","features":{"other":true}} }';
  expect(nativeScheduleCapabilityFloor(frame)).toEqual({ message: frame, serverInfo: true });
});
test.each([
  "not-json",
  '{"type":"session","message":{"type":"schedule_list_response","payload":{"schedules":[]}}}',
  Buffer.from("opaque"),
])("RPCs and non-info frames pass through unchanged: %s", (frame) => {
  const result = nativeScheduleCapabilityFloor(frame);
  expect(result.message).toBe(frame);
  expect(result.serverInfo).toBe(false);
});
