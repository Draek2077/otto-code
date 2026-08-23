import type { ComponentType } from "react";
import { SvgXml } from "react-native-svg";
import { getFileIconSvg } from "@/components/file-icon-svg";
import type { PanelIconProps } from "@/panels/panel-registry";
import { withIconSizeToken } from "@/components/icons/icon-size";

export function MaterialFileIcon({ fileName, size }: { fileName: string; size: number }) {
  return <SvgXml xml={getFileIconSvg(fileName)} width={size} height={size} />;
}

export function createMaterialFileIcon(fileName: string): ComponentType<PanelIconProps> {
  // Bound to one file name, this is a plain measured icon, so it takes the same token
  // wrapper every other icon does rather than resolving a size of its own.
  function BoundMaterialFileIcon({ size }: { size: number; color?: string }) {
    return <MaterialFileIcon fileName={fileName} size={size} />;
  }
  return withIconSizeToken(BoundMaterialFileIcon, `MaterialFileIcon(${fileName})`);
}
