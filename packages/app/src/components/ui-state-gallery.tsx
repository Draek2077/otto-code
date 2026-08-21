import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, useColorScheme, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ChevronDown, Plus, Settings, Trash2 } from "@/components/icons/material-icons";
import { Alert, type AlertVariant } from "@/components/ui/alert";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import { ColorWheelPicker } from "@/components/ui/color-wheel-picker";
import { ComboboxItem } from "@/components/ui/combobox";
import {
  ControlStatePreview,
  type ControlStatePreviewValue,
} from "@/components/ui/control-state-preview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NumberStepperField } from "@/components/ui/number-stepper-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { SelectFieldTrigger } from "@/components/ui/select-field";
import { Shortcut } from "@/components/ui/shortcut";
import { Slider } from "@/components/ui/slider";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import {
  SplitButton,
  SplitButtonMenuTrigger,
  SplitButtonPrimary,
} from "@/components/ui/split-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { ToolbarSeparator } from "@/components/ui/toolbar-separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TitlebarPopupSearchField } from "@/components/ui/titlebar-popup-search-field";
import { PageLoading } from "@/components/ui/page-loading";
import { TextFieldPicker } from "@/components/ui/text-field-picker";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import {
  applyColorScheme,
  DARK_VARIANT_THEMES,
  LIGHT_VARIANT_THEMES,
  type ColorSchemeInput,
} from "@/screens/settings/appearance/apply-color-scheme";
import {
  type DarkThemeName,
  type LightThemeName,
  type Theme,
  type ThemeVariantName,
} from "@/styles/theme";

interface UiStateGalleryProps {
  visible: boolean;
  onClose: () => void;
}

interface StateCellProps {
  label: string;
  preview?: ControlStatePreviewValue;
  interactive?: boolean;
  children: ReactNode;
}

interface GallerySectionProps {
  title: string;
  description: string;
  children: ReactNode;
  testID: string;
}

const LIGHT_THEMES = Object.keys(LIGHT_VARIANT_THEMES) as LightThemeName[];
const DARK_THEMES = Object.keys(DARK_VARIANT_THEMES) as DarkThemeName[];
const NOOP = () => {};
const ThemedPlus = withUnistyles(Plus);
const ThemedTrash = withUnistyles(Trash2);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedSettings = withUnistyles(Settings);
const mutedIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

const THEME_LABELS: Record<ThemeVariantName, string> = {
  daylight: "Daylight",
  meadow: "Meadow",
  terracotta: "Terracotta",
  horizon: "Horizon",
  powder: "Powder",
  pastel: "Sherbet",
  dark: "Twilight",
  evergreen: "Evergreen",
  zinc: "Graphite",
  midnight: "Nightfall",
  claude: "Ember",
  ghostty: "Slate",
  cyberpunk: "Neo Tokyo",
};

const BUTTON_VARIANTS = [
  ["default", "Primary"],
  ["secondary", "Secondary"],
  ["outline", "Outline"],
  ["ghost", "Ghost"],
  ["destructive", "Destructive"],
] as const;

const TRANSIENT_STATES: ReadonlyArray<{
  label: string;
  preview?: ControlStatePreviewValue;
}> = [
  { label: "Rest" },
  { label: "Hover", preview: { hovered: true } },
  { label: "Pressed", preview: { pressed: true } },
  { label: "Focused", preview: { focused: true } },
];

const ALERT_VARIANTS: AlertVariant[] = ["default", "info", "success", "warning", "error"];
const SEGMENT_SELECTED_VALUE = "one";
const SEGMENT_AVAILABLE_VALUE = "two";
const PREVIEW_HOVER = { hovered: true } as const;
const PREVIEW_PRESSED = { pressed: true } as const;
const PREVIEW_FOCUSED = { focused: true } as const;
const PREVIEW_OPEN = { open: true } as const;
const PREVIEW_SEGMENT_AVAILABLE_HOVER = {
  hovered: true,
  targetId: SEGMENT_AVAILABLE_VALUE,
} as const;
const PREVIEW_SEGMENT_AVAILABLE_PRESSED = {
  pressed: true,
  targetId: SEGMENT_AVAILABLE_VALUE,
} as const;
const PREVIEW_SEGMENT_SELECTED_FOCUSED = {
  focused: true,
  targetId: SEGMENT_SELECTED_VALUE,
} as const;
const SELECTED_MODEL_DISPLAY = { label: "Qwen 3.8 27B" } as const;
const AUTOCOMPLETE_OPTIONS: AutocompleteOption[] = [
  { id: "open", label: "Open file", description: "Open a file by name", kind: "command" },
  { id: "src", label: "src", description: "packages/app/src", kind: "directory" },
  { id: "gallery", label: "ui-state-gallery.tsx", detail: "TSX", kind: "file" },
];
const TEXT_PICKER_OPTIONS = [
  { id: "qwen", label: "Qwen" },
  { id: "gemma", label: "Gemma" },
];

const THEME_MODE_OPTIONS: SegmentedControlOption<"light" | "dark">[] = [
  { value: "light", label: "Light", testID: "ui-state-gallery-theme-mode-light" },
  { value: "dark", label: "Dark", testID: "ui-state-gallery-theme-mode-dark" },
];

function activeTheme(
  settings: AppSettings,
  systemColorScheme: "light" | "dark" | null | undefined,
): ThemeVariantName {
  const spectrum =
    settings.colorSchemeMode === "system"
      ? (systemColorScheme ?? "dark")
      : settings.colorSchemeMode;
  return spectrum === "light" ? settings.lightTheme : settings.darkTheme;
}

type GalleryThemeSnapshot = Omit<ColorSchemeInput, "systemColorScheme">;

function stateCellA11yProps(interactive: boolean) {
  if (interactive) {
    return undefined;
  }
  return {
    accessibilityElementsHidden: true as const,
    importantForAccessibility: "no-hide-descendants" as const,
  };
}

function StateCell({ label, preview, interactive = false, children }: StateCellProps) {
  // Gallery fixtures are inert by default. Only controls whose interaction is
  // self-contained may opt in; nested menus, tooltips, and pickers must stay
  // non-interactive because this page is already inside a modal surface.
  const accessibilityProps = stateCellA11yProps(interactive);
  return (
    <View style={styles.stateCell}>
      <Text style={styles.stateLabel}>{label}</Text>
      <View
        pointerEvents={interactive ? "auto" : "none"}
        style={styles.stateCanvas}
        {...accessibilityProps}
      >
        {preview ? <ControlStatePreview {...preview}>{children}</ControlStatePreview> : children}
      </View>
    </View>
  );
}

function StateGrid({ children }: { children: ReactNode }) {
  return <View style={styles.stateGrid}>{children}</View>;
}

function GallerySection({ title, description, children, testID }: GallerySectionProps) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionDescription}>{description}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function ThemePicker({
  value,
  onChange,
  lightTheme,
  darkTheme,
}: {
  value: ThemeVariantName;
  onChange: (value: ThemeVariantName) => void;
  lightTheme: LightThemeName;
  darkTheme: DarkThemeName;
}) {
  const spectrum = value in LIGHT_VARIANT_THEMES ? "light" : "dark";
  const themeOptions: SegmentedControlOption<ThemeVariantName>[] = (
    spectrum === "light" ? LIGHT_THEMES : DARK_THEMES
  ).map((themeName) => ({
    value: themeName,
    label: THEME_LABELS[themeName],
    testID: `ui-state-gallery-theme-${themeName}`,
  }));
  const handleSpectrumChange = useCallback(
    (nextSpectrum: "light" | "dark") => {
      onChange(nextSpectrum === "light" ? lightTheme : darkTheme);
    },
    [darkTheme, lightTheme, onChange],
  );

  return (
    <View style={styles.themePicker} testID="ui-state-gallery-theme-picker">
      <SegmentedControl
        size="sm"
        options={THEME_MODE_OPTIONS}
        value={spectrum}
        onValueChange={handleSpectrumChange}
        style={styles.themeModeTabs}
        testID="ui-state-gallery-theme-mode"
      />
      <SegmentedControl
        size="sm"
        options={themeOptions}
        value={value}
        onValueChange={onChange}
        wrap
        stretch
        style={styles.themeVariantTabs}
        testID="ui-state-gallery-theme-variants"
      />
    </View>
  );
}

function SurfaceTokens() {
  return (
    <View style={styles.tokenGrid}>
      <View style={styles.tokenItem}>
        <View style={styles.tokenSurface0} />
        <Text style={styles.tokenLabel}>surface0</Text>
      </View>
      <View style={styles.tokenItem}>
        <View style={styles.tokenSurface1} />
        <Text style={styles.tokenLabel}>surface1</Text>
      </View>
      <View style={styles.tokenItem}>
        <View style={styles.tokenSurface2} />
        <Text style={styles.tokenLabel}>surface2</Text>
      </View>
      <View style={styles.tokenItem}>
        <View style={styles.tokenSurface3} />
        <Text style={styles.tokenLabel}>surface3</Text>
      </View>
      <View style={styles.tokenItem}>
        <View style={styles.tokenAccent} />
        <Text style={styles.tokenLabel}>accent</Text>
      </View>
      <View style={styles.tokenItem}>
        <View style={styles.tokenDestructive} />
        <Text style={styles.tokenLabel}>destructive</Text>
      </View>
      <View style={styles.tokenItem}>
        <View style={styles.tokenSuccess} />
        <Text style={styles.tokenLabel}>success</Text>
      </View>
      <View style={styles.tokenItem}>
        <View style={styles.tokenWarning} />
        <Text style={styles.tokenLabel}>warning</Text>
      </View>
    </View>
  );
}

function ButtonGallery() {
  return (
    <View style={styles.stack}>
      {BUTTON_VARIANTS.map(([variant, label]) => (
        <View key={variant} style={styles.variantGroup}>
          <Text style={styles.variantLabel}>{label}</Text>
          <StateGrid>
            {TRANSIENT_STATES.map((state) => (
              <StateCell key={state.label} label={state.label} preview={state.preview}>
                <Button variant={variant} size="sm" leftIcon={Plus} onPress={NOOP}>
                  {label}
                </Button>
              </StateCell>
            ))}
            <StateCell label="Disabled">
              <Button variant={variant} size="sm" leftIcon={Plus} disabled onPress={NOOP}>
                {label}
              </Button>
            </StateCell>
            <StateCell label="Loading">
              <Button variant={variant} size="sm" loading onPress={NOOP}>
                {label}
              </Button>
            </StateCell>
          </StateGrid>
        </View>
      ))}
    </View>
  );
}

function FieldsGallery() {
  const [stepperValue, setStepperValue] = useState("12");
  return (
    <View style={styles.stack}>
      <Text style={styles.variantLabel}>Text field</Text>
      <StateGrid>
        <StateCell label="Rest">
          <FormTextInput initialValue="Example value" />
        </StateCell>
        <StateCell label="Hover" preview={PREVIEW_HOVER}>
          <FormTextInput initialValue="Example value" />
        </StateCell>
        <StateCell label="Focused" preview={PREVIEW_FOCUSED}>
          <FormTextInput initialValue="Example value" />
        </StateCell>
        <StateCell label="Disabled">
          <FormTextInput initialValue="Example value" editable={false} />
        </StateCell>
        <StateCell label="Hint">
          <Field label="Repository" hint="Choose a local project.">
            <FormTextInput initialValue="otto-code" />
          </Field>
        </StateCell>
        <StateCell label="Error">
          <Field label="Repository" error="This directory is unavailable.">
            <FormTextInput initialValue="missing" />
          </Field>
        </StateCell>
      </StateGrid>
      <Text style={styles.variantLabel}>Select field trigger</Text>
      <StateGrid>
        <StateCell label="Placeholder">
          <SelectFieldTrigger placeholder="Choose a model" />
        </StateCell>
        <StateCell label="Selected">
          <SelectFieldTrigger placeholder="Choose a model" display={SELECTED_MODEL_DISPLAY} />
        </StateCell>
        <StateCell label="Hover">
          <SelectFieldTrigger
            placeholder="Choose a model"
            display={SELECTED_MODEL_DISPLAY}
            hovered
          />
        </StateCell>
        <StateCell label="Focused">
          <SelectFieldTrigger
            placeholder="Choose a model"
            display={SELECTED_MODEL_DISPLAY}
            focused
          />
        </StateCell>
        <StateCell label="Open / active">
          <SelectFieldTrigger
            placeholder="Choose a model"
            display={SELECTED_MODEL_DISPLAY}
            active
          />
        </StateCell>
        <StateCell label="Disabled">
          <SelectFieldTrigger
            placeholder="Choose a model"
            display={SELECTED_MODEL_DISPLAY}
            disabled
          />
        </StateCell>
        <StateCell label="Loading">
          <SelectFieldTrigger
            placeholder="Choose a model"
            display={SELECTED_MODEL_DISPLAY}
            loading
          />
        </StateCell>
      </StateGrid>
      <Text style={styles.variantLabel}>Numeric and range controls</Text>
      <StateGrid>
        <StateCell label="Stepper">
          <NumberStepperField
            value={stepperValue}
            onChangeText={setStepperValue}
            min={0}
            max={99}
          />
        </StateCell>
        <StateCell label="Slider 0%">
          <Slider min={0} max={100} value={0} onValueChange={NOOP} />
        </StateCell>
        <StateCell label="Slider 50%">
          <Slider min={0} max={100} value={50} onValueChange={NOOP} />
        </StateCell>
        <StateCell label="Slider 100%">
          <Slider min={0} max={100} value={100} onValueChange={NOOP} />
        </StateCell>
      </StateGrid>
    </View>
  );
}

const SEGMENT_OPTIONS = [
  { value: "one", label: "Selected" },
  { value: "two", label: "Available" },
];
const SEGMENT_OPTIONS_DISABLED = [
  { value: "one", label: "Selected" },
  { value: "two", label: "Disabled", disabled: true },
];

function SelectionGallery() {
  const [liveSwitch, setLiveSwitch] = useState(false);
  const [liveSegment, setLiveSegment] = useState(SEGMENT_SELECTED_VALUE);
  return (
    <View style={styles.stack}>
      <Text style={styles.variantLabel}>Switch</Text>
      <StateGrid>
        <StateCell label="Live" interactive>
          <Switch
            value={liveSwitch}
            onValueChange={setLiveSwitch}
            accessibilityLabel="Live switch"
          />
        </StateCell>
        <StateCell label="Off">
          <Switch value={false} onValueChange={NOOP} />
        </StateCell>
        <StateCell label="On">
          <Switch value onValueChange={NOOP} />
        </StateCell>
        <StateCell label="Off disabled">
          <Switch value={false} disabled />
        </StateCell>
        <StateCell label="On disabled">
          <Switch value disabled />
        </StateCell>
      </StateGrid>
      <Text style={styles.variantLabel}>Segmented control</Text>
      <StateGrid>
        <StateCell label="Live" interactive>
          <SegmentedControl
            size="sm"
            value={liveSegment}
            options={SEGMENT_OPTIONS}
            onValueChange={setLiveSegment}
          />
        </StateCell>
        <StateCell label="Selected">
          <SegmentedControl
            size="sm"
            value={SEGMENT_SELECTED_VALUE}
            options={SEGMENT_OPTIONS}
            onValueChange={NOOP}
          />
        </StateCell>
        <StateCell label="Hover available" preview={PREVIEW_SEGMENT_AVAILABLE_HOVER}>
          <SegmentedControl
            size="sm"
            value={SEGMENT_SELECTED_VALUE}
            options={SEGMENT_OPTIONS}
            onValueChange={NOOP}
          />
        </StateCell>
        <StateCell label="Pressed available" preview={PREVIEW_SEGMENT_AVAILABLE_PRESSED}>
          <SegmentedControl
            size="sm"
            value={SEGMENT_SELECTED_VALUE}
            options={SEGMENT_OPTIONS}
            onValueChange={NOOP}
          />
        </StateCell>
        <StateCell label="Focused selected" preview={PREVIEW_SEGMENT_SELECTED_FOCUSED}>
          <SegmentedControl
            size="sm"
            value={SEGMENT_SELECTED_VALUE}
            options={SEGMENT_OPTIONS}
            onValueChange={NOOP}
          />
        </StateCell>
        <StateCell label="Disabled">
          <SegmentedControl
            size="sm"
            value={SEGMENT_SELECTED_VALUE}
            options={SEGMENT_OPTIONS_DISABLED}
            onValueChange={NOOP}
          />
        </StateCell>
      </StateGrid>
    </View>
  );
}

function ToolbarGallery() {
  const toolbarButton = (props: Partial<Parameters<typeof ToolbarIconButton>[0]> = {}) => (
    <ToolbarIconButton label="Add" Icon={ThemedPlus} onPress={NOOP} {...props} />
  );
  return (
    <StateGrid>
      <StateCell label="Rest">{toolbarButton()}</StateCell>
      <StateCell label="Hover" preview={PREVIEW_HOVER}>
        {toolbarButton()}
      </StateCell>
      <StateCell label="Pressed" preview={PREVIEW_PRESSED}>
        {toolbarButton()}
      </StateCell>
      <StateCell label="Focused" preview={PREVIEW_FOCUSED}>
        {toolbarButton()}
      </StateCell>
      <StateCell label="Selected">{toolbarButton({ selected: true })}</StateCell>
      <StateCell label="Disabled">{toolbarButton({ disabled: true })}</StateCell>
      <StateCell label="Loading">{toolbarButton({ loading: true })}</StateCell>
      <StateCell label="Accent">{toolbarButton({ tone: "accent" })}</StateCell>
      <StateCell label="Destructive">
        {toolbarButton({ tone: "destructive", Icon: ThemedTrash })}
      </StateCell>
      <StateCell label="Grouped toolbar">
        <View style={styles.toolbarGroup}>
          {toolbarButton()}
          <ToolbarSeparator />
          {toolbarButton({ tone: "accent" })}
        </View>
      </StateCell>
    </StateGrid>
  );
}

function SplitButtonExample({
  primaryPreview,
  menuPreview,
}: {
  primaryPreview?: ControlStatePreviewValue;
  menuPreview?: ControlStatePreviewValue;
}) {
  const primary = (
    <SplitButtonPrimary style={styles.splitPrimary} onPress={NOOP}>
      <Text style={styles.splitLabel}>Open project</Text>
    </SplitButtonPrimary>
  );
  const menu = (
    <SplitButtonMenuTrigger style={styles.splitMenu}>
      <ThemedChevronDown uniProps={mutedIconMapping} />
    </SplitButtonMenuTrigger>
  );
  return (
    <DropdownMenu>
      <SplitButton filled>
        {primaryPreview ? (
          <ControlStatePreview {...primaryPreview}>{primary}</ControlStatePreview>
        ) : (
          primary
        )}
        {menuPreview ? <ControlStatePreview {...menuPreview}>{menu}</ControlStatePreview> : menu}
      </SplitButton>
    </DropdownMenu>
  );
}

function MenusGallery() {
  return (
    <View style={styles.stack}>
      <Text style={styles.variantLabel}>Split button</Text>
      <StateGrid>
        <StateCell label="Rest">
          <SplitButtonExample />
        </StateCell>
        <StateCell label="Primary hover">
          <SplitButtonExample primaryPreview={PREVIEW_HOVER} />
        </StateCell>
        <StateCell label="Primary pressed">
          <SplitButtonExample primaryPreview={PREVIEW_PRESSED} />
        </StateCell>
        <StateCell label="Menu focused">
          <SplitButtonExample menuPreview={PREVIEW_FOCUSED} />
        </StateCell>
        <StateCell label="Menu open">
          <SplitButtonExample menuPreview={PREVIEW_OPEN} />
        </StateCell>
      </StateGrid>
      <Text style={styles.variantLabel}>Menu items</Text>
      <StateGrid>
        <StateCell label="Rest">
          <InlineMenuItem>Open</InlineMenuItem>
        </StateCell>
        <StateCell label="Hover" preview={PREVIEW_HOVER}>
          <InlineMenuItem>Open</InlineMenuItem>
        </StateCell>
        <StateCell label="Pressed" preview={PREVIEW_PRESSED}>
          <InlineMenuItem>Open</InlineMenuItem>
        </StateCell>
        <StateCell label="Selected">
          <InlineMenuItem selected>Current theme</InlineMenuItem>
        </StateCell>
        <StateCell label="Disabled">
          <InlineMenuItem disabled>Unavailable</InlineMenuItem>
        </StateCell>
        <StateCell label="Destructive">
          <InlineMenuItem destructive>Delete permanently</InlineMenuItem>
        </StateCell>
        <StateCell label="Pending">
          <InlineMenuItem status="pending" pendingLabel="Saving…">
            Save
          </InlineMenuItem>
        </StateCell>
        <StateCell label="Success">
          <InlineMenuItem status="success" successLabel="Saved">
            Save
          </InlineMenuItem>
        </StateCell>
      </StateGrid>
      <Text style={styles.variantLabel}>Live overlays</Text>
      <StateGrid>
        <StateCell label="Dropdown (static)">
          <DropdownMenu>
            <DropdownMenuTrigger style={styles.liveOverlayTrigger}>
              <Text style={styles.liveOverlayText}>Open menu</Text>
              <ThemedChevronDown uniProps={mutedIconMapping} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="start" width={220}>
              <DropdownMenuItem selected>Selected item</DropdownMenuItem>
              <DropdownMenuItem>Available item</DropdownMenuItem>
              <DropdownMenuItem destructive>Destructive item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </StateCell>
        <StateCell label="Tooltip (static)">
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" onPress={NOOP}>
                Hover me
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>Production tooltip</Text>
            </TooltipContent>
          </Tooltip>
        </StateCell>
      </StateGrid>
    </View>
  );
}

function InlineMenuItem(props: Parameters<typeof DropdownMenuItem>[0]) {
  return (
    <DropdownMenu>
      <View style={styles.inlineMenuSurface}>
        <DropdownMenuItem closeOnSelect={false} {...props} />
      </View>
    </DropdownMenu>
  );
}

function FeedbackGallery() {
  return (
    <View style={styles.stack}>
      <Text style={styles.variantLabel}>Status badges</Text>
      <StateGrid>
        <StateCell label="Muted">
          <StatusBadge label="Idle" />
        </StateCell>
        <StateCell label="Success">
          <StatusBadge label="Ready" variant="success" />
        </StateCell>
        <StateCell label="Warning">
          <StatusBadge label="Attention" variant="warning" />
        </StateCell>
        <StateCell label="Error">
          <StatusBadge label="Failed" variant="error" />
        </StateCell>
      </StateGrid>
      <Text style={styles.variantLabel}>Alerts</Text>
      <StateGrid>
        {ALERT_VARIANTS.map((variant) => (
          <StateCell key={variant} label={variant}>
            <Alert
              variant={variant}
              title={`${variant[0]?.toUpperCase()}${variant.slice(1)}`}
              description="A concise description of this state."
            />
          </StateCell>
        ))}
      </StateGrid>
      <Text style={styles.variantLabel}>Progress and keyboard</Text>
      <StateGrid>
        <StateCell label="Spinner small">
          <LoadingSpinner size="small" />
        </StateCell>
        <StateCell label="Spinner large">
          <LoadingSpinner size="large" />
        </StateCell>
        <StateCell label="Shortcut">
          <Shortcut keys={["mod", "shift", "p"]} />
        </StateCell>
        <StateCell label="Chord">
          <Shortcut
            chord={[
              ["mod", "k"],
              ["mod", "s"],
            ]}
          />
        </StateCell>
      </StateGrid>
    </View>
  );
}

function ContentGallery() {
  const [searchValue, setSearchValue] = useState("theme");
  const [color, setColor] = useState("#6d7ed8");
  const [pickerValue, setPickerValue] = useState("qwen");
  return (
    <View style={styles.stack}>
      <Text style={styles.variantLabel}>Search and suggestions</Text>
      <StateGrid>
        <StateCell label="Title-bar search" interactive>
          <View style={styles.searchFixture}>
            <TitlebarPopupSearchField
              value={searchValue}
              onChangeText={setSearchValue}
              placeholder="Search people"
              accessibilityLabel="Search people"
            />
          </View>
        </StateCell>
        <StateCell label="Autocomplete">
          <Autocomplete
            options={AUTOCOMPLETE_OPTIONS}
            selectedIndex={1}
            onSelect={NOOP}
            maxHeight={150}
          />
        </StateCell>
        <StateCell label="Autocomplete loading">
          <Autocomplete
            options={AUTOCOMPLETE_OPTIONS}
            selectedIndex={-1}
            onSelect={NOOP}
            isLoading
            maxHeight={150}
          />
        </StateCell>
        <StateCell label="Autocomplete empty">
          <Autocomplete
            options={[]}
            selectedIndex={-1}
            onSelect={NOOP}
            emptyText="No matching commands"
            maxHeight={150}
          />
        </StateCell>
        <StateCell label="Editable picker (static)">
          <TextFieldPicker
            value={pickerValue}
            onChange={setPickerValue}
            options={TEXT_PICKER_OPTIONS}
            placeholder="Choose or type a model"
          />
        </StateCell>
      </StateGrid>
      <Text style={styles.variantLabel}>Combobox rows</Text>
      <StateGrid>
        <StateCell label="Rest">
          <View style={styles.comboboxSurface}>
            <ComboboxItem label="Available model" onPress={NOOP} />
          </View>
        </StateCell>
        <StateCell label="Hover" preview={PREVIEW_HOVER}>
          <View style={styles.comboboxSurface}>
            <ComboboxItem label="Available model" onPress={NOOP} />
          </View>
        </StateCell>
        <StateCell label="Pressed" preview={PREVIEW_PRESSED}>
          <View style={styles.comboboxSurface}>
            <ComboboxItem label="Available model" onPress={NOOP} />
          </View>
        </StateCell>
        <StateCell label="Active">
          <View style={styles.comboboxSurface}>
            <ComboboxItem label="Active model" active onPress={NOOP} />
          </View>
        </StateCell>
        <StateCell label="Selected">
          <View style={styles.comboboxSurface}>
            <ComboboxItem label="Selected model" selected onPress={NOOP} />
          </View>
        </StateCell>
        <StateCell label="Disabled">
          <View style={styles.comboboxSurface}>
            <ComboboxItem label="Unavailable model" disabled onPress={NOOP} />
          </View>
        </StateCell>
      </StateGrid>
      <Text style={styles.variantLabel}>Content surfaces</Text>
      <StateGrid>
        <StateCell label="Code surface">
          <ScrollableCodeSurface maxHeight={100}>
            {"const theme = 'daylight';\nreturn audit(theme);"}
          </ScrollableCodeSurface>
        </StateCell>
        <StateCell label="Page loading">
          <View style={styles.pageLoadingFixture}>
            <PageLoading label="Loading project…" />
          </View>
        </StateCell>
        <StateCell label="External link">
          <ExternalLink
            href="https://otto-code.me"
            label="Documentation"
            tooltip="Open the Otto documentation"
          />
        </StateCell>
        <StateCell label="Color picker" interactive>
          <ColorWheelPicker value={color} onChange={setColor} size={150} />
        </StateCell>
      </StateGrid>
    </View>
  );
}

function sectionMatches(query: string, ...terms: string[]): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLocaleLowerCase();
  return terms.some((term) => term.toLocaleLowerCase().includes(needle));
}

export function UiStateGallery({ visible, onClose }: UiStateGalleryProps) {
  const { settings } = useAppSettings();
  const systemColorScheme = useColorScheme();
  const originalInputRef = useRef<GalleryThemeSnapshot | null>(null);
  const latestSystemColorSchemeRef = useRef(systemColorScheme);
  const [themeName, setThemeName] = useState<ThemeVariantName>(() =>
    activeTheme(settings, systemColorScheme),
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    latestSystemColorSchemeRef.current = systemColorScheme;
  }, [systemColorScheme]);

  const restoreTheme = useCallback(() => {
    const original = originalInputRef.current;
    if (!original) return;
    originalInputRef.current = null;
    applyColorScheme({ ...original, systemColorScheme: latestSystemColorSchemeRef.current });
  }, []);

  useEffect(() => {
    if (!visible) {
      restoreTheme();
      return;
    }
    if (!originalInputRef.current) {
      originalInputRef.current = {
        colorSchemeMode: settings.colorSchemeMode,
        lightTheme: settings.lightTheme,
        darkTheme: settings.darkTheme,
        fontContrast: settings.fontContrast,
      };
      setThemeName(activeTheme(settings, systemColorScheme));
      setQuery("");
    }
  }, [restoreTheme, settings, systemColorScheme, visible]);

  useEffect(() => () => restoreTheme(), [restoreTheme]);

  const handleThemeChange = useCallback(
    (nextTheme: ThemeVariantName) => {
      setThemeName(nextTheme);
      const isLight = nextTheme in LIGHT_VARIANT_THEMES;
      applyColorScheme({
        colorSchemeMode: isLight ? "light" : "dark",
        lightTheme: isLight ? (nextTheme as LightThemeName) : settings.lightTheme,
        darkTheme: isLight ? settings.darkTheme : (nextTheme as DarkThemeName),
        systemColorScheme,
        fontContrast: settings.fontContrast,
      });
    },
    [settings.darkTheme, settings.fontContrast, settings.lightTheme, systemColorScheme],
  );

  const handleClose = useCallback(() => {
    restoreTheme();
    onClose();
  }, [onClose, restoreTheme]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: "UI Gallery",
      subtitle: "Production components in deterministic states. Theme previews are temporary.",
      search: {
        onChange: setQuery,
        resetKey: visible ? "visible" : "hidden",
        placeholder: "Filter components and states",
        testID: "ui-state-gallery-search",
      },
    }),
    [visible],
  );
  const themePicker = useMemo(
    () => (
      <ThemePicker
        value={themeName}
        lightTheme={settings.lightTheme}
        darkTheme={settings.darkTheme}
        onChange={handleThemeChange}
      />
    ),
    [handleThemeChange, settings.darkTheme, settings.lightTheme, themeName],
  );

  const anySectionVisible = [
    sectionMatches(query, "theme surfaces colors tokens palette"),
    sectionMatches(
      query,
      "buttons primary secondary outline ghost destructive loading disabled focus hover pressed",
    ),
    sectionMatches(query, "fields input text select numeric stepper slider validation error hint"),
    sectionMatches(query, "selection switch segmented toggle checked selected disabled"),
    sectionMatches(query, "toolbar icon actions selected loading disabled tones"),
    sectionMatches(query, "menus dropdown tooltip split button overlays items open"),
    sectionMatches(query, "feedback status badges alerts progress spinner shortcut keyboard"),
    sectionMatches(
      query,
      "content search autocomplete suggestions combobox code loading external link color picker",
    ),
  ].some(Boolean);

  return (
    <AdaptiveModalSheet
      header={header}
      subHeader={themePicker}
      visible={visible}
      onClose={handleClose}
      desktopMaxWidth={1320}
      desktopHeight={800}
      snapPoints={["96%"]}
      scrollable
      webScrollbar
      testID="ui-state-gallery"
    >
      {sectionMatches(query, "theme surfaces colors tokens palette") ? (
        <GallerySection
          title="Theme surfaces"
          description="The semantic canvas and action colors every component is sitting on."
          testID="ui-state-gallery-theme-surfaces"
        >
          <SurfaceTokens />
        </GallerySection>
      ) : null}
      {sectionMatches(
        query,
        "buttons primary secondary outline ghost destructive loading disabled focus hover pressed",
      ) ? (
        <GallerySection
          title="Buttons"
          description="Every shared button variant through live, transient, unavailable, and busy states."
          testID="ui-state-gallery-buttons"
        >
          <ButtonGallery />
        </GallerySection>
      ) : null}
      {sectionMatches(
        query,
        "fields input text select numeric stepper slider validation error hint",
      ) ? (
        <GallerySection
          title="Fields and range controls"
          description="Text chrome, validation, select triggers, steppers, and sliders."
          testID="ui-state-gallery-fields"
        >
          <FieldsGallery />
        </GallerySection>
      ) : null}
      {sectionMatches(query, "selection switch segmented toggle checked selected disabled") ? (
        <GallerySection
          title="Selection controls"
          description="Boolean and mutually exclusive selection, including interactive live examples."
          testID="ui-state-gallery-selection"
        >
          <SelectionGallery />
        </GallerySection>
      ) : null}
      {sectionMatches(query, "toolbar icon actions selected loading disabled tones") ? (
        <GallerySection
          title="Toolbar actions"
          description="Compact icon-only controls and their semantic tones."
          testID="ui-state-gallery-toolbar"
        >
          <ToolbarGallery />
        </GallerySection>
      ) : null}
      {sectionMatches(query, "menus dropdown tooltip split button overlays items open") ? (
        <GallerySection
          title="Menus and overlays"
          description="Split controls, menu rows, and live portal-based overlays."
          testID="ui-state-gallery-menus"
        >
          <MenusGallery />
        </GallerySection>
      ) : null}
      {sectionMatches(query, "feedback status badges alerts progress spinner shortcut keyboard") ? (
        <GallerySection
          title="Feedback and status"
          description="Semantic feedback, progress, and keyboard affordances."
          testID="ui-state-gallery-feedback"
        >
          <FeedbackGallery />
        </GallerySection>
      ) : null}
      {sectionMatches(
        query,
        "content search autocomplete suggestions combobox code loading external link color picker",
      ) ? (
        <GallerySection
          title="Content and discovery"
          description="Search, suggestions, option rows, code surfaces, loading, links, and color input."
          testID="ui-state-gallery-content"
        >
          <ContentGallery />
        </GallerySection>
      ) : null}
      {!anySectionVisible ? (
        <View style={styles.emptyState}>
          <ThemedSettings uniProps={mutedIconMapping} />
          <Text style={styles.emptyTitle}>No gallery sections match “{query}”.</Text>
          <Text style={styles.emptyHint}>
            Try a component name or state such as button, focused, menu, or error.
          </Text>
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  sectionHeading: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  sectionDescription: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  sectionBody: { padding: theme.spacing[4], gap: theme.spacing[4] },
  stack: { gap: theme.spacing[4] },
  variantGroup: { gap: theme.spacing[2] },
  variantLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  stateGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  stateCell: {
    flexGrow: 1,
    flexBasis: 168,
    minWidth: 150,
    maxWidth: 240,
    gap: theme.spacing[2],
  },
  stateLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  stateCanvas: {
    minHeight: 76,
    padding: theme.spacing[3],
    justifyContent: "center",
    alignItems: "center",
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  themePicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface1,
  },
  themeModeTabs: { flexShrink: 0 },
  themeVariantTabs: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  tokenGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  tokenItem: { width: 108, gap: theme.spacing[1] },
  tokenLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  tokenSurface0: {
    height: 44,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  tokenSurface1: {
    height: 44,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  tokenSurface2: {
    height: 44,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  tokenSurface3: {
    height: 44,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
  },
  tokenAccent: {
    height: 44,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.accent,
  },
  tokenDestructive: {
    height: 44,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.destructive,
  },
  tokenSuccess: {
    height: 44,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.success,
  },
  tokenWarning: {
    height: 44,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.statusWarning,
  },
  splitPrimary: { minHeight: 34, paddingHorizontal: theme.spacing[3], justifyContent: "center" },
  splitMenu: { width: 34, minHeight: 34, alignItems: "center", justifyContent: "center" },
  splitLabel: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  inlineMenuSurface: {
    minWidth: 190,
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.popover,
  },
  liveOverlayTrigger: {
    minHeight: 34,
    paddingHorizontal: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
  },
  liveOverlayText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  tooltipText: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm },
  toolbarGroup: { flexDirection: "row", alignItems: "stretch" },
  searchFixture: { minWidth: 210, backgroundColor: theme.colors.surface0 },
  comboboxSurface: {
    minWidth: 190,
    overflow: "hidden",
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  pageLoadingFixture: {
    width: "100%",
    minHeight: 92,
    overflow: "hidden",
    borderRadius: theme.borderRadius.lg,
  },
  emptyState: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[8],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  emptyHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
