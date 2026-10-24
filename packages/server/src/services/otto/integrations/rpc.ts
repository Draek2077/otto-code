import {
  readAtlassianAccount,
  saveAtlassianAccount,
} from "@getpaseo/plugin/otto/atlassian-settings";
import { AtlassianAccountError, type AtlassianAccountService } from "../atlassian/account.js";

export class IntegrationAccountRpc {
  constructor(
    private readonly hostId: string,
    private readonly atlassian: AtlassianAccountService,
  ) {}
  invoke(method: string, value: unknown): Promise<unknown> | undefined {
    if (method === readAtlassianAccount.name) return this.read(value);
    if (method === saveAtlassianAccount.name) return this.save(value);
    return undefined;
  }
  private async safe(run: () => ReturnType<AtlassianAccountService["read"]>) {
    try {
      return { ok: true as const, value: await run() };
    } catch (error) {
      if (error instanceof AtlassianAccountError)
        return { ok: false as const, error: { kind: error.kind, message: error.message } };
      return {
        ok: false as const,
        error: {
          kind: "unavailable" as const,
          message:
            "The host could not access shared integration settings or secure credential storage. Reload before saving.",
        },
      };
    }
  }
  private async read(value: unknown) {
    const input = readAtlassianAccount.input.parse(value);
    return readAtlassianAccount.output.parse(
      await this.safe(async () => {
        if (input.hostId !== this.hostId)
          throw new AtlassianAccountError("validation", "Choose this account's owning host.");
        return this.atlassian.read();
      }),
    );
  }
  private async save(value: unknown) {
    const { hostId, ...input } = saveAtlassianAccount.input.parse(value);
    return saveAtlassianAccount.output.parse(
      await this.safe(async () => {
        if (hostId !== this.hostId)
          throw new AtlassianAccountError("validation", "Choose this account's owning host.");
        return this.atlassian.save(input);
      }),
    );
  }
}
