import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createKeyboardActionDispatcher,
  type KeyboardActionDefinition,
} from "./keyboard-action-dispatcher";

// Settings persistence has its own tests. Supply the display-mode boundary here
// so these dispatcher tests do not boot React Native storage and its Flow loader.
const mode = vi.hoisted(() => ({ developer: true }));
vi.mock("@/hooks/use-interface-mode", () => ({
  getIsDeveloperModeSnapshot: () => mode.developer,
}));

describe("keyboard-action-dispatcher", () => {
  let dispatcher: ReturnType<typeof createKeyboardActionDispatcher>;

  beforeEach(() => {
    dispatcher = createKeyboardActionDispatcher();
    mode.developer = true;
  });

  it("dispatches to the highest-priority active handler", () => {
    const calls: string[] = [];
    const action: KeyboardActionDefinition = {
      id: "message-input.dictation-toggle",
      scope: "message-input",
    };

    dispatcher.registerHandler({
      handlerId: "low",
      actions: [action.id],
      enabled: true,
      priority: 100,
      isActive: () => true,
      handle: () => {
        calls.push("low");
        return true;
      },
    });

    dispatcher.registerHandler({
      handlerId: "high",
      actions: [action.id],
      enabled: true,
      priority: 200,
      isActive: () => true,
      handle: () => {
        calls.push("high");
        return true;
      },
    });

    const handled = dispatcher.dispatch(action);

    expect(handled).toBe(true);
    expect(calls).toEqual(["high"]);
  });

  it("skips disabled and inactive handlers", () => {
    const handle = vi.fn(() => true);
    const action: KeyboardActionDefinition = {
      id: "message-input.dictation-toggle",
      scope: "message-input",
    };

    dispatcher.registerHandler({
      handlerId: "disabled",
      actions: [action.id],
      enabled: false,
      priority: 300,
      isActive: () => true,
      handle,
    });

    dispatcher.registerHandler({
      handlerId: "inactive",
      actions: [action.id],
      enabled: true,
      priority: 200,
      isActive: () => false,
      handle,
    });

    dispatcher.registerHandler({
      handlerId: "active",
      actions: [action.id],
      enabled: true,
      priority: 100,
      isActive: () => true,
      handle,
    });

    const handled = dispatcher.dispatch(action);

    expect(handled).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("dispatches to the active mounted tab when a newer hidden tab is inactive", () => {
    const calls: string[] = [];
    const action: KeyboardActionDefinition = {
      id: "message-input.dictation-toggle",
      scope: "message-input",
    };

    dispatcher.registerHandler({
      handlerId: "visible-tab",
      actions: [action.id],
      enabled: true,
      priority: 100,
      isActive: () => true,
      handle: () => {
        calls.push("visible-tab");
        return true;
      },
    });

    dispatcher.registerHandler({
      handlerId: "hidden-tab",
      actions: [action.id],
      enabled: true,
      priority: 100,
      isActive: () => false,
      handle: () => {
        calls.push("hidden-tab");
        return true;
      },
    });

    const handled = dispatcher.dispatch(action);

    expect(handled).toBe(true);
    expect(calls).toEqual(["visible-tab"]);
  });

  it("tries lower-priority handlers when a higher one does not consume the action", () => {
    const calls: string[] = [];
    const action: KeyboardActionDefinition = {
      id: "message-input.focus",
      scope: "message-input",
    };

    dispatcher.registerHandler({
      handlerId: "first",
      actions: [action.id],
      enabled: true,
      priority: 200,
      isActive: () => true,
      handle: () => {
        calls.push("first");
        return false;
      },
    });

    dispatcher.registerHandler({
      handlerId: "second",
      actions: [action.id],
      enabled: true,
      priority: 100,
      isActive: () => true,
      handle: () => {
        calls.push("second");
        return true;
      },
    });

    const handled = dispatcher.dispatch(action);

    expect(handled).toBe(true);
    expect(calls).toEqual(["first", "second"]);
  });

  it("does not dispatch after a handler is unregistered", () => {
    const handle = vi.fn(() => true);
    const action: KeyboardActionDefinition = {
      id: "message-input.dictation-cancel",
      scope: "message-input",
    };

    const unregister = dispatcher.registerHandler({
      handlerId: "handler",
      actions: [action.id],
      enabled: true,
      priority: 100,
      isActive: () => true,
      handle,
    });

    unregister();

    const handled = dispatcher.dispatch(action);

    expect(handled).toBe(false);
    expect(handle).not.toHaveBeenCalled();
  });

  it("does not let an old registration remove its same-id replacement", () => {
    const oldHandle = vi.fn(() => true);
    const replacementHandle = vi.fn(() => true);
    const action: KeyboardActionDefinition = {
      id: "workspace.tab.target.agent",
      scope: "workspace",
    };

    const unregisterOld = dispatcher.registerHandler({
      handlerId: "workspace-new-tab-menu:server:pane",
      actions: [action.id],
      enabled: true,
      priority: 200,
      handle: oldHandle,
    });
    dispatcher.registerHandler({
      handlerId: "workspace-new-tab-menu:server:pane",
      actions: [action.id],
      enabled: true,
      priority: 200,
      handle: replacementHandle,
    });

    unregisterOld();

    expect(dispatcher.dispatch(action)).toBe(true);
    expect(replacementHandle).toHaveBeenCalledOnce();
    expect(oldHandle).not.toHaveBeenCalled();
  });

  it("keeps Search available while User mode blocks the Git Explorer action", () => {
    mode.developer = false;
    const search = vi.fn(() => true);
    const changes = vi.fn(() => true);
    dispatcher.registerHandler({
      handlerId: "search",
      actions: ["sidebar.open.search"],
      enabled: true,
      priority: 100,
      handle: search,
    });
    dispatcher.registerHandler({
      handlerId: "changes",
      actions: ["sidebar.open.changes"],
      enabled: true,
      priority: 100,
      handle: changes,
    });

    expect(dispatcher.dispatch({ id: "sidebar.open.search", scope: "sidebar" })).toBe(true);
    expect(dispatcher.dispatch({ id: "sidebar.open.changes", scope: "sidebar" })).toBe(false);
    expect(search).toHaveBeenCalledOnce();
    expect(changes).not.toHaveBeenCalled();
  });
  it.each(["workspace.pane.split.right", "workspace.pane.split.down"] as const)(
    "allows %s in User mode",
    (id) => {
      mode.developer = false;
      const handle = vi.fn(() => true);
      dispatcher.registerHandler({
        handlerId: "split",
        actions: [id],
        enabled: true,
        priority: 100,
        handle,
      });
      expect(dispatcher.dispatch({ id, scope: "workspace" })).toBe(true);
      expect(handle).toHaveBeenCalledOnce();
    },
  );
});
