// History log of everything the pets generated, from pages and from the Studio's
// "Try it". Pure helpers + a serialized writer so concurrent runs can't clobber
// each other. Stored in chrome.storage.local "history", newest first.

export const HISTORY_CAP = 300;
const MAX_TEXT = 4000;

/** @typedef {"running"|"done"|"error"|"stopped"|"approved"|"posted"|"discarded"} Status */

const clip = (s, n = MAX_TEXT) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");

/** Build a log entry from a run request. */
export function makeEntry({ id, source, context = {}, skill = null, pet = null, instruction = "", label = "", request = "" }) {
  return {
    id,
    at: Date.now(),
    source, // "page" | "studio"
    skillId: skill?.id || null,
    skillName: skill?.name || label || instruction || "Ask",
    sticker: skill?.sticker || null,
    action: skill?.action || "answer",
    petId: pet?.id || null,
    petName: pet?.name || null,
    petColor: pet?.color || null,
    petSpecies: pet?.species || null,
    instruction: instruction || "",
    request: request || "",
    host: context.host || "",
    url: context.url || "",
    title: context.title || "",
    app: context.app || "",
    picked: context.label || "",
    input: clip(context.text, 1500),
    images: (context.images || []).length,
    output: "",
    status: "running",
    error: "",
    final: "", // the text actually applied/posted after approval (may be edited)
    ms: 0,
  };
}

export function addEntry(list, entry, cap = HISTORY_CAP) {
  return [entry, ...(list || []).filter((e) => e.id !== entry.id)].slice(0, cap);
}

export function updateEntry(list, id, patch) {
  return (list || []).map((e) => (e.id === id ? { ...e, ...patch, output: clip(patch.output ?? e.output), final: clip(patch.final ?? e.final) } : e));
}

/** Filter for the history views. */
export function filterHistory(list, { host = "", source = "", query = "" } = {}) {
  const q = query.trim().toLowerCase();
  return (list || []).filter(
    (e) =>
      (!host || e.host === host) &&
      (!source || e.source === source) &&
      (!q || `${e.skillName} ${e.petName || ""} ${e.output} ${e.input} ${e.title} ${e.host}`.toLowerCase().includes(q)),
  );
}

export const STATUS_LABEL = {
  running: "Generating…",
  done: "Generated",
  error: "Failed",
  stopped: "Stopped",
  approved: "Approved & applied",
  posted: "Posted to Figma",
  discarded: "Discarded",
};

export function timeAgo(ts, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Serialized read-modify-write on chrome.storage (service worker / pages). */
let chain = Promise.resolve();
export function mutateHistory(fn) {
  chain = chain.then(async () => {
    const { history = [] } = await chrome.storage.local.get("history");
    await chrome.storage.local.set({ history: fn(history) });
  }).catch(() => {});
  return chain;
}
