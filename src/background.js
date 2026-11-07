// MV3 service worker: owns the API key and the Claude call, relays hotkeys to
// the tab. The page never sees the key; the content script talks to us over a
// runtime Port and gets streamed text back.
import Anthropic from "@anthropic-ai/sdk";
import { buildRequest } from "./skills.js";

const DEFAULT_MODEL = "claude-opus-5-5";

async function settings() {
  const s = await chrome.storage.local.get({ apiKey: "", model: DEFAULT_MODEL, effort: "low" });
  return s;
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "open-options") chrome.runtime.openOptionsPage();
  if (msg?.type === "has-key") {
    settings().then((s) => sendResponse({ hasKey: Boolean(s.apiKey) }));
    return true;
  }
});

// --- Running a skill ---------------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "run-skill") return;
  let stream = null;
  port.onDisconnect.addListener(() => stream?.abort());

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
      post({ type: "error", code: "no-key", message: "Add your Anthropic API key in the extension options first." });
      return;
    }

    let req;
    try {
      req = buildRequest(msg.context, { skillId: msg.skillId, instruction: msg.instruction });
    } catch (e) {
      post({ type: "error", message: String(e.message || e) });
      return;
    }

    // MVP only: calling the API straight from the extension with the user's own
    // key. A shipped product would route through its own backend instead.
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    try {
      stream = client.beta.messages.stream({
        model,
        max_tokens: 16000,
        output_config: { effort },
        // Server-side refusal fallback: if the main model declines, the API
        // retries on a fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
      stream.on("text", (delta) => post({ type: "delta", text: delta }));
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        post({ type: "error", message: "The model declined this one." });
      } else {
        post({ type: "done", stopReason: final.stop_reason, usage: final.usage });
      }
    } catch (e) {
      if (e instanceof Anthropic.APIUserAbortError) return;
      let message = String(e?.message || e);
      if (e instanceof Anthropic.AuthenticationError) message = "That API key was rejected. Check it in the options.";
      else if (e instanceof Anthropic.RateLimitError) message = "Rate limited. Try again in a moment.";
      else if (e instanceof Anthropic.APIConnectionError) message = "Couldn't reach the Claude API.";
      post({ type: "error", message });
    }
  });
});
