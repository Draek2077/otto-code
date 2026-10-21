// COMPAT(otto09WireNames): added in v0.10.0; review removal after 2027-04-21
// once Otto 0.9 clients/hosts are outside the supported upgrade window.
// This transport codec visits protocol-owned locations only. It never walks
// arbitrary tool results, plugin data or user configuration. Inbound results
// still pass the complete standard protocol validator before dispatch.
type RecordValue = Record<string, unknown>;
type Mapper = (value: unknown) => unknown;

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string, map: Mapper): unknown {
  if (!record(value) || !Object.hasOwn(value, key)) return value;
  const mapped = map(value[key]);
  return mapped === value[key] ? value : { ...value, [key]: mapped };
}

function items(value: unknown, map: Mapper): unknown {
  if (!Array.isArray(value)) return value;
  const mapped = value.map(map);
  return mapped.every((item, i) => item === value[i]) ? value : mapped;
}

function booleanAlias(value: unknown, from: string, to: string, overwrite = false): unknown {
  if (
    !record(value) ||
    typeof value[from] !== "boolean" ||
    (Object.hasOwn(value, to) && (!overwrite || value[to] === value[from]))
  ) {
    return value;
  }
  return { ...value, [to]: value[from] };
}

const RPC_NAMES: Readonly<Record<string, string>> = {
  otto_worktree_list_request: "paseo_worktree_list_request",
  otto_worktree_archive_request: "paseo_worktree_archive_request",
  create_otto_worktree_request: "create_paseo_worktree_request",
  otto_worktree_list_response: "paseo_worktree_list_response",
  otto_worktree_archive_response: "paseo_worktree_archive_response",
  create_otto_worktree_response: "create_paseo_worktree_response",
};
const LEGACY_RPC_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RPC_NAMES).map(([legacy, current]) => [current, legacy]),
);

function renameType(value: unknown, names: Readonly<Record<string, string>>): unknown {
  if (!record(value) || typeof value.type !== "string" || !Object.hasOwn(names, value.type)) {
    return value;
  }
  return { ...value, type: names[value.type] };
}

function envelope(input: unknown, map: Mapper): unknown {
  return record(input) && input.type === "session" ? field(input, "message", map) : input;
}

function serverMessage(input: unknown, legacy: boolean, legacyRpcNames: boolean): unknown {
  if (!record(input)) return input;
  const renamed = renameType(input, legacyRpcNames ? LEGACY_RPC_NAMES : RPC_NAMES);
  if (!record(renamed)) return renamed;
  const ownership: Mapper = (value) =>
    booleanAlias(
      value,
      legacy ? "isPaseoOwnedWorktree" : "isOttoOwnedWorktree",
      legacy ? "isOttoOwnedWorktree" : "isPaseoOwnedWorktree",
      legacy,
    );
  const placement: Mapper = (value) => field(value, "checkout", ownership);
  const workspace: Mapper = (value) =>
    field(
      field(
        booleanAlias(
          value,
          legacy ? "background" : "hidden",
          legacy ? "hidden" : "background",
          legacy,
        ),
        "gitRuntime",
        ownership,
      ),
      "project",
      placement,
    );
  const entry: Mapper = (value) => field(value, "project", placement);
  const snapshot: Mapper = (value) => field(value, "workspace", workspace);
  const type = typeof renamed.type === "string" ? (RPC_NAMES[renamed.type] ?? renamed.type) : null;
  const mapPayload: Mapper = (payload) => {
    switch (type) {
      case "fetch_agents_response":
      case "fetch_agent_history_response":
        return field(payload, "entries", (values) => items(values, entry));
      case "fetch_agent_response":
      case "agent_update":
        return entry(payload);
      case "fetch_workspaces_response":
        return field(payload, "entries", (values) => items(values, workspace));
      case "workspace_update":
      case "open_project_response":
      case "create_paseo_worktree_response":
      case "workspace.create.update":
      case "agent.create.update":
        return snapshot(payload);
      case "workspace.create.response":
      case "agent.create.response":
        return field(snapshot(payload), "creation", snapshot);
      case "creation.subscribe.response":
        return field(payload, "snapshot", snapshot);
      case "checkout_status_response":
      case "checkout_status_update":
        return ownership(payload);
      case "stash_list_response":
        return field(payload, "entries", (values) =>
          items(values, (value) =>
            booleanAlias(
              value,
              legacy ? "isPaseo" : "isOtto",
              legacy ? "isOtto" : "isPaseo",
              legacy,
            ),
          ),
        );
      default:
        return payload;
    }
  };
  return field(renamed, "payload", mapPayload);
}

export function normalizeOttoServerMessage(input: unknown): unknown {
  return envelope(input, (message) => serverMessage(message, false, false));
}

export function encodeOttoServerMessage(input: unknown, legacyRpcNames = false): unknown {
  return envelope(input, (message) => serverMessage(message, true, legacyRpcNames));
}

function clientMessage(input: unknown, legacy: boolean): unknown {
  const renamed = renameType(input, legacy ? LEGACY_RPC_NAMES : RPC_NAMES);
  if (!record(renamed)) return renamed;
  switch (renamed.type) {
    case "stash_list_request":
      return booleanAlias(
        renamed,
        legacy ? "paseoOnly" : "ottoOnly",
        legacy ? "ottoOnly" : "paseoOnly",
      );
    case "workspace.create.request":
      return booleanAlias(
        renamed,
        legacy ? "background" : "hidden",
        legacy ? "hidden" : "background",
      );
    default:
      return renamed;
  }
}

export function normalizeOttoClientMessage(input: unknown): unknown {
  return envelope(input, (message) => clientMessage(message, false));
}

export function encodeOttoClientMessage(input: unknown, legacyHost: boolean): unknown {
  return legacyHost ? envelope(input, (message) => clientMessage(message, true)) : input;
}

export function usesLegacyOttoRpcNames(input: unknown): boolean {
  return (
    record(input) &&
    input.type === "session" &&
    record(input.message) &&
    typeof input.message.type === "string" &&
    Object.hasOwn(RPC_NAMES, input.message.type)
  );
}

/** The old host advertises Otto's Brain API. Version alone would misidentify a
 * genuine Paseo host, and rebuilt development hosts can still report 0.9.35. */
export function isLegacyOttoServerInfo(input: unknown): boolean {
  return (
    record(input) &&
    input.status === "server_info" &&
    typeof input.version === "string" &&
    input.version.startsWith("0.9.") &&
    record(input.features) &&
    input.features.brainControl === true &&
    input.features.backgroundWorkspaces !== true
  );
}

// These old UI invalidations have no consumer while their Otto features are
// dormant. Only recognize their declared shapes; never hide arbitrary RPC errors.
export function isDormantOttoNotification(input: unknown): boolean {
  if (!record(input) || input.type !== "session" || !record(input.message)) return false;
  if (input.message.type === "activity_stats_changed") return true;
  return (
    input.message.type === "suggested_tasks_changed" &&
    record(input.message.payload) &&
    typeof input.message.payload.parentAgentId === "string" &&
    Array.isArray(input.message.payload.tasks)
  );
}
