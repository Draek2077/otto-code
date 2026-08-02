export type AgentTabTitleState = "ready" | "loading";

export interface AgentTabTitle {
  label: string;
  titleState: AgentTabTitleState;
}

/**
 * A tab always has a name.
 *
 * `loading` is a state, never a placeholder: it means a load is genuinely in
 * flight, which for an agent tab is the window before its record has reached the
 * store. Once the record is here, whatever name it carries is the name we show,
 * and a record with no name at all falls back to the base label rather than
 * rendering an empty skeleton forever.
 *
 * This deliberately diverges from upstream Paseo, which blanked out the "New
 * chat" / "New agent" placeholders and reported `loading` in their place. That
 * reads as a permanent shimmer whenever auto-naming is off, fails, or never runs
 * — a chat genuinely named "New chat" is named, so it renders as such and is
 * replaced in place when a generated title lands.
 */
export function resolveAgentTabTitle(input: {
  title: string | null | undefined;
  isHydrated: boolean;
  fallbackLabel: string;
}): AgentTabTitle {
  const named = typeof input.title === "string" ? input.title.trim() : "";
  if (named) {
    return { label: named, titleState: "ready" };
  }
  // Never leave the label empty, even mid-load: the skeleton covers the text but
  // the tooltip and accessibility label still read from it.
  return { label: input.fallbackLabel, titleState: input.isHydrated ? "ready" : "loading" };
}
