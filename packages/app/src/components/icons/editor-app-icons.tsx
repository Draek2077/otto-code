import { FolderOpen, SquareTerminal } from "@/components/icons/material-icons";
import { useMemo } from "react";
import { Image, type ImageSourcePropType } from "react-native";
import { isKnownEditorTargetId, type EditorTargetId } from "@/workspace/editor-targets";

interface EditorAppIconProps {
  editorId: EditorTargetId;
  size?: number;
  color: string;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const EDITOR_APP_IMAGES: Record<string, ImageSourcePropType> = {
  cursor: require("../../../assets/images/editor-apps/cursor.png"),
  vscode: require("../../../assets/images/editor-apps/vscode.png"),
  webstorm: require("../../../assets/images/editor-apps/webstorm.png"),
  "intellij-idea": require("../../../assets/images/editor-apps/intellij-idea.png"),
  pycharm: require("../../../assets/images/editor-apps/pycharm.png"),
  phpstorm: require("../../../assets/images/editor-apps/phpstorm.png"),
  rubymine: require("../../../assets/images/editor-apps/rubymine.png"),
  clion: require("../../../assets/images/editor-apps/clion.png"),
  goland: require("../../../assets/images/editor-apps/goland.png"),
  rider: require("../../../assets/images/editor-apps/rider.png"),
  rustrover: require("../../../assets/images/editor-apps/rustrover.png"),
  zed: require("../../../assets/images/editor-apps/zed.png"),
  antigravity: require("../../../assets/images/editor-apps/antigravity.png"),
  finder: require("../../../assets/images/editor-apps/finder.png"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

// File-manager targets (Windows Explorer, generic file managers) use a themed vector
// glyph instead of a bundled app-icon image: those images ship with their own opaque
// canvas color, which reads as a stray background box against the muted icon row here.
const FILE_MANAGER_TARGET_IDS: ReadonlySet<string> = new Set(["explorer", "file-manager"]);

export function hasBundledEditorAppIcon(editorId: EditorTargetId): boolean {
  return (
    isKnownEditorTargetId(editorId) &&
    (EDITOR_APP_IMAGES[editorId] !== undefined || FILE_MANAGER_TARGET_IDS.has(editorId))
  );
}

export function EditorAppIcon({ editorId, size = 16, color }: EditorAppIconProps) {
  const imageStyle = useMemo(() => ({ width: size, height: size }), [size]);

  if (FILE_MANAGER_TARGET_IDS.has(editorId)) {
    return <FolderOpen size={size} color={color} />;
  }

  const source = EDITOR_APP_IMAGES[editorId];
  if (!source) {
    return <SquareTerminal size={size} color={color} />;
  }

  return <Image source={source} style={imageStyle} resizeMode="contain" />;
}
