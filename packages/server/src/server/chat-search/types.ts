export interface SearchChat {
  id: string;
  title: string;
  provider: string;
  workspaceId: string | null;
  projectId: string | null;
  projectName: string;
  archived: boolean;
}

export interface SearchMessage {
  key: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  sourceSeq: number;
}

export interface SearchSource {
  version: 1;
  agentId: string;
  revision: string;
  complete: boolean;
  providerRevision?: string;
  verifiedAt?: number;
  messages: SearchMessage[];
}

export interface ChatSearchInput {
  query: string;
  workspaceId?: string;
  projectId?: string;
  archive?: "all" | "active" | "archived";
  limit?: number;
}

export interface ChatSearchHit extends SearchChat {
  messageKey: string;
  role: "user" | "assistant";
  timestamp: string;
  snippet: string;
}

export interface ChatSearchResult {
  hits: ChatSearchHit[];
  coverage: { total: number; indexed: number; pending: number; unavailable: number };
  hasMore: boolean;
}
