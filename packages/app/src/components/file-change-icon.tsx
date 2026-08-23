import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { SquareMinus, SquarePlus } from "@/components/icons/material-icons";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";

const ThemedSquarePlus = withUnistyles(SquarePlus);
const ThemedSquareMinus = withUnistyles(SquareMinus);

const successMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const dangerMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

const ICON_SIZE = 14;

/**
 * Whether a file was added or removed outright, shown beside its diff stat.
 *
 * Square-plus / square-minus because that is what every forge uses for the same fact, so it needs
 * no label — the shape is the word. It sits at the same muted weight as the "+12 −3" next to it:
 * these are footnotes on a file header, not the diff body where colour carries the line-by-line
 * signal.
 */
// Material glyphs take only size, colour and style, so the label rides on a wrapper the
// same way ScopeBadge does it.
function LabelledIcon({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <View collapsable={false} accessibilityRole="image" accessibilityLabel={label}>
      {children}
    </View>
  );
}

export function FileChangeIcon({ change }: { change: "added" | "deleted" }): ReactElement {
  const { t } = useTranslation();

  if (change === "added") {
    return (
      <LabelledIcon label={t("workspace.git.diff.newFile")}>
        <ThemedSquarePlus size={ICON_SIZE} uniProps={successMapping} />
      </LabelledIcon>
    );
  }

  return (
    <LabelledIcon label={t("workspace.git.diff.deletedFile")}>
      <ThemedSquareMinus size={ICON_SIZE} uniProps={dangerMapping} />
    </LabelledIcon>
  );
}
