import { describe, expect, test } from "vitest";
import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  type SessionInboundMessage,
  type SessionOutboundMessage,
} from "../messages.js";
import {
  DAEMON_PERMISSIONS,
  OWNER_PERMISSIONS,
  SessionAuthorization,
  permissionsForLegacyHubScopes,
  parseDaemonPermissions,
} from "./index.js";

function inboundOperationTypes(): SessionInboundMessage["type"][] {
  return SessionInboundMessageSchema.options.map((option) => option.shape.type.value);
}

function outboundOperationTypes(): SessionOutboundMessage["type"][] {
  return SessionOutboundMessageSchema.options.map((option) => option.shape.type.value);
}

function inboundMessage(type: SessionInboundMessage["type"]): SessionInboundMessage {
  return { type } as SessionInboundMessage;
}

function outboundMessage(type: SessionOutboundMessage["type"]): SessionOutboundMessage {
  if (type === "status")
    return {
      type,
      payload: { status: "agent_create_failed", error: "test", requestId: "test" },
    } as SessionOutboundMessage;
  return { type } as SessionOutboundMessage;
}

describe("SessionAuthorization", () => {
  test("does not give empty authority any request, including Otto extensions", () => {
    const authorization = new SessionAuthorization([]);
    expect(
      inboundOperationTypes().filter((type) => authorization.allowsInbound(inboundMessage(type))),
    ).toEqual([]);
    expect(
      outboundOperationTypes().filter((type) =>
        authorization.allowsOutbound(outboundMessage(type)),
      ),
    ).toEqual(["rpc_error"]);
  });
  test("separates Otto workspace, daemon, account and automation authority", () => {
    const workspace = new SessionAuthorization(["workspace.read"]);
    expect(workspace.allowsInbound(inboundMessage("project.knowledge.get.request"))).toBe(true);
    expect(workspace.allowsInbound(inboundMessage("project.knowledge.apply.request"))).toBe(false);
    expect(
      workspace.allowsInbound(inboundMessage("communications.inbox.get_messages.request")),
    ).toBe(false);
    expect(
      workspace.allowsOutbound(outboundMessage("communications.inbox.get_messages.response")),
    ).toBe(false);
    const daemon = new SessionAuthorization(["daemon.read"]);
    expect(daemon.allowsInbound(inboundMessage("brain.host.status.request"))).toBe(true);
    expect(daemon.allowsInbound(inboundMessage("brain.host.start.request"))).toBe(false);
    expect(daemon.allowsInbound(inboundMessage("connectors.oauth.authorize.request"))).toBe(false);
    const automation = new SessionAuthorization(["automation.manage"]);
    expect(automation.allowsInbound(inboundMessage("workflows.start.request"))).toBe(true);
    expect(automation.allowsInbound(inboundMessage("brain.host.restart.request"))).toBe(false);
    const account = new SessionAuthorization(["access.manage"]);
    expect(
      account.allowsInbound(inboundMessage("integrations.authorization.start_browser.request")),
    ).toBe(true);
    expect(account.allowsInbound(inboundMessage("communications.room.message.send.request"))).toBe(
      false,
    );
  });
  test("owner authority covers every session operation", () => {
    const authorization = new SessionAuthorization(OWNER_PERMISSIONS);

    expect(
      inboundOperationTypes().every((type) => authorization.allowsInbound(inboundMessage(type))),
    ).toBe(true);
    expect(
      outboundOperationTypes().every((type) => authorization.allowsOutbound(outboundMessage(type))),
    ).toBe(true);
  });

  test("semantic permissions authorize operations instead of RPC namespaces", () => {
    const authorization = new SessionAuthorization(["hub.execute"]);

    expect(authorization.allowsInbound(inboundMessage("hub.execution.agent.create.request"))).toBe(
      true,
    );
    expect(authorization.allowsOutbound(outboundMessage("hub.execution.agent.update"))).toBe(true);
    expect(authorization.allowsInbound(inboundMessage("get_providers_snapshot_request"))).toBe(
      true,
    );
    expect(authorization.allowsInbound(inboundMessage("refresh_providers_snapshot_request"))).toBe(
      true,
    );
    expect(authorization.allowsOutbound(outboundMessage("get_providers_snapshot_response"))).toBe(
      true,
    );
    expect(authorization.allowsOutbound(outboundMessage("providers_snapshot_update"))).toBe(true);
    expect(
      authorization.allowsOutbound(outboundMessage("refresh_providers_snapshot_response")),
    ).toBe(true);
    expect(authorization.allowsInbound(inboundMessage("get_daemon_config_request"))).toBe(false);
    expect(authorization.allowsInbound(inboundMessage("provider_diagnostic_request"))).toBe(false);
    expect(authorization.allowsInbound(inboundMessage("ping"))).toBe(false);
    expect(
      authorization.allowsInbound(inboundMessage("hub.management.daemon.get_status.request")),
    ).toBe(false);
  });

  test("Hub can operate ordinary agents and recover workspaces without daemon administration", () => {
    const authorization = new SessionAuthorization(["hub.execute"]);
    for (const type of [
      "create_agent_request",
      "send_agent_message_request",
      "fetch_agent_request",
      "agent.timeline.set_subscription.request",
      "workspace.recovery.inspect.request",
      "workspace.recovery.restore.request",
    ] as const) {
      expect(authorization.allowsInbound(inboundMessage(type))).toBe(true);
    }
    for (const type of [
      "status",
      "agent_update",
      "agent_stream",
      "send_agent_message_response",
      "workspace.recovery.restore.response",
    ] as const) {
      expect(authorization.allowsOutbound(outboundMessage(type))).toBe(true);
    }
    for (const type of [
      "restart_server_request",
      "terminal_input",
      "hub.management.daemon.permissions.update.request",
    ] as const) {
      expect(authorization.allowsInbound(inboundMessage(type))).toBe(false);
    }
    expect(
      authorization.allowsOutbound({
        type: "status",
        payload: { status: "shutdown_requested", clientId: "owner", requestId: "shutdown" },
      }),
    ).toBe(false);
    authorization.replacePermissions([]);
    expect(authorization.allowsInbound(inboundMessage("send_agent_message_request"))).toBe(false);
    expect(authorization.allowsOutbound(outboundMessage("agent_update"))).toBe(false);
  });

  test("correlated authorization errors can always be emitted", () => {
    const authorization = new SessionAuthorization([]);

    expect(authorization.allowsOutbound(outboundMessage("rpc_error"))).toBe(true);
  });

  test("legacy Hub authority is translated at one compatibility boundary", () => {
    expect(permissionsForLegacyHubScopes(["hub.execution.*"])).toEqual(["hub.execute"]);
    expect(permissionsForLegacyHubScopes(["*"])).toEqual([]);
  });

  test("permission names are semantic", () => {
    expect(
      DAEMON_PERMISSIONS.every(
        (permission) => !permission.includes("*") && !permission.includes("request"),
      ),
    ).toBe(true);
  });

  test("permission parsing validates against the shared registry and removes duplicates", () => {
    expect(parseDaemonPermissions(["hub.execute", "hub.execute"])).toEqual(["hub.execute"]);
    expect(() => parseDaemonPermissions(["hub.execution.*"])).toThrow("Invalid daemon permission");
  });
});
