import { useCallback, useEffect, useState, type ComponentType, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useTutorialAnchor } from "@/tutorial/use-tutorial-anchor";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import {
  FolderOpen,
  Inbox,
  Plug,
  Smartphone,
  Sparkles,
  WandStars,
} from "@/components/icons/material-icons";
import { OttoLogoWink } from "@/components/icons/otto-logo";
import { Button } from "@/components/ui/button";
import { CommunityLinks } from "@/components/community-links";
import { useTutorialStore } from "@/tutorial/store";
import { MenuHeader } from "@/components/headers/menu-header";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import { useHostChooser } from "@/hosts/host-chooser";
import { usePanelStore } from "@/stores/panel-store";
import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import {
  buildHostAgentDetailRoute,
  buildSettingsHostSectionRoute,
  buildSetupRoute,
} from "@/utils/host-routes";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useOpenProject } from "@/hooks/use-open-project";
import type { Href } from "expo-router";

interface HomeQuote {
  text: string;
  attribution: string;
}

// Picked once per app launch and reused for every render/remount of this screen in the same run.
let sessionQuoteIndex: number | undefined;

function getSessionQuoteIndex(count: number): number {
  if (sessionQuoteIndex === undefined || sessionQuoteIndex >= count) {
    sessionQuoteIndex = Math.floor(Math.random() * count);
  }
  return sessionQuoteIndex;
}

export function OpenProjectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const openProjectPicker = useOpenProjectPicker();
  const chooseHost = useHostChooser();
  const localServerId = useLocalDaemonServerId();
  const [importServerId, setImportServerId] = useState<string | null>(null);
  const importClient = useHostRuntimeClient(importServerId ?? "");
  const openImportedProject = useOpenProject(importServerId);
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);

  const quotes = t("openProject.quotes", { returnObjects: true }) as HomeQuote[];
  const quote = quotes[getSessionQuoteIndex(quotes.length)];

  const isCompactLayout = useIsCompactFormFactor();
  const addProjectAnchorRef = useTutorialAnchor("add-project");

  useEffect(() => {
    if (!isCompactLayout) {
      openDesktopAgentList();
    }
  }, [isCompactLayout, openDesktopAgentList]);

  const handleOpenPicker = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  const handleOpenImportSession = useCallback(() => {
    chooseHost({
      title: "Import from host",
      onChooseHost: (serverId) => {
        setImportServerId(serverId);
        setIsImportSheetOpen(true);
      },
    });
  }, [chooseHost]);
  const handleCloseImportSession = useCallback(() => setIsImportSheetOpen(false), []);

  const handleImported = useCallback(
    (agent: { id: string; cwd: string }) => {
      if (!importServerId) return;
      void (async () => {
        const result = await openImportedProject(agent.cwd);
        if (result.ok) {
          router.push(buildHostAgentDetailRoute(importServerId, agent.id) as Href);
        }
      })();
    },
    [importServerId, openImportedProject, router],
  );

  const handleLaunchTutorial = useCallback(() => {
    useTutorialStore.getState().relaunch();
  }, []);

  const handleOpenSetupWizard = useCallback(() => {
    router.push(buildSetupRoute());
  }, [router]);

  const handleOpenProviders = useCallback(() => {
    chooseHost({
      title: "Choose host",
      onChooseHost: (serverId) => {
        router.push(buildSettingsHostSectionRoute(serverId, "providers"));
      },
    });
  }, [chooseHost, router]);

  return (
    <View style={styles.container}>
      <MenuHeader borderless />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <TitlebarDragRegion />
          <View style={styles.logo}>
            <OttoLogoWink size={104} />
          </View>
          <View style={styles.quote}>
            <Text style={styles.quoteText}>
              “{quote.text}” {quote.attribution}
            </Text>
          </View>
          <View style={styles.tiles}>
            <HomeTile
              icon={FolderOpen}
              title={t("openProject.tiles.addProject.title")}
              description={t("openProject.tiles.addProject.description")}
              onPress={handleOpenPicker}
              testID="open-project-submit"
              anchorRef={addProjectAnchorRef}
              accent
            />
            <HomeTile
              icon={Inbox}
              title={t("openProject.tiles.importSession.title")}
              description={t("openProject.tiles.importSession.description")}
              onPress={handleOpenImportSession}
              testID="open-project-import-session"
            />
            <HomeTile
              icon={Plug}
              title={t("openProject.tiles.setupProviders.title")}
              description={t("openProject.tiles.setupProviders.description")}
              onPress={handleOpenProviders}
              testID="open-project-setup-providers"
            />
            {localServerId ? (
              <HomeTile
                icon={Smartphone}
                title={t("openProject.tiles.pairDevice.title")}
                description={t("openProject.tiles.pairDevice.description")}
                onPress={handleOpenPairDevice}
                testID="open-project-pair-device"
              />
            ) : null}
          </View>
        </View>
        <View style={styles.tutorialRow}>
          <Button
            variant="outline"
            size="sm"
            leftIcon={WandStars}
            onPress={handleOpenSetupWizard}
            testID="open-project-launch-setup-wizard"
          >
            {t("openProject.setupWizard")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={Sparkles}
            onPress={handleLaunchTutorial}
            testID="open-project-launch-tutorial"
          >
            {t("tutorial.launch")}
          </Button>
        </View>
        <View style={styles.communityRow}>
          <CommunityLinks />
        </View>
      </ScrollView>
      <PairDeviceModal
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="open-project-pair-device-modal"
      />
      <ImportSessionSheet
        visible={isImportSheetOpen}
        client={importClient}
        serverId={importServerId}
        onClose={handleCloseImportSession}
        onImported={handleImported}
      />
    </View>
  );
}

interface HomeTileProps {
  icon: ComponentType<{ size: number; color: string }>;
  title: string;
  description: string;
  onPress: () => void;
  testID?: string;
  anchorRef?: Ref<View>;
  accent?: boolean;
}

const TILE_SHADOW_DARK = "0 0 5px rgba(0, 0, 0, 0.2)";
const TILE_SHADOW_LIGHT = "0 0 5px rgba(0, 0, 0, 0.1)";

function HomeTile({
  icon: Icon,
  title,
  description,
  onPress,
  testID,
  anchorRef,
  accent,
}: HomeTileProps) {
  // useUnistyles is acceptable here: leaf component, off the hot path (home screen renders once).
  const { theme } = useUnistyles();
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const iconColor = accent ? theme.colors.accent : theme.colors.foregroundMuted;

  // The shadow must flow through React, not a `theme.colorScheme` ternary in the
  // StyleSheet factory: on web the factory's non-color values are computed once at
  // module load against the then-active theme and freeze on the startup scheme
  // (docs/unistyles.md).
  const boxShadow = theme.colorScheme === "dark" ? TILE_SHADOW_DARK : TILE_SHADOW_LIGHT;

  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.tile,
      { boxShadow },
      hovered && styles.tileHovered,
      pressed && styles.tilePressed,
    ],
    [hovered, boxShadow],
  );

  return (
    <Pressable
      ref={anchorRef}
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      testID={testID}
      style={pressableStyle}
    >
      <Icon size={theme.iconSize.lg} color={iconColor} />
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    position: "relative",
    flexGrow: 1,
    justifyContent: { xs: "flex-start", md: "center" },
    alignItems: "center",
    gap: 0,
    padding: theme.spacing[6],
    paddingTop: { xs: theme.spacing[12], md: theme.spacing[6] },
    // The header sits above this centering region, so reserve the same height
    // at the bottom — otherwise the block centers in the below-header space
    // and reads as sitting too low on the page.
    paddingBottom: { xs: theme.spacing[4], md: theme.spacing[4] + HEADER_INNER_HEIGHT },
  },
  logo: {
    marginBottom: theme.spacing[4],
  },
  quote: {
    alignItems: "center",
    maxWidth: 380,
    marginBottom: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  quoteText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 20,
  },
  tiles: {
    marginTop: { xs: theme.spacing[4], md: theme.spacing[6] },
    width: "100%",
    maxWidth: 452,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: theme.spacing[3],
  },
  tile: {
    width: { xs: "100%", md: 220 },
    minHeight: { xs: 0, md: 132 },
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    gap: theme.spacing[3],
  },
  tileHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  tilePressed: {
    opacity: 0.85,
  },
  tileText: {
    gap: theme.spacing[1],
  },
  tileTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  tileDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  tutorialRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
  communityRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
    paddingTop: theme.spacing[2],
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[2],
      md: HEADER_INNER_HEIGHT + theme.spacing[2],
    },
  },
}));
