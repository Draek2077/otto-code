# Protocol Validator Codegen

This directory is build-time only. `ws-outbound.compile.ts` is the zod-aot discovery entry for the inbound WebSocket validators. It compiles the pong message and each outbound session message type separately, because a single whole-envelope validator is too large for Hermes to compile (see `docs/protocol-validation.md`).

The generated runtime files are written to `../src/generated/validation/` (`ws-outbound.aot.ts`, `ws-outbound-metadata.aot.ts`, and `ws-outbound-dispatch.aot.ts`) and are not committed. The protocol package owns every generation trigger through its npm lifecycle scripts.

`zod-aot` is exact-pinned, and the protocol generator applies the small compiler patches it requires before generation. Treat changes to those patches like compiler changes: regenerate, inspect the output, and run the protocol validation regression tests before shipping.
