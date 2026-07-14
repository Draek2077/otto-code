// Shared neutral role glyphs for personality roles. Keyed exhaustively by
// PersonalityRole so adding a role forces a choice here (typecheck fails
// otherwise). These are deliberately distinct from the app's functional icons
// (schedules, artifacts, search, git, etc.) so a role glyph reads as "you are
// picking a ROLE" — most importantly on the synthetic "Team's <Role>" picker
// entry, whose holder changes with the active team and so must NOT wear any one
// personality's colored provider glyph. See buildTeamRoleEntry.
import type { PersonalityRole } from "@otto-code/protocol/messages";
import {
  Assignment,
  CalendarMonth,
  DataObject,
  DesignServices,
  EditNote,
  Forum,
  Gavel,
  Handyman,
  type IconComponent,
  Lightbulb,
  Schema,
  TravelExplore,
} from "@/components/icons/material-icons";

export const ROLE_ICONS: Record<PersonalityRole, IconComponent> = {
  // Surfaces
  chatter: Forum, // conversation
  artificer: Handyman, // crafts/builds artifacts
  scheduler: CalendarMonth, // calendar (distinct from the schedules feature's clock)
  // Thinking workers
  researcher: TravelExplore, // surveys/explores
  planner: Assignment, // a drafted, sequenced plan
  judger: Gavel, // renders a verdict
  advisor: Lightbulb, // a recommendation
  // Making workers
  coder: DataObject, // code (distinct from the Github/code-blocks glyphs)
  designer: DesignServices, // design tooling
  writer: EditNote, // writing text
  // Conductor
  orchestrator: Schema, // directs a connected team
};
