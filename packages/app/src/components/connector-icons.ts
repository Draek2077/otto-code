import { CONNECTOR_BRAND_ICON_SVGS } from "@/assets/connector-brand-icons";
import { MATERIAL_SYMBOL_SVGS } from "@/assets/material-symbol-icons";

const LOCAL_CONNECTOR_ICONS: Readonly<Record<string, string>> = {
  filesystem: MATERIAL_SYMBOL_SVGS.Folder,
  memory: MATERIAL_SYMBOL_SVGS.Database,
};

export function getConnectorIconSvg(id: string): string {
  if (Object.hasOwn(CONNECTOR_BRAND_ICON_SVGS, id)) {
    return CONNECTOR_BRAND_ICON_SVGS[id];
  }
  if (Object.hasOwn(LOCAL_CONNECTOR_ICONS, id)) {
    return LOCAL_CONNECTOR_ICONS[id];
  }
  return MATERIAL_SYMBOL_SVGS.Plug;
}
