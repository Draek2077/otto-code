/**
 * The identity line on the left of the Knowledge document header.
 *
 * The header is a fixed-height pane toolbar shared with the mode toggle and the
 * document actions, so the identity gets whatever horizontal space those leave.
 * Rather than let the line clip mid-word, it sheds in a fixed order: the date
 * goes first, the type second, and the name is the last thing standing.
 */
export interface KnowledgeDocumentIdentity {
  /** Never dropped. At the narrowest tier it is all that survives, ellipsized. */
  name: string;
  /** What kind of document this is, plus its status detail. Dropped second. */
  type?: string;
  /** When the document last changed. Dropped first. */
  date?: string;
}

export interface KnowledgeDocumentIdentityLayout {
  showType: boolean;
  showDate: boolean;
}

// Container widths, not device breakpoints, following the File Editor status
// bar: this header is just as narrow in a desktop three-way split as it is on a
// phone, and it has to budget against the space it actually receives.
//
// The numbers are the width at which the next segment stops paying for itself:
// a type reads as "Requirement · Confirmed" and a date as "Updated 9/5/2026",
// and below these the name would be ellipsized down to a few characters to make
// room for metadata that means less than the name does.
const TYPE_WIDTH = 260;
const DATE_WIDTH = 400;

/**
 * Zero is the pre-measurement state and deliberately takes the narrowest tier,
 * so the first frame never overflows before `onLayout` arrives.
 */
export function resolveKnowledgeDocumentIdentityLayout(
  width: number,
): KnowledgeDocumentIdentityLayout {
  if (width < TYPE_WIDTH) return { showType: false, showDate: false };
  if (width < DATE_WIDTH) return { showType: true, showDate: false };
  return { showType: true, showDate: true };
}
