import type { ComponentType } from "react";
import {
  Bot,
  ListTodo,
  LocalPolice,
  PrivacyTip,
  Psychology,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldPerson,
  ShieldQuestionMark,
  ShieldToggle,
  Zap,
} from "@/components/icons/material-icons";
import {
  getModeVisuals,
  type AgentProviderDefinition,
} from "@otto-code/protocol/provider-manifest";
import type { IconSizeProp } from "@/components/icons/icon-size";

export interface AgentControlIconProps {
  size?: IconSizeProp;
  color?: string;
}

export type AgentControlIcon = ComponentType<AgentControlIconProps>;

export const ThinkingIcon = Psychology;
export const PlanModeIcon = ListTodo;

const MODE_ICONS: Record<string, AgentControlIcon> = {
  Bot,
  LocalPolice,
  PrivacyTip,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldPerson,
  ShieldQuestionMark,
  ShieldToggle,
};

const FEATURE_ICONS: Record<string, AgentControlIcon> = {
  "list-todo": ListTodo,
  "shield-check": ShieldCheck,
  zap: Zap,
};

export function getAgentModeIcon(
  provider: string,
  modeId: string,
  providerDefinitions: AgentProviderDefinition[],
): AgentControlIcon {
  const icon = getModeVisuals(provider, modeId, providerDefinitions)?.icon;
  return (icon ? MODE_ICONS[icon] : undefined) ?? ShieldQuestionMark;
}

export function getAgentModeOptionIcon(
  provider: string,
  modeId: string,
  providerDefinitions: AgentProviderDefinition[],
): AgentControlIcon {
  const icon = getModeVisuals(provider, modeId, providerDefinitions)?.icon;
  return (icon ? MODE_ICONS[icon] : undefined) ?? ShieldQuestionMark;
}

export function getAgentFeatureIcon(icon?: string): AgentControlIcon {
  return (icon ? FEATURE_ICONS[icon] : undefined) ?? Settings2;
}
