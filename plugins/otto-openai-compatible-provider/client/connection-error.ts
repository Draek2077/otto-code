import { z } from "zod";

export function connectionError(error: unknown): string {
  if (!(error instanceof z.ZodError))
    return error instanceof Error ? error.message : "Check the connection details and try again.";
  const issue = error.issues[0];
  if (!issue?.path.length || issue.path.includes("baseUrl"))
    return "Enter a valid API URL beginning with http:// or https://, without credentials or query parameters.";
  if (issue.path.includes("maxToolRounds"))
    return "Tool round limit must be a whole number from 1 to 100.";
  if (issue.path.includes("timeoutMs")) return "Request timeout must be from 1 to 1800 seconds.";
  if (issue.path.includes("apiKeyEnv"))
    return "Enter an environment variable name, such as OPENAI_API_KEY.";
  return issue.message;
}
