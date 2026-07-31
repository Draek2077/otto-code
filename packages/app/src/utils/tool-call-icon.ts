import type { ComponentType } from "react";
import {
  Brain,
  Eye,
  MicVocal,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "@/components/icons/material-icons";
import type { ToolCallDetail } from "@otto-code/protocol/agent-types";
import { OttoFaceIcon } from "@/components/icons/otto-face-icon";
import { OttoLogo } from "@/components/icons/otto-logo";
import { resolveToolCallIconName, type ToolCallIcon } from "./tool-call-icon-name";

export type ToolCallIconComponent = ComponentType<{
  size: number;
  color: string;
  // Only the Otto face reads this — it winks while the call is running.
  isActive?: boolean;
}>;

const ICON_COMPONENTS: Record<ToolCallIcon, ToolCallIconComponent> = {
  wrench: Wrench,
  square_terminal: SquareTerminal,
  eye: Eye,
  pencil: Pencil,
  search: Search,
  // Otto's own face rather than a stock robot head: in the transcript this row
  // is Otto doing the work. Scoped to the chat tool-call rail — provider logos,
  // Settings, and Stats keep the neutral robot.
  bot: OttoFaceIcon,
  sparkles: Sparkles,
  brain: Brain,
  mic_vocal: MicVocal,
  otto: OttoLogo,
};

// Lucide ships every glyph with slack inside its 24×24 viewBox, which callers
// correct with a negative margin. The Otto face crops its viewBox to the ink
// instead, so that correction would push it off the rail — and because the mark
// is wide and short, it needs its own width to carry the same optical weight.
const TIGHT_GLYPH_ICONS: ReadonlySet<ToolCallIconComponent> = new Set([OttoFaceIcon]);

export function isTightGlyphToolIcon(icon: ToolCallIconComponent): boolean {
  return TIGHT_GLYPH_ICONS.has(icon);
}

export function componentForToolCallIcon(name: ToolCallIcon): ToolCallIconComponent {
  return ICON_COMPONENTS[name];
}

export function resolveToolCallIcon(
  toolName: string,
  detail?: ToolCallDetail,
): ToolCallIconComponent {
  return componentForToolCallIcon(resolveToolCallIconName(toolName, detail));
}
