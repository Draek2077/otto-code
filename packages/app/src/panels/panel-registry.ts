import type { ComponentType } from "react";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface PanelIconProps {
  size: number;
  color: string;
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
}

export interface PanelDescriptorContext {
  serverId: string;
  workspaceId: string;
  tabId: string;
}

export interface PanelRegistration<
  K extends WorkspaceTabTarget["kind"] = WorkspaceTabTarget["kind"],
> {
  kind: K;
  component: ComponentType;
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
