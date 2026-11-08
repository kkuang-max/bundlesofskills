// Claude client for the service worker: one streaming Messages API call through
// the official Anthropic SDK. Docs: https://platform.claude.com/docs/en/api/messages
import Anthropic from "@anthropic-ai/sdk";

import { DEFAULTS } from "./models.js";
export { API_HOST, DEFAULTS, MODELS } from "./models.js";

// Models that can hand a declined request to another model server-side.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

export class ClaudeError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "ClaudeError";
    this.status = status;
    this.code = code;
  }
}

/** Turn an SDK error into a message a person can act on. */
export function friendlyError(e) {
  const detail = e?.error?.error?.message || "";
  const withDetail = (s) => (detail ? `${s} (${detail})` : s);
  if (e instanceof Anthropic.AuthenticationError) return new ClaudeError("That Anthropic API key was rejected. Check it in the options.", { status: 401, code: "bad-key" });
  if (e instanceof Anthropic.PermissionDeniedError) return new ClaudeError(withDetail("This key isn't allowed to use that model."), { status: 403, code: "bad-key" });
  if (e instanceof Anthropic.NotFoundError) return new ClaudeError("Anthropic doesn't know that model id. Pick one in the options.", { status: 404, code: "bad-model" });
  if (e instanceof Anthropic.ContentTooLargeError) return new ClaudeError("What you picked is too big to send. Pick a smaller area.", { status: 413 });
  if (e instanceof Anthropic.BadRequestError) return new ClaudeError(withDetail("Anthropic rejected the request."), { status: 400, code: /credit|billing/i.test(detail) ? "billing" : undefined });
  if (e instanceof Anthropic.RateLimitError) return new ClaudeError("Rate limited. Try again in a moment.", { status: 429 });
  if (e instanceof Anthropic.OverloadedError) return new ClaudeError("Claude is overloaded right now. Try again in a moment.", { status: 529 });
  if (e instanceof Anthropic.InternalServerError) return new ClaudeError("Anthropic had a server error. Try again.", { status: e.status });
  if (e instanceof Anthropic.APIConnectionError) return new ClaudeError("Couldn't reach api.anthropic.com. Check your connection.", { code: "network" });
  if (e instanceof Anthropic.APIError) return new ClaudeError(withDetail(`Anthropic error ${e.status ?? ""}`.trim() + "."), { status: e.status });
  return e instanceof Error ? e : new ClaudeError(String(e));
}

/**
 * Stream one reply. Calls onText(delta) as text arrives. Pass `user` (a string)
 * or `content` (Messages API content blocks: text and images).
 * Resolves {text, finishReason, usage}; throws ClaudeError, or an AbortError when stopped.
 */
export async function streamChat({ apiKey, model, effort, system, user, content, onText = () => {}, signal, fetchImpl }) {
  model = model || DEFAULTS.model;
  // The key lives in the extension's own storage and is only sent to api.anthropic.com
  // from the service worker, never from a web page.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  const fallback = FALLBACK_MODELS.has(model);
  let text = "";
  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 16000,
        output_config: { effort: effort || DEFAULTS.effort },
        system,
        messages: [{ role: "user", content: content ?? user }],
        // If a safety check declines the request, let the API retry it on a suitable model.
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      },
      { signal },
    );
    stream.on("text", (delta) => {
      text += delta;
      onText(delta);
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new ClaudeError("Claude declined this one. Try rephrasing or picking different content.", { code: "refusal" });
    return { text, finishReason: msg.stop_reason, usage: msg.usage, model: msg.model };
  } catch (e) {
    if (signal?.aborted || e instanceof Anthropic.APIUserAbortError) {
      const abort = new Error("Stopped");
      abort.name = "AbortError";
      throw abort;
    }
    throw e instanceof ClaudeError ? e : friendlyError(e);
  }
}
