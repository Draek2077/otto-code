import type { IconSizeProp } from "@/components/icons/icon-size";
import type { ComponentType } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { getPanelManifest, type PanelManifest } from "@/panels/panel-manifest";
export type { PaneHost } from "@/panels/panel-manifest";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface PanelIconProps {
  // Otto's icons take a size token as well as a raw number (see
  // components/icons/icon-size). Narrowing this to `number` makes every
  // token-taking icon - the provider glyphs on agent tabs among them -
  // unassignable to a panel icon slot.
  // Optional, matching Otto's icon convention: an icon given no size or colour
  // draws at its own default rather than refusing to render. Required here, the
  // React.ComponentClass branch makes props invariant and every Otto icon
  // becomes unassignable.
  size?: IconSizeProp;
  color?: string;
  strokeWidth?: number;
}

export interface PanelDescriptor {
  label: string;
  subtitle: string;
  tooltip: string;
  titleState: "ready" | "loading";
  icon: ComponentType<PanelIconProps>;
  statusBucket: SidebarStateBucket | null;
  /**
   * Personality spinner colors for this tab's busy loader, when the agent was
   * spawned from a personality. Absent/null ⇒ the tab uses the theme spinner.
   * Only the agent panel sets this; other panels leave it undefined.
   */
  personalitySpinner?: { glowA: string; glowB: string } | null;
  /**
   * Provider id for the tab glyph. Lets the non-loading agent tab fill its
   * provider icon with the personality gradient (paired with personalitySpinner).
   * Only the agent panel sets this.
   */
  provider?: string;
  /**
   * Which busy glyph the tab shows while `statusBucket` is "running". The blob
   * loader reads as "a model is thinking", so it is reserved for AI work;
   * panels whose work is plain I/O (a page load, a fetch) pass "spinner" for
   * the theme's circular indicator. Absent ⇒ "blob".
   */
  busyLoader?: "blob" | "spinner";
}

export interface PanelDescriptorContext {
  serverId: string;
  workspaceId: string;
  tabId: string;
}

export interface PanelPresentation {
  label: (t: TFunction) => string;
  subtitle: (t: TFunction) => string;
  tooltip: (t: TFunction) => string;
  icon: ComponentType<PanelIconProps>;
}

export interface PanelRegistration<
  K extends WorkspaceTabTarget["kind"] = WorkspaceTabTarget["kind"],
> extends PanelManifest<K> {
  component: ComponentType;
  presentation?: PanelPresentation;
  useDescriptor(
    target: Extract<WorkspaceTabTarget, { kind: K }>,
    context: PanelDescriptorContext,
  ): PanelDescriptor;
  /**
   * Job tabs (rename, refine, artifact) hold work that closing would discard.
   * Resolve false to keep the tab open. Panels without unsaved state omit this.
   */
  confirmClose?(
    target: Extract<WorkspaceTabTarget, { kind: K }>,
    context: PanelDescriptorContext,
  ): Promise<boolean>;
}

type PanelImplementation<K extends WorkspaceTabTarget["kind"]> = {
  confirmClose?: PanelRegistration<K>["confirmClose"];
} & (
  | {
      component: ComponentType;
      presentation: PanelPresentation;
      useDescriptor?: PanelRegistration<K>["useDescriptor"];
    }
  | {
      component: ComponentType;
      presentation?: never;
      useDescriptor: PanelRegistration<K>["useDescriptor"];
    }
);

function createStaticDescriptorHook(presentation: PanelPresentation) {
  return function useStaticPanelDescriptor(): PanelDescriptor {
    const { t } = useTranslation();
    return {
      label: presentation.label(t),
      subtitle: presentation.subtitle(t),
      tooltip: presentation.tooltip(t),
      titleState: "ready",
      icon: presentation.icon,
      statusBucket: null,
    };
  };
}

export function definePanel<K extends WorkspaceTabTarget["kind"]>(
  kind: K,
  implementation: PanelImplementation<K>,
): PanelRegistration<K> {
  let useDescriptor = implementation.useDescriptor;
  if (!useDescriptor) {
    invariant(implementation.presentation, `Panel ${kind} requires a presentation`);
    useDescriptor = createStaticDescriptorHook(implementation.presentation);
  }
  return {
    ...getPanelManifest(kind),
    component: implementation.component,
    presentation: implementation.presentation,
    useDescriptor,
    ...(implementation.confirmClose ? { confirmClose: implementation.confirmClose } : {}),
  };
}

const panelRegistry = new Map<WorkspaceTabTarget["kind"], PanelRegistration>();

export function registerPanel<K extends WorkspaceTabTarget["kind"]>(
  registration: PanelRegistration<K>,
): void {
  panelRegistry.set(registration.kind, registration as unknown as PanelRegistration);
}

export function getPanelRegistration(
  kind: WorkspaceTabTarget["kind"],
): PanelRegistration | undefined {
  return panelRegistry.get(kind);
}
