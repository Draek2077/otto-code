/**
 * @vitest-environment jsdom
 */
import React, { memo, useDeferredValue, useMemo, useRef } from "react";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { RetainedPanelActivity, useRetainedPanelActive } from "@/components/retained-panel";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem, TodoEntry } from "@/types/stream";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

// Expo's tsconfig sets `jsx: "react-native"`, so esbuild emits the classic
// `React.createElement` form. App components don't import the default export,
// which is fine under Metro and needs React in scope here. This suite renders
// the real RetainedPanelActivity rather than a stand-in: the context identity
// is exactly what is under test.
(globalThis as unknown as { React: typeof React }).React = React;

const settings = { pinnedTaskListEnabled: true, pinnedTaskListAutoDismiss: false };
vi.mock("@/hooks/use-settings", () => ({
  useSettings: (select: (value: typeof settings) => unknown) => select(settings),
}));

const { usePinnedTaskList } = await import("./use-pinned-task-list");
const { usePinnedTaskListStore } = await import("./store");

const SERVER = "host-1";
const AGENT = "agent-1";

function todoEntry(text: string, status: TodoEntry["status"]): TodoEntry {
  return { text, status, completed: status === "completed" };
}

function todoList(id: string, entries: TodoEntry[]): StreamItem {
  return {
    kind: "todo_list",
    id,
    timestamp: new Date("2025-01-01T00:00:00Z"),
    provider: "claude",
    items: entries,
    activity: { type: "created", count: entries.length },
  };
}

function assistant(id: string): StreamItem {
  return { kind: "assistant_message", id, text: "hi", timestamp: new Date("2025-01-01T00:00:00Z") };
}

function setTail(items: StreamItem[]): void {
  useSessionStore.getState().setAgentStreamState(SERVER, AGENT, { tail: items });
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  settings.pinnedTaskListEnabled = true;
  settings.pinnedTaskListAutoDismiss = false;
  usePinnedTaskListStore.setState({ dismissedByAgent: {} });
  useSessionStore.getState().initializeSession(SERVER, null as unknown as DaemonClient);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSessionStore.getState().clearSession(SERVER);
});

// ---------------------------------------------------------------------------
// The hook on its own: does the freeze thaw back onto live data?
// ---------------------------------------------------------------------------

let pinnedIds: (string | undefined)[] = [];

function HookProbe() {
  const pinned = usePinnedTaskList({ serverId: SERVER, agentId: AGENT });
  pinnedIds.push(pinned.item?.id);
  return null;
}

function HookHarness({ active }: { active: boolean }) {
  return (
    <RetainedPanelActivity active={active}>
      <HookProbe />
    </RetainedPanelActivity>
  );
}

function renderHook(active: boolean): void {
  act(() => {
    root.render(<HookHarness active={active} />);
  });
}

describe("usePinnedTaskList freeze/thaw", () => {
  beforeEach(() => {
    pinnedIds = [];
  });

  it("pins the live list again after the panel is hidden and shown", () => {
    setTail([todoList("t1", [todoEntry("a", "in_progress")])]);
    renderHook(true);
    expect(pinnedIds.at(-1)).toBe("t1");

    renderHook(false);
    renderHook(true);
    expect(pinnedIds.at(-1)).toBe("t1");
  });

  it("resolves the live list when the panel mounts hidden and is then shown", () => {
    setTail([todoList("t1", [todoEntry("a", "in_progress")])]);
    renderHook(false);
    expect(pinnedIds.at(-1)).toBeUndefined();

    renderHook(true);
    expect(pinnedIds.at(-1)).toBe("t1");
  });

  it("picks up a list that arrived while the panel was hidden", () => {
    setTail([assistant("m1")]);
    renderHook(true);
    expect(pinnedIds.at(-1)).toBeUndefined();

    renderHook(false);
    setTail([assistant("m1"), todoList("t2", [todoEntry("a", "pending")])]);
    renderHook(true);
    expect(pinnedIds.at(-1)).toBe("t2");
  });

  it("drops the pin when the tail is released while the panel is hidden", () => {
    setTail([todoList("t1", [todoEntry("a", "in_progress")])]);
    renderHook(true);
    expect(pinnedIds.at(-1)).toBe("t1");

    renderHook(false);
    useSessionStore.getState().releaseAgentStreams(SERVER, [AGENT]);
    renderHook(true);
    expect(pinnedIds.at(-1)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The real topology. The checklist is shown in exactly one of two places, and
// the two are decided by different components with their own freeze caches:
//
//   ChatAgentReadyContent  usePinnedTaskList -> item      (the overlay)
//     AgentStreamSection   frozen tail, filtered by id    (the transcript)
//       AgentStreamView    frozen items, then deferred
//
// If those disagree across a thaw the list shows in NEITHER. This replica keeps
// the same shape and the same hook so a sequence that breaks the agreement here
// breaks it in the panel.
// ---------------------------------------------------------------------------

interface Commit {
  overlayId: string | undefined;
  transcriptIds: string[];
}

let commits: Commit[] = [];
let overlayId: string | undefined;

const StreamView = memo(function StreamView({ streamItems }: { streamItems: StreamItem[] }) {
  const isActive = useRetainedPanelActive();
  const frozenRef = useRef(streamItems);
  if (isActive) {
    frozenRef.current = streamItems;
  }
  const effective = isActive ? streamItems : frozenRef.current;
  const deferred = useDeferredValue(effective);
  commits.push({
    overlayId,
    transcriptIds: deferred.filter((item) => item.kind === "todo_list").map((item) => item.id),
  });
  return null;
});

const StreamSection = memo(function StreamSection({
  hiddenTodoListId,
}: {
  hiddenTodoListId?: string;
}) {
  const isPanelActive = useRetainedPanelActive();
  const frozenRef = useRef<StreamItem[] | undefined>(undefined);
  const raw = useSessionStore((state) => {
    if (!isPanelActive) {
      return frozenRef.current;
    }
    return state.sessions[SERVER]?.agentStreamTail?.get(AGENT);
  });
  if (isPanelActive) {
    frozenRef.current = raw;
  }
  const rawStreamItems = raw ?? EMPTY;
  const streamItems = useMemo(() => {
    if (!hiddenTodoListId) {
      return rawStreamItems;
    }
    const filtered = rawStreamItems.filter(
      (item) => !(item.kind === "todo_list" && item.id === hiddenTodoListId),
    );
    return filtered.length === rawStreamItems.length ? rawStreamItems : filtered;
  }, [rawStreamItems, hiddenTodoListId]);
  return <StreamView streamItems={streamItems} />;
});

const EMPTY: StreamItem[] = [];

const PanelBody = memo(function PanelBody() {
  const pinned = usePinnedTaskList({ serverId: SERVER, agentId: AGENT });
  overlayId = pinned.item?.id;
  return <StreamSection hiddenTodoListId={pinned.item?.id} />;
});

function PanelHarness({ active }: { active: boolean }) {
  return (
    <RetainedPanelActivity active={active}>
      <PanelBody />
    </RetainedPanelActivity>
  );
}

function renderPanel(active: boolean): void {
  act(() => {
    root.render(<PanelHarness active={active} />);
  });
}

/** The id the store says is live right now, or undefined when there is none. */
function liveTodoId(): string | undefined {
  const tail = useSessionStore.getState().sessions[SERVER]?.agentStreamTail?.get(AGENT) ?? [];
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const item = tail[index];
    if (item?.kind === "todo_list") {
      return item.id;
    }
  }
  return undefined;
}

/**
 * The invariant, checked on the settled commit: the live checklist is pinned in
 * the overlay or present inline, never in neither and never in both.
 */
function expectShownExactlyOnce(): void {
  const id = liveTodoId();
  const settled = commits.at(-1);
  expect(settled, "the panel committed at least once").toBeDefined();
  const inOverlay = settled?.overlayId === id;
  const inTranscript = settled?.transcriptIds.includes(id ?? "") ?? false;
  expect(
    { id, inOverlay, inTranscript, settled },
    "the live checklist shows in exactly one place",
  ).toMatchObject({ inOverlay: !inTranscript });
}

describe("pinned checklist and transcript agree across a thaw", () => {
  beforeEach(() => {
    commits = [];
    overlayId = undefined;
  });

  it("keeps the list pinned once, returning to a chat that already had one", () => {
    setTail([assistant("m1"), todoList("t1", [todoEntry("a", "in_progress")])]);
    renderPanel(true);
    expectShownExactlyOnce();

    renderPanel(false);
    renderPanel(true);
    expectShownExactlyOnce();
    expect(commits.at(-1)?.overlayId).toBe("t1");
  });

  it("pins a list that first appeared while the chat was in the background", () => {
    setTail([assistant("m1")]);
    renderPanel(true);
    renderPanel(false);
    setTail([assistant("m1"), todoList("t1", [todoEntry("a", "pending")])]);
    renderPanel(true);
    expectShownExactlyOnce();
    expect(commits.at(-1)?.overlayId).toBe("t1");
  });

  it("follows a checklist that was replaced by a newer one while hidden", () => {
    setTail([todoList("t1", [todoEntry("a", "completed")])]);
    renderPanel(true);
    renderPanel(false);
    setTail([
      todoList("t1", [todoEntry("a", "completed")]),
      assistant("m1"),
      todoList("t2", [todoEntry("b", "in_progress")]),
    ]);
    renderPanel(true);
    expectShownExactlyOnce();
    expect(commits.at(-1)?.overlayId).toBe("t2");
  });

  it("settles the list inline when it was dismissed before leaving", () => {
    setTail([todoList("t1", [todoEntry("a", "in_progress")])]);
    renderPanel(true);
    act(() => {
      usePinnedTaskListStore.getState().dismiss(`${SERVER}:${AGENT}`, "t1");
    });
    renderPanel(false);
    renderPanel(true);
    expectShownExactlyOnce();
    expect(commits.at(-1)?.overlayId).toBeUndefined();
  });

  it("settles the list inline when the feature is switched off while hidden", () => {
    setTail([todoList("t1", [todoEntry("a", "in_progress")])]);
    renderPanel(true);
    renderPanel(false);
    settings.pinnedTaskListEnabled = false;
    renderPanel(true);
    expectShownExactlyOnce();
    expect(commits.at(-1)?.overlayId).toBeUndefined();
  });

  it("pins the list again after the chat tab was evicted and remounted", () => {
    setTail([todoList("t1", [todoEntry("a", "in_progress")])]);
    renderPanel(true);
    act(() => {
      root.render(null);
    });
    renderPanel(true);
    expectShownExactlyOnce();
    expect(commits.at(-1)?.overlayId).toBe("t1");
  });

  it("pins the list when the chat tab is remounted in the background first", () => {
    setTail([todoList("t1", [todoEntry("a", "in_progress")])]);
    renderPanel(true);
    act(() => {
      root.render(null);
    });
    renderPanel(false);
    renderPanel(true);
    expectShownExactlyOnce();
    expect(commits.at(-1)?.overlayId).toBe("t1");
  });
});
