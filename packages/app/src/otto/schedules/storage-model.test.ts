import { describe, expect, it, vi } from "vitest";
import { ScheduleStorageModel } from "./storage-model";

type Port = ConstructorParameters<typeof ScheduleStorageModel>[0];
const defaults = { location: "repository" as const, revision: "d1" };
const storage = {
  scope: { hostId: "host", projectId: "project" },
  hostLabel: "Host",
  projectLabel: "Project",
  location: "repository" as const,
  override: null,
  revision: "p1",
  hostDefault: "repository" as const,
};
async function fixture(saveStorage: Port["saveStorage"]) {
  const api: Port = {
    defaults: async () => defaults,
    storage: async () => storage,
    saveDefaults: async () => defaults,
    saveStorage,
  };
  const model = new ScheduleStorageModel(api, "host", "project");
  const close = model.activate();
  await vi.waitFor(() => expect(model.getSnapshot().storage).not.toBeNull());
  return { model, close };
}
describe("Schedule storage preferences", () => {
  it("automatically serializes newer choices using only its own acknowledged revision", async () => {
    let finish: (value: Awaited<ReturnType<Port["saveStorage"]>>) => void = () => {
      throw new Error("not started");
    };
    const save = vi
      .fn<Port["saveStorage"]>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async ({ location }) => ({
        ...storage,
        revision: "p3",
        override: location,
      }));
    const { model, close } = await fixture(save);
    model.project("host");
    model.project("repository");
    expect(save).toHaveBeenCalledTimes(1);
    finish({ ...storage, revision: "p2", override: "host" });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls.map(([input]) => input.expectedRevision)).toEqual(["p1", "p2"]);
    expect(save.mock.calls[1]?.[0].location).toBe("repository");
    close();
  });
  it("retains failed selections without automatic retries or settings reads", async () => {
    const save = vi.fn<Port["saveStorage"]>(async () => {
      throw new Error("unconfirmed");
    });
    const { model, close } = await fixture(save);
    model.project("host");
    await vi.waitFor(() => expect(model.lane.getSnapshot().blocked).toBe(true));
    model.project("repository");
    expect(save).toHaveBeenCalledTimes(1);
    expect(model.getSnapshot()).toMatchObject({
      projectDraft: "host",
      storage: { revision: "p1" },
    });
    close();
  });
  it("keeps hidden write outcomes blocked and never queues another hidden change", async () => {
    let finish: (value: Awaited<ReturnType<Port["saveStorage"]>>) => void = () => {
      throw new Error("not started");
    };
    const save = vi.fn<Port["saveStorage"]>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { model, close } = await fixture(save);
    model.project("host");
    model.project("repository");
    close();
    finish({ ...storage, revision: "late", override: "host" });
    await vi.waitFor(() => expect(model.lane.getSnapshot().busy).toBe(false));
    expect(save).toHaveBeenCalledTimes(1);
    expect(model.getSnapshot().storage?.revision).toBe("p1");
    expect(model.lane.getSnapshot().blocked).toBe(true);
  });
});
