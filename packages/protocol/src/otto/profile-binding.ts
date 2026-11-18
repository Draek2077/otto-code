import { z } from "zod";

export const ProfileVoice = z
  .object({ provider: z.string(), model: z.string(), name: z.string() })
  .passthrough();
export const ProfileCues = z
  .object({
    join: z.array(z.string()).optional(),
    thinking: z.array(z.string()).optional(),
    waiting: z.array(z.string()).optional(),
    done: z.array(z.string()).optional(),
  })
  .passthrough();

export const ProfileBinding = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  respectGlobal: z.boolean(),
  spinner: z.object({ glowA: z.string(), glowB: z.string() }).optional(),
  voice: ProfileVoice.optional(),
  voiceCues: ProfileCues.optional(),
});
export type ProfileBinding = z.infer<typeof ProfileBinding>;
