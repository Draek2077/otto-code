/** Shared Atlassian transport errors; product adapters map these to their own public contracts. */
export interface AtlassianError {
  code:
    | "invalid_target"
    | "auth_required"
    | "access_denied"
    | "not_found"
    | "rate_limited"
    | "unavailable"
    | "invalid_response"
    | "read_limit";
  message: string;
}
export type AtlassianResult<T> = { ok: true; value: T } | { ok: false; error: AtlassianError };
export function atlassianFailure(
  code: AtlassianError["code"],
  message: string,
): AtlassianResult<never> {
  return { ok: false, error: { code, message } };
}
