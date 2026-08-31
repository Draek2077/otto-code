import { useMemo } from "react";
import { z } from "zod";
import type { PluginThemeContribution } from "@otto-code/plugin";
import { useHostFeatureMap } from "@/runtime/host-features";
import {
  buildDarkSemanticColors,
  buildDarkTheme,
  buildLightSemanticColors,
  buildLightTheme,
  darkTheme,
  lightTheme,
  type Theme,
} from "@/styles/theme";
import {
  getPreferredPluginContributionHost,
  rememberPluginContributionHost,
} from "../contribution-host";
import { useInstalledPlugins } from "../registry";
import type { InstalledPlugin } from "../types";

const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Must be a hex color");

const contributionSchema: z.ZodType<PluginThemeContribution> = z.strictObject({
  id: z.string(),
  name: z.string().trim().min(1).max(60),
  appearance: z.enum(["light", "dark"]),
  colors: z.strictObject({
    background: hexColorSchema,
    foreground: hexColorSchema,
    raised: hexColorSchema,
    control: hexColorSchema,
    border: hexColorSchema,
    accent: hexColorSchema.optional(),
    mutedForeground: hexColorSchema,
    ring: hexColorSchema,
  }),
});

export interface PluginThemeOption {
  id: string;
  serverId: string;
  name: string;
  swatch: string;
  theme: Theme;
}

interface PluginThemeTarget {
  serverId: string;
  contribution: PluginThemeContribution;
}

export function parsePluginThemeContribution(value: unknown): PluginThemeContribution {
  return contributionSchema.parse(value);
}

function buildDarkPluginTheme(contribution: PluginThemeContribution): Theme {
  const colors = contribution.colors;
  const accent = colors.accent ?? colors.foreground;
  return buildDarkTheme(
    buildDarkSemanticColors({
      surface0: colors.background,
      surface1: colors.raised,
      surface2: colors.control,
      surface3: colors.border,
      surface4: colors.ring,
      surfaceDiffEmpty: colors.raised,
      surfaceSidebar: colors.background,
      foreground: colors.foreground,
      foregroundMuted: colors.mutedForeground,
      foregroundExtraMuted: colors.ring,
      border: colors.border,
      borderAccent: colors.border,
      accent,
      accentBright: accent,
      accentForeground: colors.background,
      destructive: darkTheme.colors.destructive,
      scrollbarHandle: darkTheme.colors.scrollbarHandle,
      spinnerPrimary: darkTheme.colors.spinnerPrimary,
      spinnerSecondary: darkTheme.colors.spinnerSecondary,
      terminalBlack: colors.control,
      terminalBrightBlack: colors.ring,
      // A plugin's `ring` already lands on the tokens Otto has for it
      // (surface4, foregroundExtraMuted, terminalBrightBlack); Otto derives
      // focus rings from the accent ladder rather than from a ring token.
    }),
  );
}

function buildLightPluginTheme(contribution: PluginThemeContribution): Theme {
  const colors = contribution.colors;
  const accent = colors.accent ?? colors.foreground;
  return buildLightTheme(
    buildLightSemanticColors({
      surface0: colors.background,
      surface1: colors.raised,
      surface2: colors.control,
      surface3: colors.border,
      surface4: colors.ring,
      surfaceDiffEmpty: colors.raised,
      surfaceSidebar: colors.control,
      // The slider/switch groove is not something a plugin theme authors.
      surfaceControlTrack: lightTheme.colors.surfaceControlTrack,
      foreground: colors.foreground,
      foregroundMuted: colors.mutedForeground,
      foregroundExtraMuted: colors.ring,
      border: colors.border,
      borderAccent: colors.border,
      accent,
      accentBright: accent,
      accentForeground: colors.background,
      // `primary` is derived from `foreground` inside the palette builder, which
      // is exactly what a plugin would set it to; only its foreground is an input.
      destructive: lightTheme.colors.destructive,
      scrollbarHandle: lightTheme.colors.scrollbarHandle,
      spinnerPrimary: lightTheme.colors.spinnerPrimary,
      spinnerSecondary: lightTheme.colors.spinnerSecondary,
    }),
  );
}

function buildPluginTheme(contribution: PluginThemeContribution): Theme {
  return contribution.appearance === "light"
    ? buildLightPluginTheme(contribution)
    : buildDarkPluginTheme(contribution);
}

function selectTarget(id: string, targets: PluginThemeTarget[]): PluginThemeTarget {
  const preferredHost = getPreferredPluginContributionHost(id);
  return targets.find((target) => target.serverId === preferredHost) ?? targets[0];
}

export function collectPluginThemes(
  plugins: InstalledPlugin[],
  supportedHosts: ReadonlySet<string>,
): PluginThemeOption[] {
  const targetsById = new Map<string, PluginThemeTarget[]>();
  for (const plugin of plugins) {
    if (!supportedHosts.has(plugin.serverId)) continue;
    for (const contribution of plugin.themes) {
      const id = `${plugin.id}/theme/${contribution.id}`;
      const target = { serverId: plugin.serverId, contribution };
      const targets = targetsById.get(id);
      if (targets) targets.push(target);
      else targetsById.set(id, [target]);
    }
  }

  return [...targetsById].map(([id, targets]) => {
    const target = selectTarget(id, targets);
    return {
      id,
      serverId: target.serverId,
      name: target.contribution.name,
      swatch: target.contribution.colors.background,
      theme: buildPluginTheme(target.contribution),
    };
  });
}

export function rememberPluginThemeHost(option: PluginThemeOption): void {
  rememberPluginContributionHost(option.id, option.serverId);
}

function supportedThemeHosts(support: ReadonlyMap<string, boolean>): Set<string> {
  const serverIds = new Set<string>();
  for (const [serverId, supported] of support) {
    if (supported) serverIds.add(serverId);
  }
  return serverIds;
}

export function usePluginThemeCatalog(): PluginThemeOption[] {
  const plugins = useInstalledPlugins();
  const serverIds = useMemo(
    () => [...new Set(plugins.map((plugin) => plugin.serverId))],
    [plugins],
  );
  // COMPAT(pluginThemes): added in v0.5.0, remove gate after 2027-08-20.
  const support = useHostFeatureMap(serverIds, "pluginThemes");
  return useMemo(
    () => collectPluginThemes(plugins, supportedThemeHosts(support)),
    [plugins, support],
  );
}
