import { Bot, PackagePlus } from "@/components/icons/material-icons";
import { createElement, type ComponentType } from "react";
import { SvgXml } from "react-native-svg";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { CopilotIcon } from "@/components/icons/copilot-icon";
import { MiniMaxIcon } from "@/components/icons/minimax-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OmpIcon } from "@/components/icons/omp-icon";
import { PiIcon } from "@/components/icons/pi-icon";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { resolveProviderIconName } from "@/components/provider-icon-name";
import { MATERIAL_SYMBOL_SVGS } from "@/assets/material-symbol-icons";
import type { IconSizeProp } from "@/components/icons/icon-size";

export interface ProviderIconProps {
  size?: IconSizeProp;
  color?: string;
}

export type ProviderIconComponent = ComponentType<ProviderIconProps>;

// The Material brain glyph only inks 712x640 of its 960x960 box; the Claude,
// Codex and Copilot marks bleed to their edges. Rendered at the same nominal
// size next to those - personality avatars, agent rows, the model picker - the
// brain read about a quarter too small. The provider-sized variant crops the
// viewBox to the ink so it matches their width, and is deliberately scoped to
// this file: the `Brain` icon itself keeps its Material padding everywhere else
// (the sidebar rail, the Brain screen, the state machine in
// `components/brain/`), where it sits beside other Material Symbols and must
// stay optically aligned with them.
//
// Bounds measured off the path's control points; asserted in the sibling test
// so a Material glyph refresh that moves the ink fails loudly.
export const PROVIDER_BRAIN_VIEW_BOX = "124 -800 712 640";

const PROVIDER_BRAIN_SVG = MATERIAL_SYMBOL_SVGS.Brain.replace(
  /viewBox="[^"]*"/,
  `viewBox="${PROVIDER_BRAIN_VIEW_BOX}"`,
);

const ProviderBrainIcon: ProviderIconComponent = ({ size, color }) =>
  createElement(SvgXml, { xml: PROVIDER_BRAIN_SVG, width: size, height: size, color });
ProviderBrainIcon.displayName = "ProviderBrainIcon";

// App-only provider ids that are not part of the protocol icon-name registry
// but still need a specific icon (e.g. the built-in local brain host).
const APP_PROVIDER_ICONS: Record<string, ProviderIconComponent> = {
  "otto-brain": ProviderBrainIcon,
};

const BUILTIN_PROVIDER_ICONS: Record<string, ProviderIconComponent> = {
  claude: ClaudeIcon as unknown as ProviderIconComponent,
  codex: CodexIcon as unknown as ProviderIconComponent,
  copilot: CopilotIcon as unknown as ProviderIconComponent,
  kiro: PackagePlus,
  minimax: MiniMaxIcon as unknown as ProviderIconComponent,
  omp: OmpIcon as unknown as ProviderIconComponent,
  opencode: OpenCodeIcon as unknown as ProviderIconComponent,
  pi: PiIcon as unknown as ProviderIconComponent,
};

const CATALOG_ICON_SVGS = new Map(
  ACP_PROVIDER_CATALOG.flatMap((entry) => (entry.iconSvg ? [[entry.id, entry.iconSvg]] : [])),
);

// Raw SVG source strings keyed by provider id. Used on web for mask-image
// compositing (see `personality-provider-icon.web.tsx`). Material Symbol icons
// are stored as strings in MATERIAL_SYMBOL_SVGS; builtin hand-written icons are
// stored as strings here so we don't need to render React components to get at
// their markup.
const APP_PROVIDER_SVGS: Record<string, string> = {
  "otto-brain": PROVIDER_BRAIN_SVG,
};

const BUILTIN_PROVIDER_SVGS: Record<string, string> = {
  claude:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/></svg>',
  codex:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.553 5.553 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.02.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.002zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z"/></svg>',
  copilot:
    '<svg xmlns="http://www.w3.org/2000/svg" width="416" height="512" viewBox="0 0 512 416" fill="currentColor"><path d="M181.33 266.143c0-11.497 9.32-20.818 20.818-20.818 11.498 0 20.819 9.321 20.819 20.818v38.373c0 11.497-9.321 20.818-20.819 20.818-11.497 0-20.818-9.32-20.818-20.818v-38.373zM308.807 245.325c-11.477 0-20.798 9.321-20.798 20.818v38.373c0 11.497 9.32 20.818 20.798 20.818 11.497 0 20.818-9.32 20.818-20.818v-38.373c0-11.497-9.32-20.818-20.818-20.818z" fill-rule="nonzero"/><path d="M512.002 246.393v57.384c-.02 7.411-3.696 14.638-9.67 19.011C431.767 374.444 344.695 416 256 416c-98.138 0-196.379-56.542-246.33-93.21-5.975-4.374-9.65-11.6-9.671-19.012v-57.384a35.347 35.347 0 016.857-20.922l15.583-21.085c8.336-11.312 20.757-14.31 33.98-14.31 4.988-56.953 16.794-97.604 45.024-127.354C155.194 5.77 226.56 0 256 0c29.441 0 100.807 5.77 154.557 62.722 28.19 29.75 40.036 70.401 45.025 127.354 13.263 0 25.602 2.936 33.958 14.31l15.583 21.127c4.476 6.077 6.878 13.345 6.878 20.88zm-97.666-26.075c-.677-13.058-11.292-18.19-22.338-21.824-11.64 7.309-25.848 10.183-39.46 10.183-14.454 0-41.432-3.47-63.872-25.869-5.667-5.625-9.527-14.454-12.155-24.247a212.902 212.902 0 00-20.469-1.088c-6.098 0-13.099.349-20.551 1.088-2.628 9.793-6.509 18.622-12.155 24.247-22.4 22.4-49.418 25.87-63.872 25.87-13.612 0-27.86-2.855-39.501-10.184-11.005 3.613-21.558 8.828-22.277 21.824-1.17 24.555-1.272 49.11-1.375 73.645-.041 12.318-.082 24.658-.288 36.976.062 7.166 4.374 13.818 10.882 16.774 52.97 24.124 103.045 36.278 149.137 36.278 46.01 0 96.085-12.154 149.014-36.278 6.508-2.956 10.84-9.608 10.881-16.774.637-36.832.124-73.809-1.642-110.62h.041zM107.521 168.97c8.643 8.623 24.966 14.392 42.56 14.392 13.448 0 39.03-2.874 60.156-24.329 9.28-8.951 15.05-31.35 14.413-54.079-.657-18.231-5.769-33.28-13.448-39.665-8.315-7.371-27.203-10.574-48.33-8.644-22.399 2.238-41.267 9.588-50.875 19.833-20.798 22.728-16.323 80.317-4.476 92.492zm130.556-56.008c.637 3.51.965 7.35 1.273 11.517 0 2.875 0 5.77-.308 8.952 6.406-.636 11.847-.636 16.959-.636s10.553 0 16.959.636c-.329-3.182-.329-6.077-.329-8.952.329-4.167.657-8.007 1.294-11.517-6.735-.637-12.812-.965-17.924-.965s-11.21.328-17.924.965zm49.275-8.008c-.637 22.728 5.133 45.128 14.413 54.08 21.105 21.454 46.708 24.328 60.155 24.328 17.596 0 33.918-5.769 42.561-14.392 11.847-12.175 16.322-69.764-4.476-92.492-9.608-10.245-28.476-17.595-50.875-19.833-21.127-1.93-40.015 1.273-48.33 8.644-7.679 6.385-12.791 21.434-13.448 39.665z"/></svg>',
  kiro: MATERIAL_SYMBOL_SVGS.PackagePlus,
  minimax:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 01-.652.645.648.648 0 01-.652-.645V4.07a.785.785 0 00-.789-.78.785.785 0 00-.789.78v14.013a2.06 2.06 0 01-2.07 2.048 2.06 2.06 0 01-2.071-2.048V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v3.8a2.06 2.06 0 01-2.071 2.049A2.06 2.06 0 010 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 012.07-2.048 2.06 2.06 0 012.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z"/></svg>',
  omp: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="4 4 56 56" fill="currentColor"><path d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z"/></svg>',
  opencode:
    '<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384" viewBox="96 64 288 384" fill="currentColor"><path d="M320 224V352H192V224H320Z" opacity="0.4"/><path fill-rule="evenodd" clip-rule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"/></svg>',
  pi: '<svg xmlns="http://www.w3.org/2000/svg" width="734" height="734" viewBox="100 100 600 600" fill="currentColor"><path d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z" fill-rule="evenodd"/><path d="M517.36 400 H634.72 V634.72 H517.36 Z"/></svg>',
};

const catalogIconComponents = new Map<string, ProviderIconComponent>();

function createCatalogIcon(provider: string, iconSvg: string): ProviderIconComponent {
  const CatalogProviderIcon: ProviderIconComponent = ({ size, color }) =>
    createElement(SvgXml, {
      xml: iconSvg,
      width: size,
      height: size,
      color,
    });
  CatalogProviderIcon.displayName = `CatalogProviderIcon(${provider})`;
  return CatalogProviderIcon;
}

function getCatalogProviderIcon(provider: string): ProviderIconComponent {
  const cached = catalogIconComponents.get(provider);
  if (cached) {
    return cached;
  }
  const iconSvg = CATALOG_ICON_SVGS.get(provider);
  if (!iconSvg) {
    return Bot;
  }
  const icon = createCatalogIcon(provider, iconSvg);
  catalogIconComponents.set(provider, icon);
  return icon;
}

export function getProviderIcon(provider: string): ProviderIconComponent {
  const appIcon = APP_PROVIDER_ICONS[provider];
  if (appIcon) {
    return appIcon;
  }
  const name = resolveProviderIconName(provider);
  if (name.kind === "builtin") {
    return BUILTIN_PROVIDER_ICONS[name.id];
  }
  if (name.kind === "catalog") {
    return getCatalogProviderIcon(name.id);
  }
  return Bot;
}

/**
 * Return the raw SVG source string for a provider's icon.
 *
 * Used on web for CSS `mask-image` compositing (see `personality-provider-icon.web.tsx`).
 * The returned SVG uses `fill="currentColor"` so the caller can control color, or
 * strip it for mask use where color is irrelevant.
 */
export function getProviderIconSvg(provider: string): string {
  const appSvg = APP_PROVIDER_SVGS[provider];
  if (appSvg) {
    return appSvg;
  }
  const name = resolveProviderIconName(provider);
  if (name.kind === "builtin") {
    return BUILTIN_PROVIDER_SVGS[name.id] ?? MATERIAL_SYMBOL_SVGS.Bot;
  }
  if (name.kind === "catalog") {
    return CATALOG_ICON_SVGS.get(name.id) ?? MATERIAL_SYMBOL_SVGS.Bot;
  }
  return MATERIAL_SYMBOL_SVGS.Bot;
}
