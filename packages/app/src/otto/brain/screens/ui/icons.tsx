import { createElement } from "react";
import { SvgXml } from "react-native-svg";
import type { StyleProp, ViewStyle } from "react-native";
import { SCREEN_ICON_SVGS } from "./icon-artwork";
export interface BrainIconProps {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}
function screenIcon(xml: string, name: string) {
  function BrainScreenIcon({ size = 18, color, style }: BrainIconProps) {
    return createElement(SvgXml, { xml, width: size, height: size, color, style });
  }
  BrainScreenIcon.displayName = name;
  return BrainScreenIcon;
}
export const Boxes = screenIcon(SCREEN_ICON_SVGS.Boxes, "Boxes");
export const CheckCircle = screenIcon(SCREEN_ICON_SVGS.CheckCircle, "CheckCircle");
export const CircleCheck = screenIcon(SCREEN_ICON_SVGS.CircleCheck, "CircleCheck");
export const Copy = screenIcon(SCREEN_ICON_SVGS.Copy, "Copy");
export const Download = screenIcon(SCREEN_ICON_SVGS.Download, "Download");
export const Eye = screenIcon(SCREEN_ICON_SVGS.Eye, "Eye");
export const Gauge = screenIcon(SCREEN_ICON_SVGS.Gauge, "Gauge");
export const HardDrive = screenIcon(SCREEN_ICON_SVGS.HardDrive, "HardDrive");
export const Info = screenIcon(SCREEN_ICON_SVGS.Info, "Info");
export const Layers = screenIcon(SCREEN_ICON_SVGS.Layers, "Layers");
export const Medal = screenIcon(SCREEN_ICON_SVGS.Medal, "Medal");
export const Minus = screenIcon(SCREEN_ICON_SVGS.Minus, "Minus");
export const Neurology = screenIcon(SCREEN_ICON_SVGS.Neurology, "Neurology");
export const Pencil = screenIcon(SCREEN_ICON_SVGS.Pencil, "Pencil");
export const Play = screenIcon(SCREEN_ICON_SVGS.Play, "Play");
export const Plus = screenIcon(SCREEN_ICON_SVGS.Plus, "Plus");
export const Psychology = screenIcon(SCREEN_ICON_SVGS.Psychology, "Psychology");
export const RotateCw = screenIcon(SCREEN_ICON_SVGS.RotateCw, "RotateCw");
export const Scissors = screenIcon(SCREEN_ICON_SVGS.Scissors, "Scissors");
export const Send = screenIcon(SCREEN_ICON_SVGS.Send, "Send");
export const Server = screenIcon(SCREEN_ICON_SVGS.Server, "Server");
export const Settings2 = screenIcon(SCREEN_ICON_SVGS.Settings2, "Settings2");
export const Square = screenIcon(SCREEN_ICON_SVGS.Square, "Square");
export const Timeline = screenIcon(SCREEN_ICON_SVGS.Timeline, "Timeline");
export const Trash2 = screenIcon(SCREEN_ICON_SVGS.Trash2, "Trash2");
export const Undo2 = screenIcon(SCREEN_ICON_SVGS.Undo2, "Undo2");
export const X = screenIcon(SCREEN_ICON_SVGS.X, "X");
export const Zap = screenIcon(SCREEN_ICON_SVGS.Zap, "Zap");
