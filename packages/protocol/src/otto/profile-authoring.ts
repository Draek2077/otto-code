import { z } from "zod";
export const AuthorInput = z.object({
  kind: z.enum(["prompt", "cues"]),
  name: z.string().trim().min(1).max(160),
  roles: z.array(z.string().max(64)).max(32),
  prompt: z.string().max(12000),
  palette: z.array(z.string().max(32)).max(2),
});
const lines = z.array(z.string().trim().min(1).max(160)).min(1).max(5);
export const AuthoredCues = z.object({ join: lines, thinking: lines, waiting: lines, done: lines });
export const AuthoredPrompt = z.object({ prompt: z.string().trim().min(1).max(4000) });
export const AuthorResult = z.discriminatedUnion("kind", [
  AuthoredPrompt.extend({ kind: z.literal("prompt") }),
  z.object({ kind: z.literal("cues"), cues: AuthoredCues }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export const AuthorRequest = z.object({
  type: z.literal("agent.profile.author.request"),
  requestId: z.string(),
  input: AuthorInput,
});
export const AuthorResponse = z.object({
  type: z.literal("agent.profile.author.response"),
  payload: z.object({ requestId: z.string(), result: AuthorResult }),
});
export type AuthorInput = z.infer<typeof AuthorInput>;
export type AuthorResult = z.infer<typeof AuthorResult>;
