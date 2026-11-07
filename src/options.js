import { DEFAULTS as MODEL_DEFAULTS } from "./openrouter.js";

const DEFAULTS = { apiKey: "", ...MODEL_DEFAULTS, peekEnabled: true, peekBlocked: [] };
const $ = (id) => document.getElementById(id);

chrome.storage.local.get(DEFAULTS).then((s) => {
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
  $("effort").value = s.effort;
  $("peekEnabled").checked = s.peekEnabled;
  $("peekBlocked").value = s.peekBlocked.join("\n");
});

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || DEFAULTS.model,
    effort: $("effort").value,
    peekEnabled: $("peekEnabled").checked,
    peekBlocked: $("peekBlocked").value.split(/\s+/).map((h) => h.trim()).filter(Boolean),
  });
  $("status").textContent = "Saved";
  setTimeout(() => ($("status").textContent = ""), 1500);
});
