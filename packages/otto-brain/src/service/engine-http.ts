/** Bounded private engine probes; status sampling must not start hardware probes. */
export async function engineJson(
  upstream: string,
  path: string,
  signal: AbortSignal,
  method = "GET",
): Promise<unknown> {
  const response = await fetch(upstream + path, {
    method,
    signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Brain engine probe failed (${response.status})`);
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 256 * 1024) throw new Error("Brain engine probe exceeded its byte limit");
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
