import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { View } from "react-native";
import { settingsStyles } from "@/styles/settings";

function rows(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? rows(child.props.children)
      : [child],
  );
}

/** Internal rows of a compound field use the same separator as SettingsCard. */
export function SettingsRows({ children }: { children: ReactNode }) {
  return (
    <View>
      {rows(children).map((child, index) => (
        <View
          key={isValidElement(child) ? child.key : index}
          style={index ? settingsStyles.rowBorder : undefined}
        >
          {child}
        </View>
      ))}
    </View>
  );
}
