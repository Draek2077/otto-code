import { z } from "zod";

export const suggestedTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(60),
  summary: z.string().min(1).max(400),
  workspaceId: z.string().min(1),
});
export type SuggestedTaskCardData = z.infer<typeof suggestedTaskSchema>;
