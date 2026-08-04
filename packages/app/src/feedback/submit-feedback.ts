import type { FeedbackRequestBody } from "@/feedback/feedback-payload";

// The hosted intake. Overridable so the endpoint can be pointed at a local
// `wrangler dev` while working on the Worker half.
const DEFAULT_FEEDBACK_ENDPOINT = "https://otto-code.me/api/feedback";
const SUBMIT_TIMEOUT_MS = 15_000;

export function resolveFeedbackEndpoint(): string {
  const override = process.env.EXPO_PUBLIC_FEEDBACK_ENDPOINT?.trim();
  return override && override.length > 0 ? override : DEFAULT_FEEDBACK_ENDPOINT;
}

export class FeedbackSubmitError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "FeedbackSubmitError";
    this.status = status;
  }
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const error = (body as { error?: unknown }).error;
      if (typeof error === "string" && error.trim().length > 0) {
        return error.trim();
      }
    }
  } catch {
    // A non-JSON body (a proxy error page, say) tells us nothing useful.
  }
  return null;
}

function describeFailure(status: number, serverMessage: string | null): string {
  if (status === 429) {
    return serverMessage ?? "Too many reports sent recently. Try again a bit later.";
  }
  if (status === 503) {
    return "Feedback isn't accepting reports right now. Please try again later.";
  }
  if (status >= 500) {
    return "Otto's feedback service is having trouble. Please try again later.";
  }
  return serverMessage ?? "That report was rejected. Check the message and try again.";
}

export async function submitFeedback(body: FeedbackRequestBody): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(resolveFeedbackEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // Offline, DNS, TLS, or the 15s abort - indistinguishable to the reporter,
    // and the fix is the same either way.
    throw new FeedbackSubmitError(
      "Couldn't reach otto-code.me. Check your connection and try again.",
      null,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new FeedbackSubmitError(
      describeFailure(response.status, await readErrorMessage(response)),
      response.status,
    );
  }
}
