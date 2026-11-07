# Skill Pet: MVP

A working prototype of the **Skill Companion** concepts: a small pet that runs Claude skills on whatever you're pointing at. It has no polished UI yet; the goal is to show how the interaction works and to test whether the idea holds up.

It's a **Chrome extension (Manifest V3)**. It builds two of the ten concepts end to end (**07 Peek** and **08 Burrow**), the context "sniffing" behind **01 Fetch**, and the "rerun last trick" from **02 Tap wheel**.

## How you use it

| Trigger | What happens | Concept |
|---|---|---|
| **Select text** on any page | The pet peeks out under the selection with its 3 best guesses for *this* spot. If you ignore it, it ducks away after 4 s. Clicking elsewhere or pressing Esc dismisses it. | 07 Peek |
| **Alt+Shift+P** (or right-click › *Ask the pet…*) | A search-first command bar opens. Type to filter skills, or type anything and pick *Ask: "…"* to run a free-form request. ↑↓ ↵ to pick and run. | 08 Burrow |
| **Alt+Shift+R** | Reruns the last skill on the current selection, with no menu. | 02 Tap (triple-tap) |
| Result panel | The answer streams in. **Copy**, **Replace selection** (writes back into the textarea or contenteditable you selected from, keeping undo), **Run again**. | |

Shortcuts can be rebound at `chrome://extensions/shortcuts`.

### How it guesses ("sniffing")

`src/skills.js` scores every skill against a context snapshot:

- **site**: Gmail/Outlook/Slack favour *Draft a reply*, Docs/Notion favour *Action items*, GitHub/StackOverflow favour *Explain this code*
- **is the selection editable?** Editable text favours *Fix grammar / Tighten / Soften*; read-only text favours *Summarize / Explain*
- **what the text looks like**: length, dates in it, code-looking, non-Latin script
- **your habits**: each use of a skill nudges it up (capped)

The command bar puts prefix matches above this score. All of it is pure, unit-tested logic (`test/skills.test.js`). Adding a skill means adding one object to the `SKILLS` array.

## Architecture

```
 page (any site)                         extension service worker              Claude API
┌───────────────────────────┐  Port   ┌──────────────────────────────┐  HTTPS ┌──────────┐
│ content.js                │────────▶│ background.js                │───────▶│ messages │
│  • reads selection/context│ context │  • holds API key (storage)    │ stream │ .stream  │
│  • Peek / bar / result UI │◀────────│  • @anthropic-ai/sdk stream  │◀───────│          │
│    in a closed shadow root│  deltas │  • hotkeys, context menu     │        └──────────┘
│  • writes result back     │         └──────────────────────────────┘
└───────────────────────────┘
```

- The UI lives in a **closed shadow root**, so page CSS can't break it and page JS can't reach it.
- The **API key never enters the page**. Only the service worker reads it from `chrome.storage.local`.
- The selection goes to the model wrapped in `<selected_content>`, and the system prompt treats it as data, not instructions. This is a basic guard against prompt injection from web pages.
- Model `claude-opus-5-5` at `effort: low` (quick skills should feel instant). Both can be changed in Options. The server-side refusal fallback is turned on.

## Run it

```bash
cd hackathon
npm install
npm run build
```

1. Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder.
2. The options page opens. Paste an Anthropic API key and save.
3. Select some text on any page, or press **Alt+Shift+P**.

### Tests

```bash
npm test
```

```bash
npm run build && npm run e2e
```

`npm test` runs the ranking/prompt unit tests. `npm run e2e` loads the real extension in headless Chromium with a **faked** Claude API, then walks through peek → missing-key error → command bar → streamed result → Replace selection. Screenshots go to `test/screenshots/`.

## Feasibility: extension vs. desktop app

**Short answer: build it in two stages.** A browser extension gets you about 70% of the experience in days. "Any app on my computer" needs a native desktop app, which is quite doable but is a real project with OS permission prompts.

### What a browser extension can and can't do

| | |
|---|---|
| ✅ Read the selection, the page title and the site | `window.getSelection()`, input `selectionStart/End` |
| ✅ Write back into text fields and most rich editors | `setRangeText`; `execCommand('insertText')` keeps the editor's undo |
| ✅ Hotkeys | `chrome.commands`, but **only while Chrome is focused**. There's a hard limit of 4 suggested shortcuts, and they need Ctrl/Alt (+Shift). A bare double-tap of ⌥ is impossible. |
| ✅ Drag-and-drop files *onto the pet* inside a page | Standard DnD. Good enough for a browser-only "Feeding bowl". |
| ⚠️ **Google Docs** | Docs draws text on a **canvas**, so `getSelection()` comes back empty. Workarounds: use the Docs API through an add-on, or simulate copy and read the clipboard. Office Online and Figma have the same problem. Not handled in this MVP. |
| ⚠️ Iframes / shadow-DOM editors | You need `all_frames: true` and per-site handling. |
| ❌ Other apps (Mail.app, Figma desktop, Slack desktop, VS Code…) | Out of reach. |
| ❌ `chrome://` pages, the Web Store, the built-in PDF viewer | Content scripts are blocked there. |

### Desktop app (Tauri or Electron), for "any app"

| Need | How | Effort |
|---|---|---|
| Global hotkey, even with Chrome in the background | Electron `globalShortcut` / Tauri `global-shortcut` plugin | Easy |
| Double-tap ⌥ or Fn (concepts 02, 09) | Low-level key monitor: macOS `CGEventTap` needs **Input Monitoring** permission; Windows uses a `SetWindowsHookEx` LL hook | Medium |
| Read the selection in any app | macOS Accessibility API (`AXSelectedText`), which needs **Accessibility** permission. Fallback: simulate ⌘C, read the clipboard, then restore it. Windows: UI Automation `TextPattern`. | Medium; works in most native apps, while Electron and canvas apps need the clipboard fallback |
| Pet floating over everything, burrow in the menu bar (01, 03, 08) | Transparent, always-on-top, click-through window plus a tray/menu-bar icon | Easy |
| Drop the pet *onto* a spot in another app (01 Fetch) | Hit-testing another app's UI: `AXUIElementCopyElementAtPosition` on macOS | Hard, and the payoff is mostly flair. Ship Peek first. |
| Detect a selection in any app without a hotkey (07 Peek) | Poll or observe AX selection-change notifications per app | Medium. Battery and noise are the risk, so ship it opt-in per app. |
| Voice (09 Whistle) | Push-to-talk, then on-device or cloud speech-to-text, then the same skill runner | Medium |

### The 10 concepts, ranked by how cheaply you can prove them

1. **08 Burrow** (hotkey command bar): ✅ built. Lowest risk, works everywhere.
2. **07 Peek** (select → guesses): ✅ built. The magic moment. The risk is that it gets annoying, so it has an ignore timeout, a per-site blocklist and an off switch.
3. **01 Fetch** (context-ranked skills): ✅ ranking built. Dragging the pet onto a spot needs the desktop app.
4. **02 Tap wheel**: ✅ "rerun last" built. A radial menu is a UI swap on the bar. A true double-tap needs the desktop app.
5. **05 Charm collar** (loadouts with shared docs): next step. Add `loadouts: {skills[], contextFiles[]}` and auto-equip by site. Pure data, no new platform work.
6. **06 Feeding bowl**: feasible in the extension for in-page drops and pasted screenshots (Claude reads images). Dropping from the Finder or Desktop needs the desktop app.
7. **03 Skill stickers**: the "badge stays on the content" part means anchoring to other apps' DOM, which is fragile. Do it in-browser only, if at all.
8. **04 Pet squad**: per-pet permissions are a product/data-model decision rather than a platform blocker.
9. **10 Trick trail**: chaining is easy on the backend (feed output N into skill N+1). The hopping-pet UI is the real work.
10. **09 Whistle**: needs the desktop app and speech. Do it last.

### Before this is a product, not a demo

- **No API key in the client.** Put a small backend in front of the API (auth, rate limits, usage metering). Today each user pastes their own key, which is fine for an MVP and nothing more.
- **Privacy.** Peek reads selections all the time, though only *locally*. Nothing is sent until you click a skill. Keep it that way, and say so in onboarding.
- **Chrome Web Store review.** The `<all_urls>` content script draws extra scrutiny. Expect a justification step, or switch to `activeTab` and inject on demand, which costs you Peek.
