import { promises as fs } from "node:fs";
import type { IntegrationConnectionMetadata } from "@otto-code/protocol/integration-authorization";
import { IntegrationConnectionMetadataSchema } from "@otto-code/protocol/integration-authorization";
import type { Logger } from "pino";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";

export interface IntegrationAuthorizationRegistry {
  initialize(): Promise<void>;
  list(): Promise<IntegrationConnectionMetadata[]>;
  get(params: {
    integrationId: string;
    connectionId: string;
  }): Promise<IntegrationConnectionMetadata | null>;
  upsert(connection: IntegrationConnectionMetadata): Promise<void>;
  remove(params: { integrationId: string; connectionId: string }): Promise<void>;
}

function connectionKey(params: { integrationId: string; connectionId: string }): string {
  return JSON.stringify([params.integrationId, params.connectionId]);
}

/**
 * Durable metadata only. The JSON file intentionally contains no credential
 * field: its record schema is also the wire-safe protocol schema.
 */
export class FileBackedIntegrationAuthorizationRegistry implements IntegrationAuthorizationRegistry {
  private readonly cache = new Map<string, IntegrationConnectionMetadata>();
  private readonly logger: Logger;
  private loaded = false;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "integration-authorization-registry" });
  }

  async initialize(): Promise<void> {
    await this.load();
  }

  async list(): Promise<IntegrationConnectionMetadata[]> {
    await this.load();
    return [...this.cache.values()].sort((left, right) =>
      connectionKey(left).localeCompare(connectionKey(right)),
    );
  }

  async get(params: {
    integrationId: string;
    connectionId: string;
  }): Promise<IntegrationConnectionMetadata | null> {
    await this.load();
    return this.cache.get(connectionKey(params)) ?? null;
  }

  async upsert(connection: IntegrationConnectionMetadata): Promise<void> {
    await this.load();
    const parsed = IntegrationConnectionMetadataSchema.parse(connection);
    this.cache.set(connectionKey(parsed), parsed);
    await this.enqueuePersist();
  }

  async remove(params: { integrationId: string; connectionId: string }): Promise<void> {
    await this.load();
    if (this.cache.delete(connectionKey(params))) {
      await this.enqueuePersist();
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.cache.clear();
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const records = z.array(IntegrationConnectionMetadataSchema).parse(JSON.parse(raw));
      for (const record of records) {
        this.cache.set(connectionKey(record), record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to load integration metadata",
        );
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await writeJsonFileAtomic(this.filePath, [...this.cache.values()]);
  }

  private async enqueuePersist(): Promise<void> {
    const nextPersist = this.persistQueue.then(() => this.persist());
    this.persistQueue = nextPersist.catch(() => {});
    await nextPersist;
  }
}
