import type { Model } from "../types.js";

export type ModelGateResult =
  | { ok: true; model: Model }
  | { ok: false; status: number; message: string };

/**
 * Pure model-admission decision, factored out of the router so it is unit
 * testable. `pinned` is the single model a locked host serves; `resolved` is the
 * normal catalog resolution used when the lock is off. With the lock on, a
 * request naming a model other than the pin is refused (409) rather than queuing
 * a switch; an unnamed request rides the pin.
 */
export function decideModelGate(params: {
  lockModel: boolean;
  requestedName: string | null;
  pinned: Model | null;
  pinnedModels?: Model[];
  resolved: Model | null;
}): ModelGateResult {
  const {
    lockModel,
    requestedName,
    pinned,
    pinnedModels = pinned ? [pinned] : [],
    resolved,
  } = params;
  if (lockModel) {
    if (pinnedModels.length === 0) {
      return { ok: false, status: 503, message: "no models are selected on this locked host" };
    }
    const selected = requestedName
      ? pinnedModels.find(
          (model) => model.id === requestedName || model.displayName === requestedName,
        )
      : pinnedModels[0];
    if (!selected) {
      return {
        ok: false,
        status: 409,
        message: `model switching is disabled on this host; served models: ${pinnedModels
          .map((model) => `"${model.displayName}"`)
          .join(", ")}`,
      };
    }
    return { ok: true, model: selected };
  }
  if (!resolved) {
    return {
      ok: false,
      status: requestedName ? 404 : 503,
      message: requestedName
        ? `model "${requestedName}" was not found in the catalog`
        : "no model is available to serve",
    };
  }
  return { ok: true, model: resolved };
}
