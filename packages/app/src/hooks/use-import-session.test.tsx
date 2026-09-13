/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useImportSession, useNavigateToImportedAgent } from "./use-import-session";
const state = vi.hoisted(() => ({
  choose: vi.fn(),
  push: vi.fn(),
  openProject: vi.fn(),
  client: {},
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/import-session-sheet", () => ({ ImportSessionSheet: () => null }));
vi.mock("@/hosts/host-chooser", () => ({ useHostChooser: () => state.choose }));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeClient: () => state.client }));
vi.mock("@/hooks/use-open-project", () => ({ useOpenProject: () => state.openProject }));
vi.mock("@/utils/host-routes", () => ({
  buildHostAgentDetailRoute: (host: string, id: string) => "/" + host + "/agent/" + id,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("global Import session entry", () => {
  it("chooses a host before opening the sheet and keeps that host as the sheet owner", () => {
    const { result } = renderHook(() => useImportSession());
    act(() => result.current.open());
    expect(state.choose).toHaveBeenCalledTimes(1);
    expect((result.current.sheet as React.ReactElement<{ visible: boolean }>).props.visible).toBe(
      false,
    );
    act(() => state.choose.mock.calls[0][0].onChooseHost("remote"));
    expect(
      (result.current.sheet as React.ReactElement<{ visible: boolean; serverId: string }>).props,
    ).toMatchObject({ visible: true, serverId: "remote" });
  });
  it("uses the supplied workspace scope without opening a second chooser", () => {
    const { result } = renderHook(() =>
      useImportSession({ serverId: "host", cwd: "/repo", workspaceId: "existing" }),
    );
    act(() => result.current.open());
    expect(state.choose).not.toHaveBeenCalled();
    expect((result.current.sheet as React.ReactElement<{ serverId: string }>).props).toMatchObject({
      serverId: "host",
      cwd: "/repo",
      workspaceId: "existing",
    });
  });
  it("opens the actual imported or reused agent directory before routing to its identity", async () => {
    state.openProject.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useNavigateToImportedAgent(" remote "));
    await act(async () => result.current({ id: "already-imported", cwd: "/other-project" }));
    expect(state.openProject).toHaveBeenCalledWith("/other-project");
    expect(state.push).toHaveBeenCalledWith("/remote/agent/already-imported");
    expect(state.openProject.mock.invocationCallOrder[0]).toBeLessThan(
      state.push.mock.invocationCallOrder[0],
    );
  });
  it("does not route to a workspace that failed to open", async () => {
    state.openProject.mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useNavigateToImportedAgent("remote"));
    await act(async () => result.current({ id: "session", cwd: "/missing" }));
    expect(state.push).not.toHaveBeenCalled();
  });
});
