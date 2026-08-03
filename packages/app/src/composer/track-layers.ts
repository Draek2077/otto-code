/**
 * Paint layers for the fanned cards above the message box, back (lowest) to
 * front. Ascending order matches the cards' document order, so the static look
 * is exactly what plain source order already gives — what these pin is the
 * ordering DURING motion.
 *
 * Every card enters by growing out of a zero-height box and leaves by
 * collapsing back into one (composer/track-transition.web.tsx). Its content
 * overflows that box while it moves, so a card mid-collapse is drawn across the
 * message box's space. The composer owns the top layer so the card passes
 * BEHIND it and reads as sliding back into the message box, rather than
 * scribbling over the input on its way out.
 */
export const COMPOSER_TRACK_LAYERS = {
  contextHealth: 1,
  rateLimit: 2,
  subagents: 3,
  backgroundTasks: 4,
  composer: 5,
} as const;
