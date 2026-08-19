import type { CommunicationsService } from "../../communications/communications-service.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";

/**
 * Everything the communications RPCs need from the owning session. Kept to `emit`
 * so the session stays the only thing that knows how to reach the wire.
 */
export interface CommunicationsSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface CommunicationsSessionOptions {
  host: CommunicationsSessionHost;
  communicationsService: CommunicationsService;
}

/**
 * The Otto Communications session domain: the inbox, rooms, presence and
 * favourites RPCs over the daemon-owned CommunicationsService. Extracted from
 * `session.ts` so the dispatcher dispatches and the domain owns its own logic,
 * matching the shape Paseo uses for checkout, files, voice and the rest (and
 * the shape `session/brain/` already follows). The presence-change push stays in
 * `session.ts` because it rides the session's own capability and lifecycle checks.
 */
export class CommunicationsSession {
  private readonly host: CommunicationsSessionHost;
  private readonly communicationsService: CommunicationsService;

  constructor(options: CommunicationsSessionOptions) {
    this.host = options.host;
    this.communicationsService = options.communicationsService;
  }

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "communications.get_overview.request":
        return this.handleCommunicationsGetOverviewRequest(msg.requestId);
      case "communications.inbox.get_home.request":
        return this.handleCommunicationsInboxGetHomeRequest(msg.requestId, msg.providerId);
      case "communications.inbox.search.request":
        return this.handleCommunicationsInboxSearchRequest(
          msg.requestId,
          msg.providerId,
          msg.query,
        );
      case "communications.inbox.set_favorite.request":
        return this.handleCommunicationsInboxSetFavoriteRequest(
          msg.requestId,
          msg.providerId,
          msg.conversationId,
          msg.favorite,
        );
      case "communications.inbox.notifications.acknowledge.request":
        return this.handleCommunicationsInboxNotificationsAcknowledgeRequest(
          msg.requestId,
          msg.providerId,
          msg.notificationIds,
          msg.conversationId,
          msg.clearAll,
        );
      case "communications.inbox.get_presence.request":
        return this.handleCommunicationsInboxGetPresenceRequest(msg.requestId, msg.providerId);
      case "communications.inbox.set_presence.request":
        return this.handleCommunicationsInboxSetPresenceRequest(
          msg.requestId,
          msg.providerId,
          msg.status,
        );
      case "communications.inbox.set_enabled.request":
        return this.handleCommunicationsInboxSetEnabledRequest(
          msg.requestId,
          msg.providerId,
          msg.enabled,
        );
      case "communications.inbox.get_messages.request":
        return this.handleCommunicationsInboxGetMessagesRequest(
          msg.requestId,
          msg.providerId,
          msg.conversationId,
        );
      case "communications.inbox.send_message.request":
        return this.handleCommunicationsInboxSendMessageRequest(
          msg.requestId,
          msg.providerId,
          msg.conversationId,
          msg.text,
        );
      case "communications.room.get.request":
        return this.handleCommunicationsRoomGetRequest(
          msg.requestId,
          msg.providerId,
          msg.conversationId,
        );
      case "communications.room.thread.get.request":
        return this.handleCommunicationsRoomThreadGetRequest(
          msg.requestId,
          msg.providerId,
          msg.conversationId,
          msg.parentMessageId,
        );
      case "communications.room.message.send.request":
        return this.handleCommunicationsRoomMessageSendRequest(
          msg.requestId,
          msg.providerId,
          msg.conversationId,
          msg.text,
          msg.parentMessageId,
        );
      case "communications.room.reaction.set.request":
        return this.handleCommunicationsRoomReactionSetRequest(
          msg.requestId,
          msg.providerId,
          msg.conversationId,
          msg.messageId,
          msg.emoji,
          msg.active,
        );
      default:
        return undefined;
    }
  }

  private async handleCommunicationsGetOverviewRequest(requestId: string): Promise<void> {
    const overview = await this.communicationsService.getOverview();
    this.host.emit({
      type: "communications.get_overview.response",
      payload: { overview, requestId },
    });
  }

  private async handleCommunicationsInboxGetHomeRequest(
    requestId: string,
    providerId: string,
  ): Promise<void> {
    const home = await this.communicationsService.getHome(providerId);
    this.host.emit({
      type: "communications.inbox.get_home.response",
      payload: { home, requestId },
    });
  }

  private async handleCommunicationsInboxSearchRequest(
    requestId: string,
    providerId: string,
    query: string,
  ): Promise<void> {
    const results = await this.communicationsService.searchDestinations({ providerId, query });
    this.host.emit({
      type: "communications.inbox.search.response",
      payload: { results, requestId },
    });
  }

  private async handleCommunicationsInboxSetFavoriteRequest(
    requestId: string,
    providerId: string,
    conversationId: string,
    favorite: boolean,
  ): Promise<void> {
    const home = await this.communicationsService.setFavorite({
      providerId,
      conversationId,
      favorite,
    });
    this.host.emit({
      type: "communications.inbox.set_favorite.response",
      payload: { home, requestId },
    });
  }

  private async handleCommunicationsInboxNotificationsAcknowledgeRequest(
    requestId: string,
    providerId: string,
    notificationIds?: string[],
    conversationId?: string,
    clearAll?: boolean,
  ): Promise<void> {
    const home = await this.communicationsService.acknowledgeNotifications({
      providerId,
      ...(notificationIds ? { notificationIds } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(clearAll ? { clearAll } : {}),
    });
    this.host.emit({
      type: "communications.inbox.notifications.acknowledge.response",
      payload: { home, requestId },
    });
  }

  private async handleCommunicationsInboxGetPresenceRequest(
    requestId: string,
    providerId: string,
  ): Promise<void> {
    const presence = await this.communicationsService.getPresence(providerId);
    this.host.emit({
      type: "communications.inbox.get_presence.response",
      payload: { presence, requestId },
    });
  }

  private async handleCommunicationsInboxSetPresenceRequest(
    requestId: string,
    providerId: string,
    status: "available" | "busy" | "do_not_disturb" | "away" | "out_of_office" | "unknown",
  ): Promise<void> {
    const presence = await this.communicationsService.setPresence({ providerId, status });
    this.host.emit({
      type: "communications.inbox.set_presence.response",
      payload: { presence, requestId },
    });
  }

  private async handleCommunicationsInboxSetEnabledRequest(
    requestId: string,
    providerId: string,
    enabled: boolean,
  ): Promise<void> {
    const presence = await this.communicationsService.setEnabled({ providerId, enabled });
    this.host.emit({
      type: "communications.inbox.set_enabled.response",
      payload: { presence, requestId },
    });
  }

  private async handleCommunicationsInboxGetMessagesRequest(
    requestId: string,
    providerId: string,
    conversationId: string,
  ): Promise<void> {
    const messages = await this.communicationsService.getMessages({ providerId, conversationId });
    this.host.emit({
      type: "communications.inbox.get_messages.response",
      payload: { messages, requestId },
    });
  }

  private async handleCommunicationsInboxSendMessageRequest(
    requestId: string,
    providerId: string,
    conversationId: string,
    text: string,
  ): Promise<void> {
    const message = await this.communicationsService.sendMessage({
      providerId,
      conversationId,
      text,
    });
    this.host.emit({
      type: "communications.inbox.send_message.response",
      payload: { message, requestId },
    });
  }

  private async handleCommunicationsRoomGetRequest(
    requestId: string,
    providerId: string,
    conversationId: string,
  ): Promise<void> {
    const room = await this.communicationsService.getRoom({ providerId, conversationId });
    this.host.emit({ type: "communications.room.get.response", payload: { room, requestId } });
  }

  private async handleCommunicationsRoomThreadGetRequest(
    requestId: string,
    providerId: string,
    conversationId: string,
    parentMessageId: string,
  ): Promise<void> {
    const messages = await this.communicationsService.getThread({
      providerId,
      conversationId,
      parentMessageId,
    });
    this.host.emit({
      type: "communications.room.thread.get.response",
      payload: { messages, requestId },
    });
  }

  private async handleCommunicationsRoomMessageSendRequest(
    requestId: string,
    providerId: string,
    conversationId: string,
    text: string,
    parentMessageId?: string | null,
  ): Promise<void> {
    const message = await this.communicationsService.sendRoomMessage({
      providerId,
      conversationId,
      text,
      parentMessageId,
    });
    this.host.emit({
      type: "communications.room.message.send.response",
      payload: { message, requestId },
    });
  }

  private async handleCommunicationsRoomReactionSetRequest(
    requestId: string,
    providerId: string,
    conversationId: string,
    messageId: string,
    emoji: string,
    active: boolean,
  ): Promise<void> {
    const message = await this.communicationsService.setReaction({
      providerId,
      conversationId,
      messageId,
      emoji,
      active,
    });
    this.host.emit({
      type: "communications.room.reaction.set.response",
      payload: { message, requestId },
    });
  }
}
