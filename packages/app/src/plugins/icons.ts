import { createElement, type ReactElement, type ComponentProps } from "react";
import * as LucideIcons from "lucide-react-native";
import type { PluginIconProps } from "@otto-code/plugin/client";
import type { LucideIcon } from "lucide-react-native";
import { withIconSizeToken } from "@/components/icons/icon-size";

function findPluginIcon(name: string): LucideIcon | null {
  const candidate = Reflect.get(LucideIcons, name);
  if (candidate === LucideIcons.Icon || candidate === LucideIcons.createLucideIcon) return null;
  const isComponent =
    typeof candidate === "function" ||
    (typeof candidate === "object" && candidate !== null && "$$typeof" in candidate);
  return isComponent ? (candidate as LucideIcon) : null;
}

type TokenIcon = ReturnType<typeof withIconSizeToken<ComponentProps<LucideIcon>>>;
const sizedIcons = new Map<string, TokenIcon>();

export function resolvePluginIcon(name: string) {
  const icon = findPluginIcon(name);
  if (!icon) throw new Error(`Unknown Lucide icon: ${name}`);
  let sized = sizedIcons.get(name);
  if (!sized) {
    sized = withIconSizeToken(icon, `PluginIcon(${name})`);
    sizedIcons.set(name, sized);
  }
  return sized;
}

export function Icon({ name, size, color }: PluginIconProps): ReactElement | null {
  const icon = findPluginIcon(name);
  return icon ? createElement(icon, { size, color }) : null;
}
