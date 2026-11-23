import { z } from "zod";
export const knowledgeProjectFields = z.object({
  knowledgeLocation: z.enum(["repository", "host"]).nullish(),
  knowledgeDirectoryName: z.string().nullable().optional(),
});
