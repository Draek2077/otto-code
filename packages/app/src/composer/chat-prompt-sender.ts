/**
 * Lets a surface outside the composer deliver a prompt into a chat as if the
 * user had typed it and pressed Enter. The chat's mounted composer registers
 * the sender and owns the delivery decision (send, queue, steer, or interrupt),
 * so a chat without a composer (archived, an observed subagent) has no sender
 * and callers offer no action for it.
 *
 * Unlike the widget channel this carries no budget: every call is one explicit
 * user gesture, never agent-authored content.
 */
export type ChatPromptSender = (text: string) => void;

export interface ChatPromptTarget {
  serverId: string;
  agentId: string;
}

const senders = new Map<string, ChatPromptSender>();

function targetKey(target: ChatPromptTarget): string {
  return `${target.serverId}::${target.agentId}`;
}

export function registerChatPromptSender(
  target: ChatPromptTarget,
  sender: ChatPromptSender,
): () => void {
  const key = targetKey(target);
  senders.set(key, sender);
  return () => {
    // A remount can install the next composer's sender before this cleanup runs.
    if (senders.get(key) === sender) senders.delete(key);
  };
}

export function getChatPromptSender(target: ChatPromptTarget): ChatPromptSender | null {
  return senders.get(targetKey(target)) ?? null;
}
