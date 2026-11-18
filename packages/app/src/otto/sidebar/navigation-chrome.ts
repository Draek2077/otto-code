import { StyleSheet } from "react-native-unistyles";
import { density } from "@/styles/density";

export const sidebarNavigationChrome = StyleSheet.create({
  wrap: { flexWrap: "wrap" },
  action: { width: density.iconButton, height: density.iconButton },
});
