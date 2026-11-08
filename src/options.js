import { DEFAULTS as MODEL_DEFAULTS, MODELS } from "./models.js";

const DEFAULTS = { anthropicKey: "", ...MODEL_DEFAULTS, peekEnabled: true, peekBlocked: [], figmaToken: "", squadVisible: true, squadCollapsed: false, squadMiniStyle: "pets", pinsEnabled: true, securityGuard: true };
const $ = (id) => document.getElementById(id);

for (const m of MODELS) $("model").append(new Option(m.label, m.id));

chrome.storage.local.get(DEFAULTS).then((s) => {
  $("apiKey").value = s.anthropicKey;
  // An old OpenRouter model id isn't in the list: show the default.
  $("model").value = MODELS.some((m) => m.id === s.model) ? s.model : DEFAULTS.model;
  $("effort").value = s.effort;
  $("peekEnabled").checked = s.peekEnabled;
  $("figmaToken").value = s.figmaToken;
  $("squadVisible").checked = s.squadVisible;
  $("squadCollapsed").checked = s.squadCollapsed;
  $("squadMiniStyle").value = s.squadMiniStyle;
  $("pinsEnabled").checked = s.pinsEnabled;
  $("securityGuard").checked = s.securityGuard;
  $("peekBlocked").value = s.peekBlocked.join("\n");
});

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    anthropicKey: $("apiKey").value.trim(),
    model: $("model").value || DEFAULTS.model,
    effort: $("effort").value,
    peekEnabled: $("peekEnabled").checked,
    figmaToken: $("figmaToken").value.trim(),
    squadVisible: $("squadVisible").checked,
    squadCollapsed: $("squadCollapsed").checked,
    squadMiniStyle: $("squadMiniStyle").value,
    pinsEnabled: $("pinsEnabled").checked,
    securityGuard: $("securityGuard").checked,
    peekBlocked: $("peekBlocked").value.split(/\s+/).map((h) => h.trim()).filter(Boolean),
  });
  $("status").textContent = "Saved";
  setTimeout(() => ($("status").textContent = ""), 1500);
});
