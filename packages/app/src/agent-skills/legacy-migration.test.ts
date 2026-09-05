import { describe, expect, it } from "vitest";
import type { AgentSkillSelection } from "@otto-code/protocol/messages";
import {
  createLegacyMigrationController,
  type LegacyMigrationPorts,
  type LegacySelectionClient,
} from "./legacy-migration-controller";

function harness() {
  const order: string[] = [];
  const selections: AgentSkillSelection[] = [];
  const errors: unknown[] = [];
  const timers = new Set<() => void>();
  const state = {
    selection: { mode: "custom", skills: ["otto"] } as AgentSkillSelection | null,
    status: { status: "running", desktopManaged: true, serverId: "local", pid: 123 },
    connected: true,
    readFailure: false,
    importFailure: false,
    deleteFailure: false,
  };
  const client: LegacySelectionClient = {
    async importLegacyAgentSkillsSelection(selection) {
      order.push("persist");
      if (state.importFailure) throw new Error("offline");
      selections.push(selection);
    },
  };
  const ports: LegacyMigrationPorts = {
    async getLocalStatus() {
      return state.status;
    },
    getConnectedClient(id) {
      return id === "local" && state.connected ? client : null;
    },
    async read() {
      order.push("read");
      if (state.readFailure) throw new Error("unreadable");
      return state.selection;
    },
    async remove() {
      order.push("delete");
      if (state.deleteFailure) throw new Error("locked");
      state.selection = null;
    },
    schedule(callback) {
      timers.add(callback);
      return () => timers.delete(callback);
    },
    onError(error) {
      errors.push(error);
    },
  };
  return { state, ports, order, selections, errors, timers };
}

describe("legacy agent skills migration", () => {
  it("retains an eligible connection notification while status IPC is in flight", async () => {
    const h = harness();
    let finishStatus!: (status: typeof h.state.status) => void;
    let calls = 0;
    h.ports.getLocalStatus = () =>
      ++calls === 1
        ? new Promise((resolve) => {
            finishStatus = resolve;
          })
        : Promise.resolve(h.state.status);
    const migration = createLegacyMigrationController(h.ports);
    const first = migration.refresh();
    void migration.refresh();
    finishStatus({ ...h.state.status, status: "stopped" });
    await first;
    await migration.refresh();
    expect(calls).toBe(2);
    expect(h.selections).toEqual([{ mode: "custom", skills: ["otto"] }]);
    migration.dispose();
  });
  it("keeps retry delay authoritative across repeated runtime notifications", async () => {
    const h = harness();
    h.state.readFailure = true;
    const migration = createLegacyMigrationController(h.ports);
    await migration.refresh();
    const retries = [...h.timers];
    await Promise.all(Array.from({ length: 20 }, () => migration.refresh()));
    expect(h.order).toEqual(["read"]);
    expect([...h.timers]).toEqual(retries);
    expect(h.errors).toHaveLength(1);
    migration.dispose();
  });

  it("attempts immediately when the first local connection becomes eligible", async () => {
    const h = harness();
    h.state.connected = false;
    const migration = createLegacyMigrationController(h.ports);
    await migration.refresh();
    expect(h.timers.size).toBe(0);
    h.state.connected = true;
    await migration.refresh();
    expect(h.selections).toEqual([{ mode: "custom", skills: ["otto"] }]);
  });
  it("persists through the locally identified client before deleting the source, once", async () => {
    const h = harness();
    const migration = createLegacyMigrationController(h.ports);
    await Promise.all([migration.refresh(), migration.refresh()]);
    await migration.refresh();
    expect(h.order).toEqual(["read", "persist", "delete"]);
    expect(h.selections).toEqual([{ mode: "custom", skills: ["otto"] }]);
    expect(h.state.selection).toBe(null);
    expect(h.timers.size).toBe(0);
  });

  it.each(["readFailure", "importFailure", "deleteFailure"] as const)(
    "retains the source and retries %s without a new host notification",
    async (failure) => {
      const h = harness();
      h.state[failure] = true;
      const migration = createLegacyMigrationController(h.ports);
      await migration.refresh();
      expect(h.state.selection).toEqual({ mode: "custom", skills: ["otto"] });
      expect(h.errors).toHaveLength(1);
      expect(h.timers.size).toBe(1);
      h.state[failure] = false;
      const retry = [...h.timers][0]!;
      h.timers.delete(retry);
      retry();
      await migration.refresh();
      expect(h.state.selection).toBe(null);
      expect(h.timers.size).toBe(0);
      expect(h.order.at(-1)).toBe("delete");
    },
  );

  it.each([
    { selection: null, expected: { mode: "all" } },
    { selection: { mode: "all" }, expected: { mode: "all" } },
    { selection: { mode: "custom", skills: [] }, expected: { mode: "custom", skills: [] } },
  ] satisfies { selection: AgentSkillSelection | null; expected: AgentSkillSelection }[])(
    "resolves absence/all/custom-empty distinctly: $selection",
    async ({ selection, expected }) => {
      const h = harness();
      h.state.selection = selection;
      await createLegacyMigrationController(h.ports).refresh();
      expect(h.selections).toEqual([expected]);
      expect(h.order).toEqual(selection ? ["read", "persist", "delete"] : ["read", "persist"]);
    },
  );

  it("never reads or imports for another connected host, even when it is managed", async () => {
    const h = harness();
    h.state.connected = false;
    const remoteImports: AgentSkillSelection[] = [];
    const remote: LegacySelectionClient = {
      async importLegacyAgentSkillsSelection(selection) {
        remoteImports.push(selection);
      },
    };
    h.ports.getConnectedClient = (id) => (id === "remote" ? remote : null);
    const migration = createLegacyMigrationController(h.ports);
    await migration.refresh();
    expect(h.order).toEqual([]);
    expect(remoteImports).toEqual([]);
    migration.dispose();
    expect(h.timers.size).toBe(0);
  });

  it.each([{ status: "stopped" }, { desktopManaged: false }, { serverId: "" }, { pid: 0 }])(
    "requires a live local managed status: %j",
    async (status) => {
      const h = harness();
      Object.assign(h.state.status, status);
      const migration = createLegacyMigrationController(h.ports);
      await migration.refresh();
      expect(h.order).toEqual([]);
      migration.dispose();
    },
  );

  it("does not import when closed during the read boundary", async () => {
    const h = harness();
    let finishRead!: (selection: AgentSkillSelection) => void;
    h.ports.read = () =>
      new Promise((resolve) => {
        finishRead = resolve;
      });
    const migration = createLegacyMigrationController(h.ports);
    const attempt = migration.refresh();
    await Promise.resolve();
    migration.dispose();
    finishRead({ mode: "custom", skills: ["otto"] });
    await attempt;
    expect(h.selections).toEqual([]);
    expect(h.timers.size).toBe(0);
  });

  it("does not import when the local connection changes while reading", async () => {
    const h = harness();
    h.ports.read = async () => {
      h.state.connected = false;
      return h.state.selection;
    };
    const migration = createLegacyMigrationController(h.ports);
    await migration.refresh();
    expect(h.selections).toEqual([]);
    expect(h.state.selection).toEqual({ mode: "custom", skills: ["otto"] });
    migration.dispose();
  });
});
