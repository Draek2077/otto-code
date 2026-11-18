import { useCallback, useEffect, useMemo, useRef } from "react";
import { activeTeam, hasProfileRole, teamProfiles } from "@getpaseo/protocol/otto/agent-teams";
import { resolveEffortOption } from "@getpaseo/protocol/otto/profile-effort";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { useAgentProfiles, type AgentProfilePickerRow } from "@/agent-profiles";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { useHostFeature } from "@/runtime/host-features";

function roleModel(
  profile: import("@getpaseo/protocol/agent-profile").AgentProfile,
  entries: readonly ProviderSnapshotEntry[] | undefined | null,
) {
  const entry = entries?.find(
    (e) => e.provider === profile.provider && e.enabled && e.status === "ready",
  );
  const model = profile.model
    ? entry?.models?.find((m) => m.id === profile.model)
    : (entry?.models?.find((m) => m.isDefault) ?? entry?.models?.[0]);
  if (profile.modeId && entry?.modes && !entry.modes.some((m) => m.id === profile.modeId))
    return undefined;
  const requested =
    profile.thinkingOptionId || (typeof profile.effortLevel === "string" && profile.effortLevel);
  if (requested && model) {
    try {
      resolveEffortOption({ requested, thinkingOptions: model.thinkingOptions ?? [] });
    } catch {
      return undefined;
    }
  }
  return model;
}
export function useRolePicker(
  host: string | null,
  role: "scheduler" | "artificer",
  entries: readonly ProviderSnapshotEntry[] | null | undefined,
  selected: string | undefined,
  initialize: boolean,
  apply: (id: string, row: AgentProfilePickerRow) => void,
) {
  const supported = useHostFeature(host, "ottoRolePickers");
  const { preferences, isLoading, updatePreferences } = useFormPreferences();
  const remembered = host ? preferences.roleProfileByHost?.[host]?.[role] : undefined;
  const { profiles, teams } = useAgentProfiles(supported ? host : null);
  const team = activeTeam(teams);
  const data = useMemo(() => {
    const rows: AgentProfilePickerRow[] = [],
      byId = new Map<string, AgentProfilePickerRow>();
    for (const profile of profiles ?? []) {
      if (!hasProfileRole(profile, role)) continue;
      const model = roleModel(profile, entries);
      if (!model) continue;
      const row = {
        id: profile.id,
        provider: profile.provider,
        modelId: model.id,
        icon: profile.icon ?? "",
        color: profile.color ?? "",
        name: profile.name,
        summary: profile.provider + " · " + model.label,
      };
      rows.push(row);
      byId.set(row.id, row);
    }
    const member =
      team &&
      teamProfiles(team, profiles ?? [])
        .map((p) => byId.get(p.id))
        .find(Boolean);
    const memberRow = member && {
      ...member,
      id: role === "scheduler" ? "@team-scheduler" : "@team-artificer",
      name: role === "scheduler" ? "Team’s Scheduler" : "Team’s Artificer",
      summary: member.name + " · " + member.summary,
    };
    if (memberRow) rows.unshift(memberRow);
    return { rows, member };
  }, [profiles, entries, role, team]);
  const select = useCallback(
    (id: string) => {
      const row = data.rows.find((r) => r.id === id);
      if (row) apply(id === "@team-artificer" && data.member ? data.member.id : id, row);
    },
    [apply, data],
  );
  const choose = useCallback(
    (id: string) => {
      select(id);
      if (host)
        void updatePreferences((p) => ({
          ...p,
          roleProfileByHost: {
            ...p.roleProfileByHost,
            [host]: { ...p.roleProfileByHost?.[host], [role]: id },
          },
        })).catch(() => undefined);
    },
    [select, host, role, updatePreferences],
  );
  const touched = useRef<string | null>(null);
  const mark = useCallback(() => {
    touched.current = host;
  }, [host]);
  useEffect(() => {
    if (
      isLoading ||
      !supported ||
      !initialize ||
      touched.current === host ||
      selected ||
      !data.rows[0]
    )
      return;
    mark();
    const fallback = data.member
      ? data.rows[0]
      : (data.rows.find((r) => r.id === remembered) ?? data.rows[0]);
    select(fallback.id);
  }, [host, supported, initialize, selected, data, select, mark, remembered, isLoading]);
  const picker = useMemo(
    () =>
      supported && data.rows.length
        ? {
            rows: data.rows,
            teamName: team?.name,
            currentName: data.rows.find((r) => r.id === selected)?.name ?? selected,
            applyProfile: choose,
          }
        : null,
    [supported, data, team, selected, choose],
  );
  return { picker, mark };
}
