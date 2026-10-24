import {
  BoardMutationIntentSchema,
  type BoardMutationIntent,
  type BoardMutationOutcome,
  type EditableBoard,
  type KanbanError,
  type ProjectBinding,
  type Result,
} from "@getpaseo/plugin/otto/kanban";
import { preflightMutation } from "./preflight.js";
import { mutationFingerprint, type MutationRecord, type MutationStore } from "./store.js";

export type ProviderMutationResult =
  | { status: "applied" }
  | { status: "rejected"; error: KanbanError }
  | { status: "uncertain"; error: KanbanError };
export interface MutationPorts<Context = undefined> {
  hostId: string;
  store: MutationStore;
  read(
    binding: ProjectBinding,
    cardId?: string,
  ): Promise<Result<{ settingsRevision: string; snapshot: EditableBoard; context?: Context }>>;
  /** Revalidates current project target immediately before the provider call. */
  checkSettings(binding: ProjectBinding, expectedRevision: string): Promise<Result<true>>;
  execute(
    intent: BoardMutationIntent,
    snapshot: EditableBoard,
    context: Context | undefined,
  ): Promise<ProviderMutationResult>;
}
const unknownOutcome: KanbanError = {
  code: "unavailable",
  message:
    "The action may have reached the provider. Refresh and reconcile it before starting another action.",
};
function rejected(operationId: string, error: KanbanError): BoardMutationOutcome {
  return { status: "rejected", operationId, error };
}
function uncertain(operationId: string, error = unknownOutcome): BoardMutationOutcome {
  return { status: "reconciliation_required", operationId, error };
}

/** One owning-host operation lane. No automatic retries, polling or optimistic board cache. */
export class BoardMutationService<Context = undefined> {
  private readonly lanes = new Map<string, Promise<unknown>>();
  constructor(private readonly ports: MutationPorts<Context>) {}
  execute(input: BoardMutationIntent): Promise<BoardMutationOutcome> {
    const intent = BoardMutationIntentSchema.parse(input);
    if (intent.binding.hostId !== this.ports.hostId)
      return Promise.resolve(
        rejected(intent.operationId, {
          code: "wrong_host",
          message: "Select this project's owning host.",
        }),
      );
    const key = JSON.stringify([intent.binding.hostId, intent.binding.projectId]);
    const previous = this.lanes.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.run(intent));
    this.lanes.set(key, operation);
    void operation
      .finally(() => {
        if (this.lanes.get(key) === operation) this.lanes.delete(key);
      })
      .catch(() => undefined);
    return operation;
  }
  private async replay(
    intent: BoardMutationIntent,
    record: MutationRecord,
    fingerprint: string,
  ): Promise<BoardMutationOutcome> {
    if (record.fingerprint !== fingerprint)
      return rejected(intent.operationId, {
        code: "revision_conflict",
        message: "This operation ID was already used for another action.",
      });
    if (record.state === "rejected" && record.error)
      return rejected(intent.operationId, record.error);
    if (record.state !== "applied") return uncertain(intent.operationId);
    const current = await this.ports.read(intent.binding);
    if (!current.ok || current.value.snapshot.board.id !== intent.boardId)
      return uncertain(intent.operationId);
    return { status: "applied", operationId: intent.operationId, snapshot: current.value.snapshot };
  }
  private async run(intent: BoardMutationIntent): Promise<BoardMutationOutcome> {
    let admitted = false;
    try {
      const fingerprint = mutationFingerprint(intent);
      const record = await this.ports.store.read(intent);
      if (record) {
        admitted = true;
        return await this.replay(intent, record, fingerprint);
      }
      const current = await this.ports.read(
        intent.binding,
        "cardId" in intent.mutation ? intent.mutation.cardId : undefined,
      );
      if (!current.ok) return rejected(intent.operationId, current.error);
      if (current.value.settingsRevision !== intent.expectedSettingsRevision)
        return rejected(intent.operationId, {
          code: "revision_conflict",
          message: "Project Settings changed. Reload before applying this action.",
        });
      const valid = preflightMutation(intent, current.value.snapshot);
      if (!valid.ok) return rejected(intent.operationId, valid.error);
      admitted = await this.ports.store.admit(intent, fingerprint);
      if (!admitted) {
        const existing = await this.ports.store.read(intent);
        return existing
          ? await this.replay(intent, existing, fingerprint)
          : uncertain(intent.operationId);
      }
      const settings = await this.ports.checkSettings(
        intent.binding,
        intent.expectedSettingsRevision,
      );
      if (!settings.ok) {
        await this.ports.store.save(intent, {
          version: 1,
          fingerprint,
          state: "rejected",
          error: settings.error,
        });
        return rejected(intent.operationId, settings.error);
      }
      const result = await this.ports.execute(
        intent,
        current.value.snapshot,
        current.value.context,
      );
      await this.ports.store.save(intent, {
        version: 1,
        fingerprint,
        state: result.status,
        ...("error" in result ? { error: result.error } : {}),
      });
      if (result.status === "rejected") return rejected(intent.operationId, result.error);
      if (result.status === "uncertain") return uncertain(intent.operationId, result.error);
      const refreshed = await this.ports.read(intent.binding);
      if (!refreshed.ok || refreshed.value.snapshot.board.id !== intent.boardId)
        return uncertain(intent.operationId);
      return {
        status: "applied",
        operationId: intent.operationId,
        snapshot: refreshed.value.snapshot,
      };
    } catch {
      return uncertain(
        intent.operationId,
        admitted
          ? unknownOutcome
          : {
              code: "unavailable",
              message:
                "The host could not verify the operation record. Reconcile this action before submitting it again.",
            },
      );
    }
  }
}
