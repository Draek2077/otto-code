# Protocol Validation

The client validates inbound WebSocket messages with zod-aot generated validators instead of runtime Zod on the hot path. Zod remains the authoring source of truth for schemas and TypeScript types.

The reason is mobile performance. A captured 353 KB provider snapshot cost about 10.9 ms and 5.9 MB allocated per message for `JSON.parse` plus Zod on Hermes. After moving provider-model normalization out of the schema so zod-aot could compile the hot subtree, the generated validator path measured about 2.5 ms and 1.2 MB allocated.

## Runtime Path

`packages/protocol/src/validation/ws-outbound.ts` is the shipped boundary. The envelope is either `pong` or `{ type: "session", message }`. The boundary picks the generated validator for `pong`, or for the session message's `type`, from a `Map` built at generation time, and returns the validated data. It does not normalize or repair the generated result. When a generated validator rejects a message, or the envelope or message type is unknown, the boundary re-parses the input with the Zod source schema so the failure carries a normal `ZodError` for logging. That path only runs for invalid messages.

Generated validators preserve unknown keys where Zod object parsing strips them. The client dispatch path uses known `type` and payload fields, so this passthrough behavior is accepted for inbound messages. The boundary keeps the original envelope object for the same reason. The wire format is unchanged.

Provider model normalization is a parser-side compatibility shim in the client consumers that need it. Newer daemons normalize at the provider registry source.

## One Validator Per Message Type

zod-aot emits every `compile()` as a single function. Compiled as one schema, the outbound envelope became one function of about 25,000 lines and 7,400 locals. Hermes cannot compile a function that size in reasonable memory, and that one file is what killed the Android APK release build (see [android.md](android.md)). The codegen entry therefore compiles `WSPongMessageSchema` and each branch of `SessionOutboundMessageSchema` separately.

Measured on 2026-09-12, with the Windows `hermesc` (a debug build) and the release flags `-O -output-source-map`:

| Measure                                                  | One whole-envelope validator      | One validator per message type |
| -------------------------------------------------------- | --------------------------------- | ------------------------------ |
| `hermesc` on the generated validators alone              | killed at a 12 GB cap after 8 min | 0.57 GB, 13 s                  |
| Largest generated function                               | 6.9 MB                            | 379 KB                         |
| Validation per message, 31 captured daemon frames (Node) | 3,636 ns                          | 2,113 ns                       |

The speed comparison ran in Node, not Hermes; both layouts execute the same per-type code once the validator is chosen. Keep this shape: do not compile the whole envelope, or any other large union, as one schema in a bundle that Hermes compiles.

### Condition-chain depth

Size is not the only Hermes limit. zod-aot emits an object's checks as one flat `a && b && c ...` expression, and hermesc parses that as nested binary nodes. The Windows `hermesc` rejects nesting past about 510 with `Too many nested expressions/statements/declarations` (measured 2026-09-13: a 500-term chain compiles, 511 fails). The Linux `hermesc` CI uses accepted a 542-term chain, but that is headroom, not a guarantee.

`stats.activity.get.response` (five `ActivityCounters` buckets of about 30 defaulted numbers) produced a 542-term chain and broke local Windows APK builds. Such types are listed in `packages/protocol/codegen/ws-outbound-zod-only-types.ts`: the codegen entry skips them and `validateWSOutboundMessage` validates them with the Zod source schema, which it already does for any type without a generated validator. A regression test keeps every compiled chain under 400 terms, so the next counter added fails a unit test instead of the APK build.

## Codegen Ownership

The protocol package owns generation.

- `packages/protocol/codegen/ws-outbound.compile.ts` is the build-time zod-aot discovery entry. It exports `WSPongMessage` and a default object of `SessionOutbound_<index>` validators, one per union branch.
- `packages/protocol/scripts/generate-validation-aot.mjs` runs the exact-pinned compiler, applies the small local compiler patches before generation, and writes the three generated files below. It fails when a union branch has no literal `type` or two branches declare the same one.
- `packages/protocol/scripts/watch-validation-aot.mjs` reruns generation while editing protocol sources.
- `packages/protocol/src/generated/validation/ws-outbound.aot.ts` holds the generated validators, `ws-outbound-metadata.aot.ts` gives each one a named source-schema reference for zod-aot fallback and default references, and `ws-outbound-dispatch.aot.ts` maps each message `type` to its validator. All three are gitignored.
- `packages/protocol/src/validation/ws-outbound-schema-metadata.ts` is the upstream metadata module for the single-validator layout. The generator no longer references it.

Generation runs from protocol-owned lifecycle hooks: `prebuild`, `pretypecheck`, `pretest`, and `watch`. Installs do not run generation: published packages consume protocol from prebuilt `dist`, and local build/typecheck/test flows generate the source files at the point they are actually needed.

## Regression Tests

zod-aot is exact-pinned and young enough that compiler patches are treated as part of this package. `packages/protocol/tests/validation/ws-outbound.test.ts` keeps small regression tests for the patched cases and the per-type layout:

- discriminated-union branch output must propagate `.default()` fields
- current sequential item routing must accept `tool_call`-like status branches
- generated runtime imports must keep `.js` extensions for packaged Node ESM
- the validation boundary accepts a minimal valid message and rejects a corrupted one
- every `SessionOutboundMessageSchema` branch type dispatches to exactly one generated validator
- no single generated validator exceeds 1,000,000 characters, so the Hermes compile stays small
- rejected and unknown messages fall back to Zod errors

## Schema Purity

Message schemas are structural declarations. Do not put `.transform()`, `.catch()`, or `.preprocess()` on WebSocket message schemas. If parsed data needs normalization, put it in an explicit consumer or post-validation pass.

Use `z.discriminatedUnion()` when every branch has a shared literal tag. Plain `z.union()` is acceptable only when there is no shared literal discriminator or when a generated-code regression test proves that specific shape is miscompiled.

Defaults are allowed only on primitive leaves. Do not place `.default()` on large arrays, item schemas, or big containers in inbound message schemas.
