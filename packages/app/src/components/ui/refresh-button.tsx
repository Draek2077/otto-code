import { withUnistyles } from "react-native-unistyles";
import { RefreshCw } from "@/components/icons/material-icons";
import { ToolbarIconButton } from "./toolbar-icon-button";

const ThemedRefresh = withUnistyles(RefreshCw);

export function RefreshButton(props: {
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return <ToolbarIconButton {...props} label="Refresh" Icon={ThemedRefresh} />;
}
