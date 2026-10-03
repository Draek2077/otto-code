/**
 * General-browsing tabs belong to the chat that opened them. Keep this on the
 * shared broker identity so rebuilding a provider's tool catalog doesn't lose
 * the association. Preview bindings remain owned by the preview manager.
 */
interface ChatTab {
  browserIds: string[];
  pending?: Promise<unknown>;
}

const tabsByBroker = new WeakMap<object, Map<string, ChatTab>>();

export function chatBrowserTabIds(broker: object, key: string): readonly string[] {
  return tabsByBroker.get(broker)?.get(key)?.browserIds ?? [];
}

export function rememberChatBrowserTabs(broker: object, key: string, browserIds: string[]): void {
  if (!browserIds.length) return;
  const tab = getChatTab(broker, key);
  tab.browserIds = [...new Set([...tab.browserIds, ...browserIds])];
}

export async function withChatBrowserTab<T>(
  broker: object,
  key: string,
  work: (tab: ChatTab) => Promise<T>,
): Promise<T> {
  const tab = getChatTab(broker, key);
  // Parallel tool calls from one chat must not both see "no tab" and create.
  const previous = tab.pending;
  const current = (async () => {
    await previous?.catch(() => undefined);
    return work(tab);
  })();
  tab.pending = current;
  try {
    return await current;
  } finally {
    if (tab.pending === current) delete tab.pending;
  }
}

function getChatTab(broker: object, key: string): ChatTab {
  let tabs = tabsByBroker.get(broker);
  if (!tabs) {
    tabs = new Map();
    tabsByBroker.set(broker, tabs);
  }
  let tab = tabs.get(key);
  if (!tab) {
    // Keep idle associations bounded; in-flight calls are never evicted.
    if (tabs.size >= 1000) {
      const idleKey = [...tabs].find(([, entry]) => !entry.pending)?.[0];
      if (idleKey) tabs.delete(idleKey);
    }
    tab = { browserIds: [] };
    tabs.set(key, tab);
  }
  return tab;
}
