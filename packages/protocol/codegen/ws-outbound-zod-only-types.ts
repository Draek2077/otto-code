// Outbound message types that are NOT compiled by zod-aot and validate through the Zod source
// schema instead (src/validation/ws-outbound.ts falls back to Zod when a type has no generated
// validator).
//
// zod-aot emits each object check as one flat `a && b && c ...` expression, which Hermes parses as
// nested binary nodes. The Windows hermesc rejects nesting past about 510 with "Too many nested
// expressions/statements/declarations" (measured 2026-09-13: a 500-term chain compiles, 511 fails).
// tests/validation/ws-outbound.test.ts enforces a lower budget on every compiled validator; a type
// that cannot fit belongs here.
export const ZOD_ONLY_OUTBOUND_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  // Five ActivityCounters buckets of ~30 defaulted numbers: a 542-term chain.
  "stats.activity.get.response",
]);
