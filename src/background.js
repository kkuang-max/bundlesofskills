// MV3 service worker. Owns the keys (OpenRouter, optional Figma token) and every
// network call; the page only ever gets results back. Also: hotkeys, tab
// screenshots for canvas apps / lasso / images, and the Figma REST calls.
import { DEFAULTS, streamChat } from "./openrouter.js";
import { buildRequest, normalizeLibrary } from "./library.js";
import { figmaComment, figmaFrame } from "./figma.js";
import { addEntry, makeEntry, mutateHistory, updateEntry } from "./history.js";
import { defang, redact, report, scanOutput, scanText, summarize } from "./security.js";

// A worker that died mid-run leaves "running" entries behind; settle them.
mutateHistory((h) => h.map((e) => (e.status === "running" ? { ...e, status: "stopped" } : e)));

async function settings() {
  return chrome.storage.local.get({ apiKey: "", model: DEFAULTS.model, effort: DEFAULTS.effort, figmaToken: "" });
}
async function library() {
  const { library } = await chrome.storage.local.get("library");
  return normalizeLibrary(library);
}
function openStudio(hash = "") {
  chrome.tabs.create({ url: chrome.runtime.getURL("studio.html") + (hash ? `#${hash}` : "") });
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

chrome.action.onClicked.addListener(() => openStudio());

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
      openStudio(msg.hash);
      return;
    case "capture":
      // Screenshot of the visible tab; the content script crops it.
      return reply(chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }).then((dataUrl) => ({ dataUrl })));
    case "figma-frame":
      return reply(settings().then((s) => figmaFrame(s.figmaToken, msg.fileKey, msg.nodeId)));
    case "figma-comment":
      return reply(settings().then((s) => figmaComment(s.figmaToken, msg.fileKey, msg.nodeId, msg.message)));
    case "open-run":
      // Studio/History → the page an answer was made on: switch to (or open) it and jump there.
      return reply((async () => {
        await chrome.storage.local.set({ pendingJump: { url: msg.url, historyId: msg.historyId, at: Date.now() } });
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => t.url && t.url.split("#")[0] === msg.url.split("#")[0]);
        if (tab) {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
          await chrome.storage.local.remove("pendingJump");
          await chrome.tabs.sendMessage(tab.id, { type: "jump", historyId: msg.historyId }).catch(() => {});
        } else await chrome.tabs.create({ url: msg.url });
        return { ok: true };
      })());
    case "history-update":
      // The page reports what happened after generation: approved / posted / discarded.
      return reply(mutateHistory((h) => updateEntry(h, msg.id, { status: msg.status, ...(msg.final != null ? { final: msg.final } : {}) })).then(() => ({ ok: true })));
  }
});

// --- running a skill (streamed over a Port) ------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "run-skill") return;
  const abort = new AbortController();
  port.onDisconnect.addListener(() => abort.abort());
  let started = false;
  let decide = null; // resolves the Security guard's question

  port.onMessage.addListener(async (msg) => {
    if (msg?.type === "stop") {
      decide?.("cancel");
      return abort.abort();
    }
    if (msg?.type === "guard-decision") return decide?.(msg.choice);
    if (started) return;
    started = true;
    const post = (m) => {
      try {
        port.postMessage(m);
      } catch {
        /* tab closed */
      }
    };
    const [{ apiKey, model, effort }, lib, { securityGuard }] = await Promise.all([settings(), library(), chrome.storage.local.get({ securityGuard: true })]);
    // The Studio's "Try it" sends a draft skill that isn't saved yet.
    const skill = msg.skill || (msg.skillId ? lib.skills.find((s) => s.id === msg.skillId) : null);
    const pet = msg.petId ? lib.pets.find((p) => p.id === msg.petId) : null;
    const newId = () => `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    // Security's on-device skills: checked here, never sent anywhere.
    if (skill?.local === "injection" || skill?.local === "sensitive") {
      const id = newId();
      const text = report(skill.local, msg.context?.text || "");
      const entry = { ...makeEntry({ id, source: msg.source === "studio" ? "studio" : "page", context: msg.context, skill, pet, label: msg.label }), status: "done", output: text, security: { sentTo: "on-device" } };
      await mutateHistory((h) => addEntry(h, entry));
      post({ type: "started", historyId: id, onDevice: true });
      post({ type: "delta", text });
      post({ type: "done", historyId: id, onDevice: true });
      return;
    }

    if (!apiKey) {
      post({ type: "error", code: "no-key", message: "Add your OpenRouter API key in the extension options first." });
      return;
    }

    // The Security guard: check what's about to leave the browser. Runs here, in the
    // service worker, so no page script can skip it.
    let context = msg.context || {};
    const security = { sentTo: "openrouter.ai", guard: Boolean(securityGuard) };
    if (securityGuard && context.text) {
      const findings = scanText(context.text);
      if (findings.length) {
        const summary = summarize(findings);
        post({ type: "guard", phase: "input", summary });
        const choice = await new Promise((resolve) => (decide = resolve));
        decide = null;
        security.input = { groups: summary.groups, decision: choice };
        if (choice === "cancel") {
          const id = newId();
          await mutateHistory((h) => addEntry(h, { ...makeEntry({ id, source: msg.source === "studio" ? "studio" : "page", context, skill, pet, instruction: msg.instruction, label: msg.label, request: msg.request }), status: "blocked", security }));
          post({ type: "blocked", historyId: id });
          return;
        }
        if (choice === "redact") {
          const r = redact(context.text, findings);
          context = { ...context, text: r.text };
          security.redacted = r.count;
        }
      }
    }

    let req;
    try {
      req = buildRequest(context, { skill, instruction: msg.instruction, pet, request: msg.request });
    } catch (e) {
      post({ type: "error", message: String(e.message || e) });
      return;
    }

    // Log the run before it starts, so the history shows it while it's generating.
    const id = newId();
    const entry = { ...makeEntry({ id, source: msg.source === "studio" ? "studio" : "page", context, skill, pet, instruction: msg.instruction, label: msg.label, request: msg.request }), security };
    await mutateHistory((h) => addEntry(h, entry));
    post({ type: "started", historyId: id, redacted: security.redacted || 0 });
    const t0 = Date.now();
    let output = "";

    try {
      const result = await streamChat({
        apiKey,
        model,
        effort,
        system: req.system,
        content: req.content,
        signal: abort.signal,
        onText: (delta) => {
          output += delta;
          post({ type: "delta", text: delta });
        },
      });
      // Untrusted output: check it before the page offers to apply or post it.
      if (securityGuard) {
        const out = scanOutput(result.text);
        if (out.length) {
          const summary = summarize(out);
          security.output = { groups: summary.groups };
          // Links that carry data out and invisible text are removed, not just flagged.
          const safeText = defang(result.text, out);
          post({ type: "guard", phase: "output", summary, safeText: safeText !== result.text ? safeText : null });
        }
      }
      await mutateHistory((h) => updateEntry(h, id, { status: "done", output: result.text, ms: Date.now() - t0, security }));
      post({ type: "done", historyId: id, stopReason: result.finishReason, usage: result.usage });
    } catch (e) {
      if (e.name === "AbortError") {
        await mutateHistory((h) => updateEntry(h, id, { status: "stopped", output, ms: Date.now() - t0 }));
        post({ type: "stopped", historyId: id });
        return;
      }
      await mutateHistory((h) => updateEntry(h, id, { status: "error", output, error: e.message || String(e), ms: Date.now() - t0 }));
      post({ type: "error", code: e.code, message: e.message || String(e) });
    }
  });
});
