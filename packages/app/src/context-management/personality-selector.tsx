import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { ScopeSelect } from "./scope-select";
import type { AgentPersonality } from "@otto-code/protocol/messages";

/**
 * "Viewing context for: …" — the selector that makes this tab honest now that
 * personalities carry their own memory.
 *
 * Context used to be a property of a workspace and a provider alone. It is not
 * any more: two personalities in the same workspace send different things,
 * because each brings the lessons it has accrued. A single set of numbers with no
 * identity attached would be a number for nobody.
 *
 * "Everyone" is a real, selectable answer, not a null state: it reports the
 * weight every agent here carries regardless of who runs, which is exactly what
 * you want when you are hunting bloat in the project's own files.
 *
 * Rendered as the same dropdown as the window picker beside it, on purpose —
 * both answer "what am I evaluating against", and a roster that grows every time
 * someone names a personality is exactly the list that must not be a chip row.
 */

/** Above this many, scanning the list stops being faster than typing a name. */
const SEARCHABLE_ROSTER_SIZE = 8;

/** Not a personality id — "Everyone" is a selection, so it needs one of its own. */
const EVERYONE_ID = "everyone";

interface ContextPersonalitySelectorProps {
  personalities: readonly AgentPersonality[];
  /** null = "Everyone": the personality-agnostic report. */
  selectedId: string | null;
  /** Lesson counts by personality id, for the accrual count. */
  memoryCounts: Record<string, number>;
  onSelect: (personalityId: string | null) => void;
}

export function ContextPersonalitySelector({
  personalities,
  selectedId,
  memoryCounts,
  onSelect,
}: ContextPersonalitySelectorProps): ReactElement | null {
  const { t } = useTranslation();
  const everyoneLabel = t("contextManagement.personalitySelector.everyone");

  const options = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: EVERYONE_ID,
        value: EVERYONE_ID,
        label: everyoneLabel,
        testID: `context-personality-${EVERYONE_ID}`,
      },
      ...personalities.map((personality) => {
        const lessonCount = memoryCounts[personality.id] ?? 0;
        return {
          id: personality.id,
          value: personality.id,
          label: personality.name,
          // A count, not a dot: "12 lessons" is what makes the weight below
          // believable, and it is also what makes deleting this personality
          // feel like a decision.
          description:
            lessonCount > 0
              ? t("contextManagement.personalitySelector.lessons", { count: lessonCount })
              : undefined,
          testID: `context-personality-${personality.id}`,
        };
      }),
    ],
    [everyoneLabel, memoryCounts, personalities, t],
  );

  const handleSelect = useCallback(
    (id: string) => onSelect(id === EVERYONE_ID ? null : id),
    [onSelect],
  );

  // A host with no personalities has nothing to choose between, and a selector
  // whose only answer is "Everyone" is a dead control.
  if (personalities.length === 0) {
    return null;
  }

  const selectedName = personalities.find((personality) => personality.id === selectedId)?.name;

  return (
    <ScopeSelect
      label={t("contextManagement.personalitySelector.label")}
      value={selectedId ?? EVERYONE_ID}
      displayLabel={selectedName ?? everyoneLabel}
      options={options}
      onSelect={handleSelect}
      searchable={personalities.length >= SEARCHABLE_ROSTER_SIZE}
      searchPlaceholder={t("contextManagement.personalitySelector.searchPlaceholder")}
      testID="context-personality-selector"
    />
  );
}
