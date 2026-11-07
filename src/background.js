// MV3 service worker. Owns the keys (OpenRouter, optional Figma token) and every
// network call; the page only ever gets results back. Also: hotkeys, tab
// screenshots for canvas apps / lasso / images, and the Figma REST calls.
import { DEFAULTS, streamChat } from "./openrouter.js";
import { buildRequest, normalizeLibrary } from "./library.js";
import { figmaComment, figmaFrame } from "./figma.js";

async function settings() {
  return chrome.storage.local.get({ apiKey: "", model: DEFAULTS.model, effort: DEFAULTS.effort, figmaToken: "" });
}
async function library() {
  const { library } = await chrome.storage.local.get("library");
  return normalizeLibrary(library);
}
function openStudio() {
  chrome.tabs.create({ url: chrome.runtime.getURL("studio.html") });
}

// --- entry points ---------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command, tab) => {
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: command }).catch(() => {
    // No content script here (chrome:// pages, Web Store, PDF viewer, or a tab
    // opened before install: reload it).
  });
});

chrome.action.onClicked.addListener(openStudio);

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.create({ id: "summon", title: "Ask the pet…", contexts: ["selection", "editable", "page", "image"] });
  chrome.contextMenus.create({ id: "studio", title: "Open Skill Studio", contexts: ["action"] });
  if (details.reason === "install") chrome.runtime.openOptionsPage();
  const { library: stored } = await chrome.storage.local.get("library");
  if (!stored) await chrome.storage.local.set({ library: normalizeLibrary(null) });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "studio") return openStudio();
  if (info.menuItemId === "summon" && tab?.id) chrome.tabs.sendMessage(tab.id, { type: "summon", srcUrl: info.srcUrl }).catch(() => {});
});

// --- one-shot requests from pages ---------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = (p) => {
    p.then(sendResponse, (e) => sendResponse({ error: e.message || String(e) }));
    return true; // async
  };
  switch (msg?.type) {
    case "open-options":
      chrome.runtime.openOptionsPage();
      return;
    case "open-studio":
      openStudio();
      return;
    case "capture":
      // Screenshot of the visible tab; the content script crops it.
      return reply(chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }).then((dataUrl) => ({ dataUrl })));
    case "figma-frame":
      return reply(settings().then((s) => figmaFrame(s.figmaToken, msg.fileKey, msg.nodeId)));
    case "figma-comment":
      return reply(settings().then((s) => figmaComment(s.figmaToken, msg.fileKey, msg.nodeId, msg.message)));
  }
});

// --- running a skill (streamed over a Port) ------------------------------------------
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
    const [{ apiKey, model, effort }, lib] = await Promise.all([settings(), library()]);
    if (!apiKey) {
      post({ type: "error", code: "no-key", message: "Add your OpenRouter API key in the extension options first." });
      return;
    }
    // The Studio's "Try it" sends a draft skill that isn't saved yet.
    const skill = msg.skill || (msg.skillId ? lib.skills.find((s) => s.id === msg.skillId) : null);
    const pet = msg.petId ? lib.pets.find((p) => p.id === msg.petId) : null;

    let req;
    try {
      req = buildRequest(msg.context, { skill, instruction: msg.instruction, pet, request: msg.request });
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
        content: req.content,
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
