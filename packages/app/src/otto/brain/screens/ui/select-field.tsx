import { View, type StyleProp, type ViewStyle } from "react-native";
import {
  SelectField as SharedSelectField,
  type SelectFieldProps,
} from "@/components/ui/select-field";

interface BrainSelectFieldProps<Value> extends SelectFieldProps<Value> {
  /** The recovered callers only override minimum width; the shared picker owns interaction. */
  triggerStyle?: StyleProp<ViewStyle>;
}

export function SelectField<Value>({ triggerStyle, ...props }: BrainSelectFieldProps<Value>) {
  return (
    <View style={triggerStyle}>
      <SharedSelectField {...props} />
    </View>
  );
}
