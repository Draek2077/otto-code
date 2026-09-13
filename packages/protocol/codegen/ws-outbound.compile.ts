import { compile } from "zod-aot";
import { SessionOutboundMessageSchema, WSPongMessageSchema } from "../src/messages.js";

// One compiled validator per outbound message type, not one for the whole envelope. zod-aot emits
// each compile() as a single function; compiled whole, the envelope became one function of about
// 25,000 lines and 7,400 locals that hermesc could not compile in 12 GB, which killed the Android
// release build. Split, the largest validator is a few hundred KB. The generator maps each message
// `type` literal to its validator. See docs/protocol-validation.md.
export const WSPongMessage = compile(WSPongMessageSchema);

export default Object.fromEntries(
  SessionOutboundMessageSchema.options.map((option, index) => [
    `SessionOutbound_${index}`,
    compile(option),
  ]),
);
