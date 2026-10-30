import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorSummarySchema,
  type ConnectorsSnapshot,
  type writeConnectors,
} from "@getpaseo/plugin/otto/connectors";
import { openConnectorForm, type ConnectorForm } from "./form-model";

const forms: ConnectorForm[] = [];
afterEach(() => {
  for (const form of forms.splice(0)) form.close();
  vi.useRealTimers();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const connection = ConnectorSummarySchema.parse({
  id: "saved",
  label: "Saved",
  catalogId: null,
  enabled: false,
  disabledTools: [],
  server: {
    type: "http",
    endpoint: "https://fixture.invalid/mcp",
    command: null,
    argumentCount: 0,
    environmentNames: [],
    headerNames: [],
  },
  authorization: { state: "disconnected", account: null, scopes: [], message: null },
  verification: {
    state: "unverified",
    checkedAt: null,
    fingerprint: null,
    message: null,
    tools: [],
  },
});
const snapshot = (revision = "origin"): ConnectorsSnapshot => ({
  revision,
  connectors: [connection],
  detail: connection,
  providers: [],
});
function fixture(initial = snapshot()) {
  type Ports = Parameters<typeof openConnectorForm>[2];
  let readOperation: Ports["read"] = async () => ({ ok: true, value: snapshot("read") });
  let writeOperation: Ports["write"] = async () => ({ ok: true, value: snapshot("accepted") });
  let confirmOperation: Ports["confirmDiscard"] = async () => true;
  const write = vi.fn<Ports["write"]>((input) => writeOperation(input));
  const read = vi.fn<Ports["read"]>((input) => readOperation(input));
  const open = vi.fn<Ports["open"]>(async () => undefined);
  const authorize = vi.fn<Ports["authorize"]>(async () => ({
    ok: true,
    value: { authorizationUrl: "https://auth.fixture.invalid/consent", callback: "hosted" },
  }));
  const model = openConnectorForm("host", initial, {
    read,
    write,
    authorize,
    open,
    confirmDiscard: () => confirmOperation(),
  });
  forms.push(model);
  model.setActive(true);
  return {
    model,
    write,
    read,
    open,
    authorize,
    reader(value: Ports["read"]) {
      readOperation = value;
    },
    writer(value: Ports["write"]) {
      writeOperation = value;
    },
    confirm(value: Ports["confirmDiscard"]) {
      confirmOperation = value;
    },
  };
}
function custom(host: ReturnType<typeof fixture>) {
  host.model.add(null);
  host.model.edit({
    label: "Custom",
    url: "https://fixture.invalid/mcp",
    headers: '{"Authorization":"private-draft-key"}',
  });
}

describe("Connector Settings form", () => {
  it("retains loopback consent for explicit host-browser open/copy instead of opening a remote client's localhost", async () => {
    const host = fixture();
    host.authorize.mockResolvedValue({
      ok: true,
      value: {
        authorizationUrl: "https://auth.fixture.invalid/consent",
        callback: "host-loopback",
      },
    });
    await host.model.connect();
    expect(host.open).not.toHaveBeenCalled();
    expect(host.model.getSnapshot()).toMatchObject({
      authorizationUrl: "https://auth.fixture.invalid/consent",
      callback: "host-loopback",
    });
    await host.model.reopenConsent();
    expect(host.open).toHaveBeenCalledExactlyOnceWith("https://auth.fixture.invalid/consent");
  });
  it("constructs without RPC, selects catalog defaults, and submits one revision-pinned write", async () => {
    const host = fixture();
    expect(host.read).not.toHaveBeenCalled();
    expect(host.write).not.toHaveBeenCalled();
    host.model.add("notion");
    expect(host.model.getSnapshot().draft?.label).toBe("Notion");
    await host.model.save();
    expect(host.write).toHaveBeenCalledExactlyOnceWith({
      hostId: "host",
      expectedRevision: "origin",
      action: {
        kind: "add",
        label: "Notion",
        setup: { kind: "catalog", catalogId: "notion", roots: [] },
      },
    });
    expect(host.model.getSnapshot().draft).toBeNull();
  });
  it("supports custom HTTP, SSE, and command configuration without returning saved credentials", async () => {
    const host = fixture();
    custom(host);
    host.model.edit({ type: "sse" });
    await host.model.save();
    expect(host.write.mock.calls[0][0].action).toMatchObject({
      setup: { server: { type: "sse", headers: { Authorization: "private-draft-key" } } },
    });
    host.model.add(null);
    host.model.edit({
      label: "Local",
      type: "stdio",
      command: "node",
      args: '["server.mjs"]',
      environment: '{"TOKEN":"write-only"}',
    });
    await host.model.save();
    expect(host.write.mock.calls[1][0].action).toMatchObject({
      setup: {
        server: {
          type: "stdio",
          command: "node",
          args: ["server.mjs"],
          env: { TOKEN: "write-only" },
        },
      },
    });
    host.model.editConnection();
    expect(host.model.getSnapshot().draft).toMatchObject({
      replace: false,
      headers: "{}",
      environment: "{}",
      credential: "",
    });
  });
  it("rejects malformed JSON and empty names without sending a request", async () => {
    const host = fixture();
    custom(host);
    host.model.edit({ headers: "not-json" });
    await host.model.save();
    expect(host.write).not.toHaveBeenCalled();
    expect(host.model.getSnapshot().draft?.headers).toBe("not-json");
    host.model.edit({ headers: "{}", label: "" });
    await host.model.save();
    expect(host.write).not.toHaveBeenCalled();
  });
  it.each(["validation", "conflict", "uncertain"] as const)(
    "retains secret drafts after %s and never rebases automatically",
    async (kind) => {
      const host = fixture();
      custom(host);
      host.writer(async () => ({ ok: false, error: { kind, message: "Save rejected" } }));
      await host.model.save();
      expect(host.model.getSnapshot().draft?.headers).toContain("private-draft-key");
      expect(host.model.getSnapshot().blocked).toBe(kind !== "validation");
      if (kind === "validation") {
        host.model.edit({ label: "Corrected" });
        await host.model.save();
        expect(host.write.mock.calls[1][0].expectedRevision).toBe("origin");
      } else {
        await host.model.save();
        expect(host.write).toHaveBeenCalledTimes(1);
      }
    },
  );
  it("serializes submissions and treats a hidden save as an unknown outcome until explicit reload", async () => {
    const host = fixture();
    custom(host);
    const pending = deferred<ReturnType<typeof writeConnectors.output.parse>>();
    host.writer(() => pending.promise);
    const saving = host.model.save();
    await host.model.save();
    expect(host.write).toHaveBeenCalledTimes(1);
    host.model.setActive(false);
    host.model.setActive(true);
    pending.resolve({ ok: true, value: snapshot("late") });
    await saving;
    expect(host.model.getSnapshot()).toMatchObject({
      busy: false,
      blocked: true,
      snapshot: { revision: "origin" },
    });
    expect(host.model.getSnapshot().draft?.headers).toContain("private-draft-key");
    await host.model.reload();
    expect(host.model.getSnapshot()).toMatchObject({
      blocked: false,
      draft: null,
      snapshot: { revision: "read" },
    });
  });
  it("does not discard a draft after a stale confirmation or a declined reload", async () => {
    const host = fixture();
    custom(host);
    host.confirm(async () => false);
    await host.model.reload();
    expect(host.model.getSnapshot().draft).not.toBeNull();
    const confirmation = deferred<boolean>();
    host.confirm(() => confirmation.promise);
    const discard = host.model.discard();
    host.model.setActive(false);
    host.model.setActive(true);
    confirmation.resolve(true);
    await discard;
    expect(host.model.getSnapshot().draft?.headers).toContain("private-draft-key");
    expect(host.read).not.toHaveBeenCalled();
  });
  it("clears in-flight read busy state without applying a hidden response", async () => {
    const host = fixture();
    const response =
      deferred<Awaited<ReturnType<Parameters<typeof openConnectorForm>[2]["read"]>>>();
    host.reader(() => response.promise);
    const reading = host.model.refresh();
    host.model.setActive(false);
    response.resolve({ ok: true, value: snapshot("late") });
    await reading;
    expect(host.model.getSnapshot()).toMatchObject({
      busy: false,
      snapshot: { revision: "origin" },
    });
  });
  it("opens only consent URLs and never sends browser codes through an RPC", async () => {
    const host = fixture();
    await host.model.connect();
    expect(host.authorize).toHaveBeenCalledExactlyOnceWith({
      hostId: "host",
      expectedRevision: "origin",
      id: "saved",
    });
    expect(host.open).toHaveBeenCalledExactlyOnceWith("https://auth.fixture.invalid/consent");
    expect(host.model.getSnapshot().callback).toBe("hosted");
    host.model.setActive(false);
    expect(host.model.getSnapshot().authorizationUrl).toBe("");
  });
  it("polls only active pending sign-ins and stops after settlement", async () => {
    vi.useFakeTimers();
    const pending = {
      ...snapshot(),
      connectors: [
        {
          ...connection,
          authorization: { ...connection.authorization, state: "pending" as const },
        },
      ],
    };
    const host = fixture(pending);
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(host.read).toHaveBeenCalledTimes(1);
    host.model.setActive(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(host.read).toHaveBeenCalledTimes(1);
  });
  it("closing destroys ephemeral credentials and ignores late accepted writes", async () => {
    const host = fixture();
    custom(host);
    const pending = deferred<ReturnType<typeof writeConnectors.output.parse>>();
    host.writer(() => pending.promise);
    const writing = host.model.save();
    host.model.close();
    pending.resolve({ ok: true, value: snapshot("late") });
    await writing;
    expect(host.model.getSnapshot().draft).toBeNull();
    expect(host.model.getSnapshot().snapshot.revision).toBe("origin");
  });
});
