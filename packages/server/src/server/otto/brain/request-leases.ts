/** Cancel a client's transient reads without canceling durable Brain jobs. */
export class BrainRequestLeases {
  private readonly requests = new Map<string, Map<string, AbortController>>();
  private count = 0;
  async run<T>(
    clientId: string,
    requestId: string,
    read: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (!clientId) throw new Error("A Brain read requires an authenticated session");
    let requests = this.requests.get(clientId);
    if (this.count >= 64 || (requests?.size ?? 0) >= 4)
      throw new Error("Too many pending Brain reads");
    if (requests?.has(requestId)) throw new Error("This Brain read is already pending");
    requests ??= new Map();
    this.requests.set(clientId, requests);
    const controller = new AbortController();
    requests.set(requestId, controller);
    this.count++;
    try {
      return await read(controller.signal);
    } finally {
      requests.delete(requestId);
      this.count--;
      if (!requests.size) this.requests.delete(clientId);
    }
  }
  release(clientId: string, requestId: string): void {
    this.requests.get(clientId)?.get(requestId)?.abort();
  }
  releaseClient(clientId: string): void {
    for (const request of this.requests.get(clientId)?.values() ?? []) request.abort();
  }
  close(): void {
    for (const client of this.requests.keys()) this.releaseClient(client);
  }
}
