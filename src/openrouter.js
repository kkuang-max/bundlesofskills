// Minimal OpenRouter client: one streaming chat completion over fetch.
// OpenRouter speaks the OpenAI chat-completions format and streams SSE.
// Docs: https://openrouter.ai/docs/api-reference/chat-completion

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULTS = {
  // Any model id from https://openrouter.ai/models works; change it in Options.
  model: "anthropic/claude-opus-5.5",
  effort: "low",
};

const FRIENDLY = {
  400: "OpenRouter rejected the request. Check the model id in the options.",
  401: "That OpenRouter key was rejected. Check it in the options.",
  402: "Your OpenRouter account is out of credits.",
  403: "OpenRouter blocked this request (moderation or key limits).",
  404: "OpenRouter doesn't know that model id. Pick one from openrouter.ai/models.",
  408: "OpenRouter timed out. Try again.",
  429: "Rate limited. Try again in a moment.",
  502: "The model provider is down or returned an error. Try again or switch models.",
  503: "No provider is available for that model right now. Try again or switch models.",
};

export class OpenRouterError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.code = code;
  }
}

function toError(status, body) {
  const detail = body?.error?.message;
  const friendly = FRIENDLY[status] || `OpenRouter error ${status}.`;
  return new OpenRouterError(detail && !FRIENDLY[status] ? `${friendly} ${detail}` : friendly, {
    status,
    code: status === 401 ? "bad-key" : status === 404 || status === 400 ? "bad-model" : undefined,
  });
}

/**
 * Stream one completion. Calls onText(delta) as text arrives.
 * Resolves {text, finishReason, usage}; throws OpenRouterError on failure.
 */
export async function streamChat({ apiKey, model, effort, system, user, onText = () => {}, signal, fetchImpl = fetch }) {
  const res = await fetchImpl(OPENROUTER_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional attribution headers OpenRouter shows on its dashboard.
      "HTTP-Referer": "https://github.com/kkuang-max/hackathon",
      "X-Title": "Skill Pet",
    },
    body: JSON.stringify({
      model: model || DEFAULTS.model,
      stream: true,
      max_tokens: 4096,
      // Ignored by models without reasoning support.
      reasoning: { effort: effort || DEFAULTS.effort, exclude: true },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    throw toError(res.status, body);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let finishReason = null;
  let usage = null;

  const handleLine = (line) => {
    // SSE: "data: {...}" lines; ": OPENROUTER PROCESSING" keep-alive comments.
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.error) {
      // Errors after streaming has started arrive in-band with HTTP 200.
      throw toError(chunk.error.code || 500, { error: chunk.error });
    }
    const choice = chunk.choices?.[0];
    const delta = choice?.delta?.content;
    if (delta) {
      text += delta;
      onText(delta);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      handleLine(line);
    }
  }
  if (buf) handleLine(buf);

  if (finishReason === "error") throw new OpenRouterError("The model stopped with an error. Try again or switch models.");
  return { text, finishReason, usage };
}
