import {
  readBitbucketConnections,
  writeBitbucketConnections,
  readBitbucketRepositories,
  createBitbucketRepository,
  readBitbucketWorkspaces,
  setBitbucketThreadResolution,
} from "@getpaseo/plugin/otto/bitbucket-connections";
import { BitbucketConnectionError, type BitbucketConnectionsStore } from "./connections.js";
import { createBitbucketRepositories } from "./repositories.js";
import { BitbucketError } from "./http.js";

export class BitbucketConnectionsRpc {
  constructor(
    private readonly hostId: string,
    private readonly store: BitbucketConnectionsStore,
    private readonly fetchPort?: typeof fetch,
    private readonly threadResolution?: (
      input: ReturnType<typeof setBitbucketThreadResolution.input.parse>,
    ) => Promise<void>,
  ) {}
  invoke(method: string, input: unknown): Promise<unknown> | undefined {
    if (method === readBitbucketConnections.name) return this.read(input);
    if (method === writeBitbucketConnections.name) return this.write(input);
    if (method === readBitbucketRepositories.name) return this.repositories(input);
    if (method === createBitbucketRepository.name) return this.createRepository(input);
    if (method === readBitbucketWorkspaces.name) return this.workspaces(input);
    if (method === setBitbucketThreadResolution.name) return this.resolveThread(input);
    return undefined;
  }
  private async resolveThread(value: unknown) {
    const input = setBitbucketThreadResolution.input.parse(value);
    return setBitbucketThreadResolution.output.parse(
      await this.safe(input.hostId, async () => {
        if (!this.threadResolution)
          throw new BitbucketConnectionError(
            "unavailable",
            "Update this host to manage Bitbucket discussions.",
          );
        await this.threadResolution(input);
        return { resolved: input.resolved };
      }),
    );
  }
  private async safe<T>(hostId: string, run: () => Promise<T>) {
    try {
      if (hostId !== this.hostId)
        throw new BitbucketConnectionError("validation", "Choose this connection's owning host.");
      return { ok: true as const, value: await run() };
    } catch (error) {
      if (error instanceof BitbucketConnectionError)
        return { ok: false as const, error: { kind: error.kind, message: error.message } };
      if (error instanceof BitbucketError)
        return {
          ok: false as const,
          error: { kind: "unavailable" as const, message: error.message },
        };
      return {
        ok: false as const,
        error: {
          kind: "unavailable" as const,
          message:
            "The host could not access Git connections or secure credential storage. Reload before continuing.",
        },
      };
    }
  }
  private async read(value: unknown) {
    const input = readBitbucketConnections.input.parse(value);
    return readBitbucketConnections.output.parse(
      await this.safe(input.hostId, () => this.store.read(input.projectId)),
    );
  }
  private async write(value: unknown) {
    const input = writeBitbucketConnections.input.parse(value);
    return writeBitbucketConnections.output.parse(
      await this.safe(input.hostId, () =>
        this.store.write(input.expectedRevision, input.action, input.projectId),
      ),
    );
  }
  private async repositories(value: unknown) {
    const input = readBitbucketRepositories.input.parse(value);
    return readBitbucketRepositories.output.parse(
      await this.safe(input.hostId, async () =>
        createBitbucketRepositories({
          credential: () => this.store.resolve(input.projectId),
          fetch: this.fetchPort,
        }).list(input.workspace, input.query),
      ),
    );
  }
  private async workspaces(value: unknown) {
    const input = readBitbucketWorkspaces.input.parse(value);
    return readBitbucketWorkspaces.output.parse(
      await this.safe(input.hostId, () =>
        createBitbucketRepositories({
          credential: () => this.store.resolve(input.projectId),
          fetch: this.fetchPort,
        }).workspaces(),
      ),
    );
  }
  private async createRepository(value: unknown) {
    const input = createBitbucketRepository.input.parse(value);
    return createBitbucketRepository.output.parse(
      await this.safe(input.hostId, async () => {
        const credential = await this.store.resolve(input.projectId);
        if ((await this.store.read(input.projectId)).revision !== input.expectedRevision)
          throw new BitbucketConnectionError(
            "conflict",
            "The selected account changed. Reload before creating a repository.",
          );
        return createBitbucketRepositories({
          credential: async () => credential,
          fetch: this.fetchPort,
        }).create(input);
      }),
    );
  }
}
