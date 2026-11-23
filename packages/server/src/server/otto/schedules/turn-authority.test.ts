import { expect, test, vi } from "vitest";
import { AgentManager } from "../../agent/agent-manager.js";
import type { AgentSession } from "../../agent/agent-sdk-types.js";
import { createTestAgentClient } from "../../test-utils/fake-agent-client.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { workflowFixture } from "../workflows/test-utils/fixture.js";
import { deferred } from "../workflows/test-utils/host-fixture.js";
import {
  assertScheduleTurn,
  assertScheduleTurnAvailable,
  recordScheduleTurn,
  scheduleTurnOptions,
  ownsScheduleTurn,
  type ScheduleTurnReceipt,
} from "./turn-authority.js";

async function fixture() {
  const f = await workflowFixture();
  const finish = deferred<void>();
  const interrupt = deferred<void>();
  const nextFinish = deferred<void>();
  let turns = 0;
  let session: AgentSession | null = null;
  const client = createTestAgentClient("codex", {
    beforeTurnComplete: async () => {
      turns += 1;
      await (turns === 1 ? finish.promise : nextFinish.promise);
    },
  });
  const createSession = client.createSession.bind(client);
  const interruptions = vi.fn(async () => {
    await interrupt.promise;
  });
  vi.spyOn(client, "createSession").mockImplementation(async (...args) => {
    session = await createSession(...args);
    vi.spyOn(session, "interrupt").mockImplementation(interruptions);
    return session;
  });
  const manager = new AgentManager({
    clients: { codex: client },
    logger: createTestLogger(),
    rescueTimeouts: { interruptSessionMs: 5 },
  });
  const agent = await manager.createAgent({ provider: "codex", cwd: f.repo }, undefined, {
    workspaceId: undefined,
  });
  const accepted = deferred<ScheduleTurnReceipt>();
  let active = true;
  const options = scheduleTurnOptions(agent.id, () => active, accepted.resolve);
  return {
    ...f,
    manager,
    agent,
    accepted,
    options,
    finish,
    interrupt,
    nextFinish,
    interruptions,
    session: () => {
      if (!session) throw new Error("Session not created");
      return session;
    },
    revoke: () => {
      active = false;
    },
    async cleanup() {
      finish.resolve();
      interrupt.resolve();
      nextFinish.resolve();
      await manager.closeAgent(agent.id);
      await f.cleanup();
    },
  };
}

test("private turn options admit once and invalidate a late iterator without changing ordinary options", () => {
  let active = true;
  const options = scheduleTurnOptions(
    "agent",
    () => active,
    () => {},
  );
  expect(options).toEqual({});
  expect(() => assertScheduleTurn(options, "other", "admit")).toThrow();
  assertScheduleTurn(options, "agent", "admit");
  expect(() => assertScheduleTurn(options, "agent", "admit")).toThrow();
  active = false;
  expect(() => assertScheduleTurn(options, "agent", "execute")).toThrow("revoked");
  expect(() => assertScheduleTurn({ maxThinkingTokens: 10 }, "agent", "admit")).not.toThrow();
});
test("a receipt cannot be forged, serialized or transferred to a replacement provider session", () => {
  let receipt: ScheduleTurnReceipt | undefined;
  const options = scheduleTurnOptions(
    "agent",
    () => true,
    (value) => {
      receipt = value;
    },
  );
  const session = {};
  recordScheduleTurn(options, "agent", "turn-1", session);
  if (!receipt) throw new Error("No receipt");
  expect(ownsScheduleTurn(receipt, "agent", "turn-1", session)).toBe(true);
  expect(ownsScheduleTurn({ ...receipt }, "agent", "turn-1", session)).toBe(false);
  expect(ownsScheduleTurn(receipt, "agent", "turn-1", {})).toBe(false);
  expect(ownsScheduleTurn(receipt, "agent", "turn-2", session)).toBe(false);
});
test("actual manager rejects a stale receipt instead of interrupting a subsequent manual turn", async () => {
  const f = await fixture();
  let first: Promise<unknown> | null = null;
  let second: Promise<unknown> | null = null;
  try {
    first = f.manager.runAgent(f.agent.id, "First Schedule work", f.options);
    const receipt = await f.accepted.promise;
    f.finish.resolve();
    await first;
    const manual = f.manager.streamAgent(f.agent.id, "Manual work");
    const started = await manual.next();
    expect(started.value).toMatchObject({ type: "turn_started" });
    second = (async () => {
      for await (const _event of manual) {
        /* Drain the injected provider. */
      }
    })();
    expect(await f.manager.cancelAgentRun(f.agent.id, receipt)).toEqual({ status: "not_running" });
    expect(f.interruptions).not.toHaveBeenCalled();
    f.nextFinish.resolve();
    await second;
  } finally {
    f.finish.resolve();
    f.nextFinish.resolve();
    await Promise.allSettled([first, second]);
    await f.cleanup();
  }
});
test("a timed-out exact cancellation retains its fence after old completion until the real interrupt settles", async () => {
  const f = await fixture();
  let run: Promise<unknown> | null = null;
  try {
    run = f.manager.runAgent(f.agent.id, "Schedule work", f.options);
    const receipt = await f.accepted.promise;
    expect(await f.manager.cancelAgentRun(f.agent.id, receipt)).toEqual({ status: "refused" });
    expect(f.interruptions).toHaveBeenCalledTimes(1);
    f.finish.resolve();
    await run;
    expect(f.manager.hasInFlightRun(f.agent.id)).toBe(false);
    expect(() => f.manager.streamAgent(f.agent.id, "Later manual work")).toThrow("still settling");
    expect(() => f.manager.tryRunOutOfBand(f.agent.id, "/command")).toThrow("still settling");
    await expect(f.manager.reloadAgentSession(f.agent.id)).rejects.toThrow("still settling");
    f.interrupt.resolve();
    await f.interruptions.mock.results[0].value;
    // Await the same provider-operation promise's finally, rather than a delay or retry.
    await Promise.resolve();
    expect(() => assertScheduleTurnAvailable(f.manager, f.agent.id)).not.toThrow();
    f.nextFinish.resolve();
    await f.manager.runAgent(f.agent.id, "Manual after real settlement");
  } finally {
    f.finish.resolve();
    f.interrupt.resolve();
    f.nextFinish.resolve();
    await Promise.allSettled([run]);
    await f.cleanup();
  }
});
test("revoking a claimed but unconsumed manager iterator does not call the provider", async () => {
  const f = await fixture();
  try {
    const start = vi.spyOn(f.session(), "startTurn");
    const iterator = f.manager.streamAgent(f.agent.id, "Unconsumed", f.options);
    f.revoke();
    await expect(iterator.next()).rejects.toThrow("revoked");
    expect(start).not.toHaveBeenCalled();
    expect(f.manager.hasInFlightRun(f.agent.id)).toBe(false);
  } finally {
    await f.cleanup();
  }
});
test("an actual pending Schedule start cannot be replaced or canceled into a later manual turn", async () => {
  const f = await fixture();
  const release = deferred<void>();
  const entered = deferred<void>();
  const startTurn = f.session().startTurn.bind(f.session());
  vi.spyOn(f.session(), "startTurn").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return startTurn(...args);
  });
  let run: Promise<unknown> | null = null;
  try {
    run = f.manager.runAgent(f.agent.id, "Pending Schedule", f.options);
    await entered.promise;
    expect(() => f.manager.streamAgent(f.agent.id, "Manual replacement")).toThrow("still settling");
    await expect(f.manager.cancelAgentRun(f.agent.id)).rejects.toThrow("still settling");
    await expect(f.manager.reloadAgentSession(f.agent.id)).rejects.toThrow("still settling");
    f.revoke();
    release.resolve();
    const receipt = await f.accepted.promise;
    expect(ownsScheduleTurn(receipt, f.agent.id, receipt.turnId, f.session())).toBe(true);
    expect(await f.manager.cancelAgentRun(f.agent.id, receipt)).toEqual({ status: "refused" });
    f.finish.resolve();
    await run;
    expect(f.interruptions).toHaveBeenCalledTimes(1);
  } finally {
    release.resolve();
    f.finish.resolve();
    f.interrupt.resolve();
    await Promise.allSettled([run]);
    await f.cleanup();
  }
});
