import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { apiBaseUrl } from "../shared/settings.js";
import { endpoint } from "./http.js";

const fileSchema = z.object({
  version: z.literal(1),
  retired: z.array(z.string()).optional(),
  entries: z.record(
    z.string(),
    z.object({ endpoint: z.string(), key: z.string().min(1).max(16384) }),
  ),
});
interface CredentialChange {
  profileId: string;
  baseUrl: string;
  revision: string;
  key: string | null;
}

/** A private host file, never plugin settings, client state or agent persistence. */
export class HostCredentials {
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;
  constructor(private readonly directory: string) {
    this.file = path.join(directory, "credentials.json");
  }

  private async read() {
    let body: string;
    try {
      body = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        data: fileSchema.parse({ version: 1, entries: {} }),
        revision: createHash("sha256").update("").digest("hex"),
      };
    }
    let data: z.infer<typeof fileSchema>;
    try {
      if (Buffer.byteLength(body) > 2 * 1024 * 1024)
        throw new Error("Credential file is too large.");
      data = fileSchema.parse(JSON.parse(body));
    } catch {
      throw new Error("Otto provider credentials are invalid. The file was left intact.");
    }
    return { data, revision: createHash("sha256").update(body).digest("hex") };
  }

  async status(profileId: string, baseUrl: string) {
    const { data, revision } = await this.read();
    const entry = Object.hasOwn(data.entries, profileId) ? data.entries[profileId] : undefined;
    const matches = entry?.endpoint === endpoint(baseUrl, "chat/completions");
    return {
      revision,
      configured: Boolean(entry && matches),
      endpointChanged: Boolean(entry && !matches),
      ...(data.retired?.includes(profileId) ? { retired: true } : {}),
    };
  }

  async key(profileId: string, baseUrl: string): Promise<string | undefined> {
    const { data } = await this.read();
    if (data.retired?.includes(profileId))
      throw new Error("This connection was removed. Add a new connection to continue.");
    const entry = Object.hasOwn(data.entries, profileId) ? data.entries[profileId] : undefined;
    if (entry && entry.endpoint !== endpoint(baseUrl, "chat/completions"))
      throw new Error(
        "The endpoint changed. Save a key for this endpoint or remove the previous saved key before continuing.",
      );
    return entry?.key;
  }

  save(change: CredentialChange) {
    return this.enqueue(() => this.write(change));
  }

  retire(change: Omit<CredentialChange, "key">) {
    return this.enqueue(() => this.write({ ...change, key: null }, true));
  }

  private enqueue(write: () => ReturnType<HostCredentials["write"]>) {
    const result = this.writing.then(write);
    this.writing = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async write(change: CredentialChange, retire = false) {
    apiBaseUrl.parse(change.baseUrl);
    const { data, revision } = await this.read();
    if (revision !== change.revision)
      throw new Error("Host credentials changed. Reload before saving your key.");
    if (data.retired?.includes(change.profileId) && !retire)
      throw new Error("This connection was removed. Add a new connection to continue.");
    if (retire) data.retired = [...new Set([...(data.retired ?? []), change.profileId])];
    if (change.key === null) delete data.entries[change.profileId];
    else {
      const key = z.string().trim().min(1).max(16384).parse(change.key);
      Object.defineProperty(data.entries, change.profileId, {
        value: { endpoint: endpoint(change.baseUrl, "chat/completions"), key },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `.credentials-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(data)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
    return this.status(change.profileId, change.baseUrl);
  }
}
