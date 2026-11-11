import type { Logger } from "pino";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { isReviewableArchiveRecord } from "./archive-record-file.js";
import { ArchiveReview, summarizeArchive, type ArchiveReviewPort } from "./archive-review.js";

export type ArchiveHistoryRequest = Extract<
  SessionInboundMessage,
  { type: `history.archives.${string}.request` }
>;

export function isArchiveHistoryRequest(
  message: SessionInboundMessage,
): message is ArchiveHistoryRequest {
  return message.type.startsWith("history.archives.");
}

export class ArchiveHost {
  private readonly reviews = new WeakMap<object, ArchiveReview>();
  private readonly port: ArchiveReviewPort;

  constructor(options: {
    storage: Pick<AgentStorage, "list" | "inspectReviewedArchive">;
    manager: Pick<AgentManager, "getAgent" | "deleteReviewedArchive">;
    onRemoved(agentId: string, workspaceId?: string): Promise<void>;
    logger: Pick<Logger, "warn">;
  }) {
    this.port = {
      scan: async () => {
        const records = [];
        let unavailable = 0;
        for (const candidate of await options.storage.list()) {
          if (!isReviewableArchiveRecord(candidate)) continue;
          const review = options.manager.getAgent(candidate.id)
            ? null
            : await options.storage.inspectReviewedArchive(candidate.id);
          if (review) records.push(review);
          else unavailable += 1;
        }
        return { records, unavailable };
      },
      removeReviewed: async (record) => {
        const result = await options.manager.deleteReviewedArchive(record);
        if (result.status === "deleted") {
          await options.onRemoved(record.agentId, result.workspaceId).catch((error: unknown) => {
            options.logger.warn(
              { err: error, agentId: record.agentId },
              "Archive removal notification failed",
            );
          });
        }
        return result;
      },
    };
  }

  async summary() {
    return summarizeArchive(await this.port.scan());
  }

  review(source: object) {
    const existing = this.reviews.get(source);
    if (existing) return existing;
    const review = new ArchiveReview(this.port);
    this.reviews.set(source, review);
    return review;
  }

  async dispatch(
    message: ArchiveHistoryRequest,
    source: object,
    emit: (message: SessionOutboundMessage) => void,
  ): Promise<void> {
    const { requestId } = message;
    try {
      switch (message.type) {
        case "history.archives.get_summary.request":
          emit({
            type: "history.archives.get_summary.response",
            payload: { requestId, summary: await this.summary() },
          });
          break;
        case "history.archives.review_clear.request":
          emit({
            type: "history.archives.review_clear.response",
            payload: { requestId, result: await this.review(source).preview() },
          });
          break;
        case "history.archives.clear_reviewed.request":
          emit({
            type: "history.archives.clear_reviewed.response",
            payload: { requestId, result: await this.review(source).apply(message.reviewId) },
          });
          break;
      }
    } catch {
      emit({
        type: "rpc_error",
        payload: {
          requestId,
          requestType: message.type,
          error: "The host could not read or clear its archive records.",
          code: "archive_unavailable",
        },
      });
    }
  }
}
