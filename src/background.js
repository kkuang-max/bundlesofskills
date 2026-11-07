// MV3 service worker: owns the OpenRouter key and the model call, relays
// hotkeys to the tab. The page never sees the key; the content script talks to
// us over a runtime Port and gets streamed text back.
import { buildRequest } from "./skills.js";
import { DEFAULTS, streamChat } from "./openrouter.js";

async function settings() {
  return chrome.storage.local.get({ apiKey: "", model: DEFAULTS.model, effort: DEFAULTS.effort });
}

// --- Hotkeys (chrome://extensions/shortcuts lets the user rebind them) ------
chrome.commands.onCommand.addListener(async (command, tab) => {
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: command }).catch(() => {
    // No content script (chrome:// pages, Web Store, PDF viewer, or the tab
    // predates the install). Nothing we can do there.
  });
});

// Right-click entry point, same flow as the hotkey.
chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({ id: "summon", title: "Ask the pet…", contexts: ["selection", "editable", "page"] });
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "summon" && tab?.id) chrome.tabs.sendMessage(tab.id, { type: "summon" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "open-options") chrome.runtime.openOptionsPage();
});

// --- Running a skill ---------------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "run-skill") return;
  const abort = new AbortController();
  port.onDisconnect.addListener(() => abort.abort());

  port.onMessage.addListener(async (msg) => {
    const post = (m) => {
      try {
        port.postMessage(m);
      } catch {
        /* tab closed */
      }
    };
    const { apiKey, model, effort } = await settings();
    if (!apiKey) {
      post({ type: "error", code: "no-key", message: "Add your OpenRouter API key in the extension options first." });
      return;
    }

    let req;
    try {
      req = buildRequest(msg.context, { skillId: msg.skillId, instruction: msg.instruction });
    } catch (e) {
      post({ type: "error", message: String(e.message || e) });
      return;
    }

    try {
      const result = await streamChat({
        apiKey,
        model,
        effort,
        system: req.system,
        user: req.user,
        signal: abort.signal,
        onText: (delta) => post({ type: "delta", text: delta }),
      });
      post({ type: "done", stopReason: result.finishReason, usage: result.usage });
    } catch (e) {
      if (e.name === "AbortError") return;
      post({ type: "error", code: e.code, message: e.message || String(e) });
    }
  });
});
