/**
 * Numeric bounds for settings, in a module with **no imports**.
 *
 * These live apart from `storage.ts` so that a consumer wanting a bound does not have to load
 * the settings store with it. `storage.ts` reaches `@/constants/layout`, which imports
 * `react-native-unistyles`, whose published entry point is TypeScript source rather than
 * compiled JavaScript. Anything running outside Metro - Playwright's spec loader above all -
 * cannot parse that, and fails with `SyntaxError: Unexpected token 'typeof'` reported against
 * the spec rather than the package.
 *
 * Keep this file dependency-free. `storage.ts` re-exports everything here, so existing imports
 * are unaffected and nothing needs to know which file a bound came from.
 */

export const DEFAULT_UI_FONT_SIZE = 16; // == FONT_SIZE.base
export const MIN_UI_FONT_SIZE = 12;
export const MAX_UI_FONT_SIZE = 22;
export const DEFAULT_CONTENT_FONT_SIZE = 17; // == FONT_SIZE.content
export const MIN_CONTENT_FONT_SIZE = 12;
export const MAX_CONTENT_FONT_SIZE = 24;
export const DEFAULT_CODE_FONT_SIZE = 12; // == FONT_SIZE.code
export const MIN_CODE_FONT_SIZE = 12;
export const MAX_CODE_FONT_SIZE = 22; // line-height 1.5×22=33 stays safe
export const DEFAULT_TERMINAL_FONT_SIZE = 12;
export const MIN_TERMINAL_FONT_SIZE = 12;
export const MAX_TERMINAL_FONT_SIZE = 22;
export const MAX_FONT_FAMILY_LENGTH = 200;
