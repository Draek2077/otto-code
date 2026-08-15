import { describe, expect, test } from "vitest";
import {
  ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES,
  ZOOM_TEAM_CHAT_OAUTH_SCOPES,
  ZOOM_TEAM_CHAT_PORTAL_APPROVED_SCOPES,
} from "./zoom-team-chat-oauth.js";

describe("Zoom Team Chat scope contract", () => {
  test("keeps every currently called operation approved in Marketplace and granted by OAuth", () => {
    const approved = new Set(ZOOM_TEAM_CHAT_PORTAL_APPROVED_SCOPES);
    const requested = new Set(ZOOM_TEAM_CHAT_OAUTH_SCOPES);

    for (const scope of Object.values(ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES)) {
      expect(approved).toContain(scope);
      expect(requested).toContain(scope);
    }
  });

  test("keeps the Marketplace inventory duplicate-free", () => {
    expect(new Set(ZOOM_TEAM_CHAT_PORTAL_APPROVED_SCOPES).size).toBe(
      ZOOM_TEAM_CHAT_PORTAL_APPROVED_SCOPES.length,
    );
  });
});
