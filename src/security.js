// Security, the guard pet: local, on-device checks on what goes to the model and
// what comes back. Pure functions (no DOM, no network) so they run in the
// service worker, the content script and node tests.
//
// Threats covered:
//   1. Data leakage   – secrets and personal data in the picked content would be
//                       sent to the model provider. Found and masked locally.
//   2. Prompt injection through picked content – text that tries to give the
//                       model orders ("ignore previous instructions"), including
//                       invisible text (zero-width, bidi overrides, Unicode "tag"
//                       characters used for ASCII smuggling).
//   3. Untrusted output – a model result that would be written into the user's
//                       document or posted to Figma is checked for hidden
//                       characters, data-leaking links and injected instructions
//                       before the user approves it.

/** @typedef {{type:string, group:"secret"|"personal"|"injection"|"hidden"|"link", label:string, severity:"high"|"medium"|"low", start:number, end:number, match:string}} Finding */

const SECRETS = [
  ["private-key", "Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ["api-key", "API key", /\bsk-(?:or-v1-|proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g],
  ["aws-key", "AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["github-token", "GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ["slack-token", "Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ["google-key", "Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["figma-token", "Figma token", /\bfigd_[A-Za-z0-9_-]{20,}\b/g],
  ["jwt", "Login token (JWT)", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ["password", "Password", /\b(?:password|passwd|pwd)\s*[:=]\s*\S{4,}/gi],
];

const PERSONAL = [
  ["email", "Email address", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ["ssn", "Social Security number", /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g],
  ["card", "Card number", /\b(?:\d[ -]?){12,18}\d\b/g],
  ["phone", "Phone number", /(?<![\w.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\w|\.\d)/g],
];

// Orders aimed at an AI, hidden in content the user only meant as data.
const INJECTION = [
  ["override", "Tries to override instructions", /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,30}\b(?:previous|prior|above|earlier|all|any|your|the)\b[^.\n]{0,20}\b(?:instructions?|prompts?|rules|directions|guidelines)\b/gi],
  ["new-orders", "Gives the AI new orders", /\b(?:new|updated|real|actual)\s+(?:instructions?|task|orders)\s*:/gi],
  ["role", "Pretends to be the system", /(?:^|\n)\s*(?:system|assistant|developer)\s*[:>]|\[\s*(?:system|inst)\s*\]|<\|?\s*(?:system|im_start)\s*\|?>/gi],
  ["persona", "Tries to change who the AI is", /\byou are (?:now|no longer)\b|\bfrom now on,? you\b|\bact as (?:an?|the) (?:unrestricted|jailbroken|different)\b/gi],
  ["secrecy", "Asks the AI to hide something", /\b(?:do not|don't|never)\s+(?:tell|mention|reveal|show|inform)\s+(?:the\s+)?user\b/gi],
  ["exfiltrate", "Asks the AI to send data somewhere", /\b(?:send|forward|post|upload|exfiltrate|leak)\b[^.\n]{0,40}\b(?:to|at)\s+(?:https?:\/\/|[\w.-]+@|this (?:url|address|link))/gi],
  ["breakout", "Tries to break out of the content wrapper", /<\/?\s*picked_content\s*>/gi],
];

// Invisible or direction-flipping characters: a classic way to hide instructions.
const HIDDEN = [
  ["tag-chars", "Invisible tag characters (hidden text)", /[\u{E0000}-\u{E007F}]+/gu],
  ["bidi", "Text-direction overrides", /[\u202A-\u202E\u2066-\u2069]+/g],
  ["zero-width", "Zero-width characters", /[\u200B-\u200F\u2060-\u2064\uFEFF]{2,}/g],
];

// A link or image whose URL carries data out (e.g. ![x](https://evil.test/?q=SECRET)).
const LINKS = [
  ["data-url", "Link that sends data in its address", /!?\[[^\]]*\]\(\s*https?:\/\/[^)\s]*[?&][^)\s=]+=[^)\s]{16,}[^)]*\)/gi],
  ["bare-exfil", "Address carrying a long encoded value", /\bhttps?:\/\/[^\s)]+[?&](?:q|data|d|c|token|key|secret|payload)=[A-Za-z0-9%+/=_-]{24,}/gi],
];

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

function collect(text, rules, group, severity, findings) {
  for (const [type, label, re] of rules) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const match = m[0];
      if (type === "card") {
        const digits = match.replace(/\D/g, "");
        if (digits.length < 13 || digits.length > 19 || !luhn(digits)) continue;
      }
      findings.push({ type, group, label, severity: typeof severity === "function" ? severity(type) : severity, start: m.index, end: m.index + match.length, match });
    }
  }
}

/** Drop findings that sit inside a stronger one (a key inside a private-key block, etc.). */
function dedupe(findings) {
  const rank = { high: 0, medium: 1, low: 2 };
  const sorted = [...findings].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || rank[a.severity] - rank[b.severity]);
  const out = [];
  for (const f of sorted) {
    const outer = out.find((o) => f.start >= o.start && f.end <= o.end && (o.group === f.group || (o.group === "secret" && f.group === "personal")));
    if (!outer) out.push(f);
  }
  return out;
}

/**
 * Scan text that is about to be sent to the model.
 * @returns {Finding[]} sorted by position
 */
export function scanText(text) {
  const s = String(text || "");
  if (!s) return [];
  const findings = [];
  collect(s, SECRETS, "secret", "high", findings);
  collect(s, PERSONAL, "personal", (t) => (t === "ssn" || t === "card" ? "high" : "medium"), findings);
  collect(s, INJECTION, "injection", (t) => (t === "override" || t === "exfiltrate" || t === "breakout" ? "high" : "medium"), findings);
  collect(s, HIDDEN, "hidden", "high", findings);
  return dedupe(findings);
}

/**
 * Scan a model result before it's applied to the page or posted.
 * Adds checks for links that carry data out.
 */
export function scanOutput(text) {
  const s = String(text || "");
  if (!s) return [];
  const findings = scanText(s).filter((f) => f.group !== "personal" || f.severity === "high");
  collect(s, LINKS, "link", "high", findings);
  return dedupe(findings);
}

const MASK = { "private-key": "[PRIVATE KEY]", "api-key": "[API KEY]", "aws-key": "[API KEY]", "github-token": "[API KEY]", "slack-token": "[API KEY]", "google-key": "[API KEY]", "figma-token": "[API KEY]", jwt: "[LOGIN TOKEN]", password: "[PASSWORD]", email: "[EMAIL]", ssn: "[ID NUMBER]", card: "[CARD NUMBER]", phone: "[PHONE]" };

/**
 * Mask secrets and personal data, and strip invisible characters.
 * Injection phrases are kept (the user may want them analysed) but defanged by
 * the request wrapper, which treats picked content strictly as data.
 * @returns {{text:string, count:number}}
 */
export function redact(text, findings = scanText(text)) {
  const s = String(text || "");
  const spans = findings.filter((f) => MASK[f.type] || f.group === "hidden").sort((a, b) => b.start - a.start);
  let out = s;
  for (const f of spans) out = out.slice(0, f.start) + (f.group === "hidden" ? "" : MASK[f.type]) + out.slice(f.end);
  return { text: out, count: spans.length };
}

/**
 * Make a model result safe to show and apply: links that carry data out are
 * replaced, and invisible characters are removed. Everything else is kept.
 */
export function defang(text, findings = scanOutput(text)) {
  const spans = findings.filter((f) => f.group === "link" || f.group === "hidden").sort((a, b) => b.start - a.start);
  let out = String(text || "");
  for (const f of spans) out = out.slice(0, f.start) + (f.group === "link" ? "[link removed by Security]" : "") + out.slice(f.end);
  return out;
}

/** Remove invisible / direction-override characters only (safe for any text). */
export function stripHidden(text) {
  return String(text || "").replace(/[\u{E0000}-\u{E007F}\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060-\u2064\uFEFF]/gu, "");
}

/** Show a finding without revealing a secret: "sk-or-v1-ab…9f" or "j***@mail.com". */
export function preview(f) {
  const m = f.match;
  if (f.group === "hidden") return `${[...m].length} invisible character${[...m].length === 1 ? "" : "s"}`;
  if (f.group === "secret") return m.length > 10 ? `${m.slice(0, 6)}…${m.slice(-2)}` : "••••";
  if (f.type === "email") return m.replace(/^(.).*?@/, "$1***@");
  if (f.group === "personal") return `•••${m.replace(/\D/g, "").slice(-4)}`;
  const one = m.replace(/\s+/g, " ").trim();
  return one.length > 60 ? one.slice(0, 57) + "…" : one;
}

const GROUP_LABEL = { secret: "Secrets", personal: "Personal data", injection: "Hidden instructions", hidden: "Invisible text", link: "Data-leaking links" };

/** Findings safe to show in the UI or store: no raw secrets. */
export function summarize(findings) {
  const counts = {};
  for (const f of findings) counts[f.group] = (counts[f.group] || 0) + 1;
  return {
    total: findings.length,
    high: findings.filter((f) => f.severity === "high").length,
    groups: Object.entries(counts).map(([group, n]) => ({ group, label: GROUP_LABEL[group] || group, n })),
    items: findings.slice(0, 12).map((f) => ({ type: f.type, group: f.group, label: f.label, severity: f.severity, preview: preview(f) })),
    redactable: findings.some((f) => MASK[f.type] || f.group === "hidden"),
  };
}

/** Markdown report for Security's on-device skills (no model involved). */
export function report(kind, text) {
  const all = scanText(text);
  const pick = kind === "injection" ? all.filter((f) => f.group === "injection" || f.group === "hidden") : all.filter((f) => f.group === "secret" || f.group === "personal");
  const title = kind === "injection" ? "Hidden instructions" : "Sensitive data";
  const none = kind === "injection"
    ? "**No hidden instructions found.** Nothing here tries to give an AI orders, and there's no invisible text."
    : "**No sensitive data found.** No keys, tokens, passwords, emails, phone, card or ID numbers.";
  const foot = "\n\n_Checked on this device by Security. Nothing was sent to the model._";
  if (!pick.length) return none + foot;
  const high = pick.filter((f) => f.severity === "high").length;
  const risk = high ? "High" : "Medium";
  const rows = pick.slice(0, 20).map((f) => `| ${f.severity === "high" ? "**High**" : "Medium"} | ${f.label} | \`${preview(f).replace(/\|/g, "\\|").replace(/`/g, "'")}\` |`).join("\n");
  const advice = kind === "injection"
    ? "Treat this content as untrusted. Pets will still read it only as data, but don't paste it into other AI tools as-is."
    : "With the Security guard on, these are masked (for example `[EMAIL]`) before any pet sends this content to the model.";
  return `### ${title}: ${pick.length} found\n**Risk: ${risk}**\n\n| Risk | What | Found |\n|---|---|---|\n${rows}\n\n${advice}${foot}`;
}
