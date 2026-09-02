import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";
import { GENERATED_SETTINGS_SEARCH_ITEMS } from "@/screens/settings-search-generated";

export interface SettingsSearchItem {
  id: string;
  title: string;
  description: string;
  keywords: string;
  scope: "App" | "Desktop" | "Host" | "Project";
  section: SettingsSectionSlug | HostSectionSlug;
  host: boolean;
  category: string;
  group: string;
  audience: string;
  kind: string;
  choices: string;
  defaultValue: string;
  /** Capability and visibility gate from the audited Settings source. */
  conditions: string;
  /** The authoritative App or Host storage destination from the inventory. */
  persistence: string;
  advanced: boolean;
  developerOnly?: boolean;
}

/**
 * The complete audited Settings inventory, including preferences, actions,
 * permissions, status rows, catalog choices, and conditionally visible rows.
 * Secrets are indexed by their user-facing labels and descriptions only.
 */
export const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = GENERATED_SETTINGS_SEARCH_ITEMS;

function settingsSearchHaystack(item: SettingsSearchItem): string {
  return `${item.title} ${item.description} ${item.keywords} ${item.scope} ${item.category} ${item.group}`.toLowerCase();
}

/**
 * Splits a raw query into search terms. Whitespace separates terms, and a
 * quoted run is kept whole so a phrase can still be matched verbatim.
 */
export function parseSettingsSearchTerms(query: string): string[] {
  const terms: string[] = [];
  for (const match of query.toLowerCase().matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = (match[1] ?? match[2] ?? "").trim();
    if (term) {
      terms.push(term);
    }
  }
  return terms;
}

/** Every term must appear somewhere in the row, in any order. */
export function matchesSettingsSearchTerms(item: SettingsSearchItem, terms: string[]): boolean {
  if (terms.length === 0) {
    return false;
  }
  const haystack = settingsSearchHaystack(item);
  return terms.every((term) => haystack.includes(term));
}

export function searchSettingsCatalog(query: string): SettingsSearchItem[] {
  const terms = parseSettingsSearchTerms(query);
  if (terms.length === 0) {
    return [];
  }
  return SETTINGS_SEARCH_ITEMS.filter((item) => matchesSettingsSearchTerms(item, terms));
}
