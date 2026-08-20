// The contextual shortcut-discovery feature: which bindings the resolver
// could still select from the held modifier prefix, deduped per chord by
// the resolver's own focus-specificity rules. A pure downstream consumer
// of keyboard-shortcuts.ts - that file never imports this one.
import type { ShortcutKey } from "@/utils/format-shortcut";
import type { KeyboardActionId } from "@/keyboard/actions";
import { keyComboToShortcutKeys, type KeyCombo } from "@/keyboard/shortcut-string";
import {
  bindingSpecificity,
  matchesKeyboardShortcutContext,
  SHORTCUT_HELP_LABEL_KEYS,
  type KeyboardShortcutContext,
  type ParsedShortcutBinding,
} from "@/keyboard/keyboard-shortcuts";

export interface ShortcutDiscoveryHeldModifiers {
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

/** A focus-valid shortcut ready for a visible hint or a centered command list. */
export interface ShortcutDiscoveryEntry {
  bindingId: string;
  action: KeyboardActionId;
  label: string;
  labelKey: string;
  chord: ShortcutKey[][];
  /** The portion of the first chord the user still needs to press. */
  remainingKeys: ShortcutKey[];
}

function comboMatchesHeldModifiers(
  combo: KeyCombo,
  held: ShortcutDiscoveryHeldModifiers,
  isMac: boolean,
): boolean {
  const heldMod = isMac ? held.meta : held.ctrl;

  if (held.alt && !combo.alt) return false;
  if (held.shift && !combo.shift) return false;
  if (held.ctrl && isMac && !combo.ctrl) return false;
  if (held.meta && !isMac && !combo.meta) return false;
  if (heldMod && !(combo.mod || (isMac ? combo.meta : combo.ctrl))) return false;

  return held.alt || held.ctrl || held.meta || held.shift;
}

function isHeldDisplayModifier(
  key: ShortcutKey,
  held: ShortcutDiscoveryHeldModifiers,
  isMac: boolean,
): boolean {
  switch (key) {
    case "alt":
      return held.alt;
    case "shift":
      return held.shift;
    case "ctrl":
      return held.ctrl;
    case "meta":
      return held.meta;
    case "mod":
      return isMac ? held.meta : held.ctrl;
    default:
      return false;
  }
}

function shortcutDiscoveryChordIdentity(chord: readonly KeyCombo[], isMac: boolean): string {
  return chord
    .map((combo) =>
      keyComboToShortcutKeys(combo)
        .map((key) => normalizeShortcutDiscoveryIdentityKey(key, isMac))
        .join("+"),
    )
    .join(" ");
}

function normalizeShortcutDiscoveryIdentityKey(key: ShortcutKey, isMac: boolean): ShortcutKey {
  if (key !== "mod") {
    return key;
  }
  return isMac ? "meta" : "ctrl";
}

/**
 * Returns the bindings the resolver could select from the currently held
 * modifier prefix. This deliberately shares the resolver's `when` and
 * focus-specificity rules, so a hint cannot advertise a lower-priority binding
 * shadowed by a focused editor or markdown editor command.
 */
export function buildShortcutDiscoveryEntries(input: {
  bindings: readonly ParsedShortcutBinding[];
  context: KeyboardShortcutContext;
  heldModifiers: ShortcutDiscoveryHeldModifiers;
}): ShortcutDiscoveryEntry[] {
  const entriesByChord = new Map<string, { entry: ShortcutDiscoveryEntry; specificity: number }>();

  for (const binding of input.bindings) {
    const firstCombo = binding.parsedChord[0];
    const help = binding.help;
    if (!firstCombo || !help) {
      continue;
    }
    if (!matchesKeyboardShortcutContext(binding.when, input.context)) {
      continue;
    }
    if (!comboMatchesHeldModifiers(firstCombo, input.heldModifiers, input.context.isMac)) {
      continue;
    }

    const chord = binding.parsedChord.map(keyComboToShortcutKeys);
    const entry: ShortcutDiscoveryEntry = {
      bindingId: binding.id,
      action: binding.action,
      label: help.label,
      labelKey: SHORTCUT_HELP_LABEL_KEYS[help.id] ?? help.label,
      chord,
      remainingKeys: (chord[0] ?? []).filter(
        (key) => !isHeldDisplayModifier(key, input.heldModifiers, input.context.isMac),
      ),
    };
    const specificity = bindingSpecificity(binding, input.context);
    const chordIdentity = shortcutDiscoveryChordIdentity(binding.parsedChord, input.context.isMac);
    const existing = entriesByChord.get(chordIdentity);
    if (!existing || specificity > existing.specificity) {
      entriesByChord.set(chordIdentity, { entry, specificity });
    }
  }

  return Array.from(entriesByChord.values(), ({ entry }) => entry);
}
