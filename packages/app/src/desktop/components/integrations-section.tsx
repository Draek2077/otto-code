import { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ArrowUpRight, Terminal, Blocks, Check } from "@/components/icons/material-icons";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { Button } from "@/components/ui/button";
import { openLink } from "@/utils/open-link";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  shouldUseDesktopDaemon,
  type SkillOp,
  type SkillsStatus,
} from "@/desktop/daemon/desktop-daemon";
import { useCliInstall, useSkillsStatus } from "@/desktop/hooks/use-install-status";

const CLI_DOCS_URL = "https://otto-code.me/docs/cli";
const SKILLS_DOCS_URL = "https://otto-code.me/docs/skills";
const ROW_RESPONSIVE_WITH_BORDER_STYLE = [settingsStyles.rowResponsive, settingsStyles.rowBorder];

const OP_KIND_ORDER: Record<SkillOp["kind"], number> = { add: 0, update: 1, delete: 2 };
const OP_KIND_LABEL_KEY: Record<SkillOp["kind"], string> = {
  add: "settings.integrations.operations.add",
  update: "settings.integrations.operations.update",
  delete: "settings.integrations.operations.delete",
};

function formatUpdateMessage(ops: readonly SkillOp[], t: TFunction): string {
  const sorted = [...ops].sort((a, b) => {
    const kindOrder = OP_KIND_ORDER[a.kind] - OP_KIND_ORDER[b.kind];
    return kindOrder !== 0 ? kindOrder : a.name.localeCompare(b.name);
  });
  return sorted.map((op) => `${t(OP_KIND_LABEL_KEY[op.kind])} ${op.name}`).join("\n");
}

export function IntegrationsSection() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const showSection = shouldUseDesktopDaemon();
  const {
    status: cliStatus,
    isInstalling: isInstallingCli,
    install: installCli,
    refresh: refreshCliStatus,
  } = useCliInstall();
  const {
    status: skillsStatus,
    isWorking: isSkillsWorking,
    install: installSkills,
    update: updateSkills,
    uninstall: uninstallSkills,
    refresh: refreshSkillsStatus,
  } = useSkillsStatus();

  useFocusEffect(
    useCallback(() => {
      if (!showSection) return undefined;
      refreshCliStatus();
      void refreshSkillsStatus();
      return undefined;
    }, [refreshCliStatus, refreshSkillsStatus, showSection]),
  );

  const handleInstallCli = useCallback(() => {
    if (isInstallingCli) return;
    installCli();
  }, [installCli, isInstallingCli]);

  const handleInstallSkills = useCallback(() => {
    if (isSkillsWorking) return;
    void installSkills();
  }, [installSkills, isSkillsWorking]);

  const handleUpdateSkills = useCallback(async () => {
    if (isSkillsWorking) return;
    const ops = skillsStatus?.ops ?? [];
    const confirmed = await confirmDialog({
      title: t("settings.integrations.skills.updateTitle"),
      message:
        ops.length > 0
          ? formatUpdateMessage(ops, t)
          : t("settings.integrations.skills.updateFallback"),
      confirmLabel: t("settings.integrations.actions.update"),
    });
    if (!confirmed) return;
    await updateSkills();
  }, [isSkillsWorking, skillsStatus, t, updateSkills]);

  const handleUninstallSkills = useCallback(async () => {
    if (isSkillsWorking) return;
    const confirmed = await confirmDialog({
      title: t("settings.integrations.skills.uninstallTitle"),
      message: t("settings.integrations.skills.uninstallMessage"),
      confirmLabel: t("settings.integrations.actions.uninstall"),
      destructive: true,
    });
    if (!confirmed) return;
    await uninstallSkills();
  }, [isSkillsWorking, t, uninstallSkills]);

  const handleOpenCliDocs = useCallback(() => {
    void openLink(CLI_DOCS_URL);
  }, []);

  const handleOpenSkillsDocs = useCallback(() => {
    void openLink(SKILLS_DOCS_URL);
  }, []);

  const arrowIcon = useMemo(
    () => <ArrowUpRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    [theme.iconSize.sm, theme.colors.foregroundMuted],
  );

  // Doc links live in a centered footer below the cards (not the section
  // header) so they never overflow the header on narrow windows; they wrap one
  // beneath the other when both don't fit on a single line.
  const docsFooter = useMemo(
    () => (
      <View style={styles.docsFooter}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={arrowIcon}
          textStyle={settingsStyles.sectionHeaderLinkText}
          style={settingsStyles.sectionHeaderLink}
          onPress={handleOpenCliDocs}
          accessibilityLabel={t("settings.integrations.docs.openCli")}
        >
          {t("settings.integrations.docs.cli")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={arrowIcon}
          textStyle={settingsStyles.sectionHeaderLinkText}
          style={settingsStyles.sectionHeaderLink}
          onPress={handleOpenSkillsDocs}
          accessibilityLabel={t("settings.integrations.docs.openSkills")}
        >
          {t("settings.integrations.docs.skills")}
        </Button>
      </View>
    ),
    [arrowIcon, handleOpenCliDocs, handleOpenSkillsDocs, t],
  );

  if (!showSection) {
    return null;
  }

  const skillsState = skillsStatus?.state ?? null;

  return (
    <SettingsSection title={t("settings.integrations.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <View style={styles.rowTitleRow}>
              <Terminal size={theme.iconSize.md} color={theme.colors.foreground} />
              <Text style={settingsStyles.rowTitle}>
                {t("settings.integrations.commandLine.title")}
              </Text>
            </View>
            <Text style={settingsStyles.rowHint}>
              {t("settings.integrations.commandLine.description")}
            </Text>
          </View>
          {cliStatus?.installed ? (
            <View style={styles.installedLabel}>
              <Check size={14} color={theme.colors.foregroundMuted} />
              <Text style={styles.mutedText}>{t("settings.integrations.actions.installed")}</Text>
            </View>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onPress={handleInstallCli}
              disabled={isInstallingCli}
            >
              {isInstallingCli
                ? t("settings.integrations.actions.installing")
                : t("settings.integrations.actions.install")}
            </Button>
          )}
        </View>
        <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <View style={styles.rowTitleRow}>
              <Blocks size={theme.iconSize.md} color={theme.colors.foreground} />
              <Text style={settingsStyles.rowTitle}>{t("settings.integrations.skills.title")}</Text>
            </View>
            <Text style={settingsStyles.rowHint}>
              {skillsState === "drift"
                ? t("settings.integrations.skills.updateAvailable")
                : t("settings.integrations.skills.description")}
            </Text>
          </View>
          <SkillsActions
            state={skillsState}
            isWorking={isSkillsWorking}
            onInstall={handleInstallSkills}
            onUpdate={handleUpdateSkills}
            onUninstall={handleUninstallSkills}
          />
        </View>
      </View>
      {docsFooter}
    </SettingsSection>
  );
}

interface SkillsActionsProps {
  state: SkillsStatus["state"] | null;
  isWorking: boolean;
  onInstall: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
}

function SkillsActions({ state, isWorking, onInstall, onUpdate, onUninstall }: SkillsActionsProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  if (state === "up-to-date") {
    return (
      <View style={ACTIONS_ROW_STYLE}>
        <View style={styles.installedLabel}>
          <Check size={14} color={theme.colors.foregroundMuted} />
          <Text style={styles.mutedText}>{t("settings.integrations.actions.installed")}</Text>
        </View>
        <Button variant="outline" size="sm" onPress={onUninstall} disabled={isWorking}>
          {t("settings.integrations.actions.uninstall")}
        </Button>
      </View>
    );
  }

  if (state === "drift") {
    return (
      <View style={ACTIONS_ROW_STYLE}>
        <Button variant="outline" size="sm" onPress={onUpdate} disabled={isWorking}>
          {isWorking
            ? t("settings.integrations.actions.working")
            : t("settings.integrations.actions.update")}
        </Button>
        <Button variant="outline" size="sm" onPress={onUninstall} disabled={isWorking}>
          {t("settings.integrations.actions.uninstall")}
        </Button>
      </View>
    );
  }

  return (
    <Button variant="outline" size="sm" onPress={onInstall} disabled={isWorking}>
      {isWorking
        ? t("settings.integrations.actions.installing")
        : t("settings.integrations.actions.install")}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  docsFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  installedLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actionsRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));

const ACTIONS_ROW_STYLE = [styles.actionsRow, settingsStyles.rowControlGroup];
