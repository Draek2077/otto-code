/**
 * Agent profiles: named bundles of composer settings (provider, model, mode,
 * thinking option, feature values, notes) stored host-wide in daemon config.
 *
 * Three capabilities leave this module — reading the roster, pinning it to the
 * model picker, and drawing a profile's glyph. Everything else (the form model,
 * the catalog and feature probes, the materialization rules, the icon registry)
 * is internal; import from `@/agent-profiles`, never a path inside it.
 *
 * The roster is EDITED by the host settings "Agent profiles" section, which is
 * the one editor since the two stored-template systems converged. This module
 * deliberately exports no settings UI: it is imported by the composer, and a
 * settings screen in that module graph is dead weight on the hot path. The one
 * piece the editor shares, `settings/agent-profile-appearance-field`, is
 * imported by its own path for exactly that reason - routing it through this
 * barrel would pull a Combobox into every composer.
 *
 * `useAgentProfilePicker` deliberately hands the picker a flat row view model
 * and one `applyProfile(id)` callback rather than the profiles themselves: what
 * a profile contains, and how it reaches a live agent versus a draft, stays in
 * here.
 */
export type { AgentProfile } from "@otto-code/protocol/messages";
export type { MaterializedAgentProfile } from "./internal/materialize-profile";
export type { AgentProfileSeed } from "./internal/profile-form-model";
export { useAgentProfileEditor, type AgentProfileEditorControls } from "./agent-profile-editor";
export { useAgentProfiles } from "./internal/use-agent-profiles";
export {
  useAgentProfilePicker,
  type AgentProfileApplyTarget,
  type AgentProfilePicker,
  type AgentProfilePickerRow,
  type DraftAgentProfileControls,
} from "./internal/use-agent-profile-picker";
export { AgentProfileGlyph } from "./internal/agent-profile-glyph";
