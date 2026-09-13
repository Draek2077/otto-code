/** Account labels are safe host metadata. Profile fetches stay on the daemon;
 * the shared auth service never receives the user's profile or content.
 * https://developer.box.com/reference/get-users-me
 */
export async function hostedConnectorAccount(
  vendorId: string,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<string | undefined> {
  if (vendorId !== "box") return undefined;
  try {
    const response = await fetcher("https://api.box.com/2.0/users/me?fields=id,login,name", {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok || !response.body) return undefined;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16_384) return undefined;
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const profile = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    if (typeof profile.login === "string" && profile.login.length <= 320) return profile.login;
    return undefined;
  } catch {
    return undefined;
  }
}
