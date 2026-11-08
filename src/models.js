// Model choices and defaults. Kept apart from the SDK client so the options page stays small.

export const API_HOST = "api.anthropic.com";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (best quality)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, cheaper)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)" },
];

export const DEFAULTS = {
  model: "claude-opus-5-5",
  // Quick skills don't need deep thinking; "medium" / "high" trade speed for care.
  effort: "low",
};
