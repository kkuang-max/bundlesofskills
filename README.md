# Skill Pet

A Chrome extension prototype of the **Skill Companion** concepts. You keep a **squad of pets**, each one a group of AI skills with its own permissions. **Drag a pet onto your work** (a paragraph, a text field, an image, a Google Docs page, a Figma frame) and it offers only the skills that fit what's there. Anything that would change your work is a **proposal you approve** first. Models are called through **[OpenRouter](https://openrouter.ai)**.

## The pieces

### 1. Skill Studio: make skills, stickers and pets

Open it by clicking the extension's toolbar icon, or from Options. Everything is on one page:

- **Skills.** 19 templates, plus your own. Each skill has:
  - an instruction
  - **Works on**: text, editable text, images, Figma frames
  - **Result**: show an answer, rewrite the original after you approve, or leave a Figma comment after you approve
  - which apps it ranks higher in
  - a **sticker** (label, color, shape)

  Use `{{request}}` in an instruction to ask for details when the skill runs ("Rewrite this: {{request}}"). Every skill has a **Try it** box (paste text and/or add an image). Templates can be edited and reset.
- **Pet squad = skill groups.** Drag a skill from the list onto a pet to teach it; × removes it. Each pet has a name, role and color. It also has **permissions**: *can read text*, *can read images & frames*. A pet is never sent what it isn't allowed to read. You can also set which app a pet comes first in. *Adopt* makes a new pet; *Release* removes one.
- **Import / Export** the whole library as JSON to share a squad.

Edits apply to open tabs immediately; no rebuild.

### Characters

Each pet is one of seven characters: **cat, dog, bird, frog, bunny, bear, ghost**. They're drawn as SVG, with an open face and a happy ^^ face shown on hover and while working. The default squad is Scout the dog, Quill the bird, Pixel the cat and Sprout the frog. In the Studio, each pet card has a character picker and color swatches, and *Adopt* picks a character the squad doesn't have yet. Pets saved before characters existed are migrated automatically.

### 2. On any page: the squad dock (04 Pet squad)

| Do this | What happens |
|---|---|
| **Drag a pet** onto something | A dashed outline shows what it will read ("Text", "Image", "Text field", "Selected Figma frame", "This page (screenshot)"). Drop, and the **pet card** opens with that pet's skills that fit, plus an *Ask Quill…* box. |
| **Select** (dock button or **Alt+Shift+L**) | Like a design tool: hover highlights the paragraph, image, field or frame under the pointer, and **click** picks it. **Drag** a box to take exactly the words, images and canvas inside it. **Shift-click** adds more, and **Enter** finishes. Then drag a pet onto it, or press 1–9. |
| **Click a pet** | Uses what you picked with Select, or else your text selection. |
| **History** (dock button) | What the pets generated on this site (see below). |
| **Search** (dock button or **Alt+Shift+P**) | The command bar from v1, now over every pet's skills, showing which pet owns each. |
| **Select text** | Peek: the top 3 guesses pop up beside it (turn this off in Options). |
| **Alt+Shift+S** / **Alt+Shift+R** | Show/hide the squad · rerun the last skill on the current pick. |

### Minimized squad, hover cards, shortcuts

- **Minimize** (the – at the end of the bar, or in Options) shrinks the squad to **small pets** or **dots** (pick in Options). It expands on its own while you **hover** it, **select text**, use **Select**, have a **pick**, **drag** a pet, or use a pet's card. Then it shrinks back.
- **Hover a pet** to see what it can do: its skills with stickers, which ones rewrite or comment (after you approve), what it may read, and its shortcut. If you have selected something, skills that don't fit it are dimmed ("For your pick: 3 fit").
- **Shortcuts** (⌥ = Alt; **Alt+/** shows them all on the page):

| Keys | Does |
|---|---|
| **Alt+click** / **Alt+drag** anywhere | Select the thing under the pointer / everything in a box, right away |
| **Alt+Shift+L** | Select tool. **Shift-click** adds more, **Enter** finishes |
| **1–9** (when something is picked/selected and you're not typing) | Send it to pet 1–9 |
| **Alt+1–9** | Same, and works while typing (uses the text selected in the field) |
| In a pet's card: **1–9**, **↑↓**, **/** | Run skill n · move · ask anything |
| **Esc** | Cancel selecting / clear the selection / close |
| **Alt+Shift+P / H / S / R** | Search · History · show/hide squad · rerun last |

### Markdown answers

Answers render as formatted Markdown: headings, **bold**, *italic*, `code`, code blocks, bullet and numbered lists (nested), checklists, quotes, tables and links. The renderer builds page elements directly, so model text is never inserted as HTML, and links only work if they're http(s) or mailto. The prompt asks for Markdown when it helps scanning; rewrites and Figma comments stay plain text, because they go straight into your document. **Copy** puts rich text on the clipboard, so pasting into Docs or Gmail keeps the formatting, and plain-text apps get the Markdown.

### Pets stay where they worked (pins)

After a pet generates something, it **stays on the page at that exact spot** as a small pin:
- on the element you dropped it on, at the point where you dropped it
- or at the corner of your selection or Select pick

The pin is attached to the content, so it scrolls and reflows with the page, and it's **saved per page**: next time you open the page, the pins are back where they were. If a site re-renders, the extension finds the element again by its position in the page structure.

- **Hover** a pin to outline what it worked on. **Click** it to reopen everything generated there: rendered Markdown, quiz answers still hidden until you reveal them, what was applied or posted, and Copy.
- **Do more here:** from the pin, pick any pet and run another skill on the same spot, or **ask a follow-up**. Follow-ups include the earlier answers, so "make it shorter" or "turn that into a table" work. New runs on the same spot join the same pin (the badge shows how many).
- **Figma:** the pet sits inside the frame, where you dropped it, with a *Posted* badge once you approve the comment. The Figma comment itself is pinned inside the frame (24px in from its top-left corner) rather than on its edge. If you pan or zoom the Figma canvas, the pet pin doesn't move with it, because Figma doesn't share where the frame is on screen. The real Figma comment always stays on the frame.
- Pins can be turned off in Options, removed one at a time from the pin card, and keep the 60 most recent pages.

### The selection is pinned to the page

What you pick with **Select** isn't a floating overlay. Each part is attached to the element it came from (a box is attached to that spot in the document). Its outline scrolls with the page and follows layout changes, and you can still drop a pet on it after scrolling. While the Select tool is open, the scroll wheel still scrolls the page, or the inner scroller under your pointer. The tool's full-screen layer only exists while you're picking; once you finish, the page is fully clickable again and only the outline stays.

### Long answers and quizzes

- Answers scroll inside the panel. This works even on Figma and Google Docs, which normally swallow the scroll wheel. The panel only follows new text while you're at the bottom, so you can scroll up and read during generation.
- **Expand** (⤢ in the panel header) opens a large reading view. The page's History panel and the Studio's history items also have Expand.
- **Reveal later:** *Quiz me* and *Make flashcards* show the questions with the answers hidden behind blurred cards. Click one to reveal it, or **Reveal all**. Answers stay hidden while generating too. Any skill can do this: tell it to print a line `=== ANSWERS ===` before the answers.

### 3. History and loading

- **Every generation is logged**, from pages and from the Studio's *Try it*. Each entry records the skill, the pet, the site, what it read, the output, and what happened next: *Generated*, *Approved & applied* (including your edits before approving), *Posted to Figma*, *Discarded*, *Stopped* or *Failed*.
  - **On a page:** the dock's **History** button opens a panel showing what was generated **on this site**. Switch to *Everywhere*, search, copy.
  - **In the Studio:** the **History** tab has the full log. Filter by pages vs. Studio tests and by site, search, see input and output side by side, copy, delete, clear.
  - Stored locally (last 300 runs). Images aren't kept, only a count.
- **Loading states:**
  - While generating, the panel shows the pet hopping, "Quill is rewriting…", what's being sent, an elapsed timer, skeleton lines and a **Stop** button. Text then streams in with a cursor.
  - "Sniffing…" shows while a pet reads a Figma frame or takes a screenshot, and "Reading your pick…" while a Select pick is processed.
  - The Studio's *Try it* has its own loader and a Stop button.

### 4. Context awareness: what it knows from what you picked

| You picked… | It reads | Skills offered | Can change it? |
|---|---|---|---|
| A paragraph / heading / selection | the text | text skills (summarize, explain, dates…) | — |
| A text field, Gmail draft, any rich editor | the text, marked *editable* | rewrite skills too (fix, tighten, soften, "rewrite as I ask") | **Yes**: you see original vs. proposed, can edit the proposal, then **Approve & replace** (undo still works) |
| An image | a screenshot of it | image skills (describe, critique, microcopy) | — |
| A **Figma** frame | the frame selected in Figma (from the URL's `node-id`). With a Figma token: a crisp render plus its text layers. Without one: a screenshot. | design skills | **Comments**: *Leave critique as comment* proposes a comment; **Approve & post** pins it to that frame through the Figma API |
| **Google Docs / Sheets / Slides** page | a screenshot (these apps draw on a canvas, so there's no readable text) | text + image skills | Copy only |
| A **Select** pick (one or more things, or a box) | each thing as above; a box takes the words inside it plus a screenshot if it holds images or a canvas | whatever fits all of it | One selected field can be rewritten |

Ranking also uses the app (Figma → design skills first, wikis → research), signals in the text (dates, non-Latin script), length, and what you use most. Nothing is sent to the model until you click a skill.

### Works on

Any normal site (wikis, news, docs sites, GitHub, Notion…), Gmail/Outlook (rewrite drafts in place), **Google Docs/Sheets/Slides** (by screenshot), **Figma** in the browser (frames, comments). It doesn't run on `chrome://` pages, the Chrome Web Store, or the built-in PDF viewer.

## Setup

```bash
git clone https://github.com/kkuang-max/hackathon && cd hackathon
npm install && npm run build
```

1. In `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder. If it's already loaded, click the reload arrow instead.
2. Options opens. Paste your **OpenRouter key**. Pick a **vision-capable model** (needed for images, Figma and Docs screenshots), e.g. a Claude, GPT-4o-class or Gemini model from [openrouter.ai/models](https://openrouter.ai/models).
3. *Optional:* paste a **Figma personal access token** (Figma › Settings › Security; file read + comments write) to enable frame text and comments.
4. Reload any tabs that were already open. The squad appears at the bottom of every page.

## How it's built

```
 page (any site)                              service worker                     outside
┌────────────────────────────────┐ Port  ┌───────────────────────────┐
│ content.js                     │──────▶│ background.js             │──▶ openrouter.ai (stream)
│  dock · drag · select · cards  │◀──────│  keys live only here      │
│  reads text / screenshots      │       │  captureVisibleTab        │──▶ api.figma.com
│  approve → write back          │       │  figma.js (frame, comment)│
└────────────────────────────────┘       └───────────────────────────┘
 studio.html / studio.js ── chrome.storage.local "library" ──▶ every tab, live
 library.js: templates, default squad, matching, permissions, request building
```

- The UI is in a closed shadow root, so page CSS/JS can't touch it or read results. Keys never enter the page.
- Picked content goes to the model inside `<picked_content>`, and the system prompt treats it as data, not instructions.
- `library.js` is pure and unit-tested. Skills and pets are plain JSON, so anything the Studio makes can be exported.

## Tests

```bash
npm test
```

```bash
npm run e2e
```

`npm test` has 26 unit tests covering matching, permissions, Figma URL parsing, request building, history and the OpenRouter client. `npm run e2e` loads the real extension in Chromium with OpenRouter and the Figma API **faked**, then checks:
- drag Quill onto a field → approve a rewrite (and that nothing changes before approval)
- drag Pixel onto an image → a screenshot is sent
- box-select a paragraph → click Scout → summarize
- the search bar
- a fake Figma file → drag Pixel onto the frame → approve → a comment is posted to node `12:34` with the frame's text layers in the prompt
- Studio: drag a skill onto a pet, create a new skill and assign it
- minimize to small pets / dots, expand on hover, selection and Select, hover cards, Alt+1 / 1–9 / Alt-drag box select / click + Shift-click select / Alt+/;
- the selection stays pinned to the paragraph when scrolling and is still a drop target; the page scrolls under the Select tool;
- answers render as Markdown (heading, bold, table, checklist), no raw syntax;
- pins: a pet is left where it worked, scrolls with the page, reopens answers, runs more skills and follow-ups on the same spot, survives a reload; the Figma pin sits in the frame with a Posted badge, and the comment is placed inside the frame;
- characters: species per pet, switching one in the Studio updates the dock live;
- a long quiz answer scrolls even when the page swallows wheel events, the panel expands, and answers stay hidden until clicked;
- the loading screen appears while generating; history logs approved / posted / Studio-test runs; the in-page History panel and the Studio History tab

Screenshots go to `test/screenshots/`.

## Known limits

- **Editing Figma layers** (changing text in the file) isn't possible from a browser extension. The REST API can read and comment, not edit, so that needs a small Figma plugin. Today pets propose new copy, which you can copy or post as a comment.
- **Google Docs**: the extension reads by screenshot and can't write back into the doc. Commenting into Docs would need the Docs API (OAuth) or a Docs add-on.
- **Screenshots only cover what's visible.** Scroll so the thing is on screen first.
- **Key handling**: each user brings their own OpenRouter key. A real product would put a backend in front.

## Feasibility: extension vs. desktop app

**Short answer: build it in two stages.** A browser extension gets you about 70% of the experience in days. "Any app on my computer" needs a native desktop app, which is quite doable but is a real project with OS permission prompts.

### What a browser extension can and can't do

| | |
|---|---|
| ✅ Read the selection, the page title and the site | `window.getSelection()`, input `selectionStart/End` |
| ✅ Write back into text fields and most rich editors | `setRangeText`; `execCommand('insertText')` keeps the editor's undo |
| ✅ Hotkeys | `chrome.commands`, but **only while Chrome is focused**. There's a hard limit of 4 suggested shortcuts, and they need Ctrl/Alt (+Shift). A bare double-tap of ⌥ is impossible. |
| ✅ Drag-and-drop files *onto the pet* inside a page | Standard DnD. Good enough for a browser-only "Feeding bowl". |
| ⚠️ **Google Docs** | Docs draws text on a **canvas**, so `getSelection()` comes back empty. This build reads it by **screenshot + a vision model** (drag a pet onto the page, or use Select). Writing back needs the Docs API through an add-on. |
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

1. **08 Burrow** (hotkey command bar): ✅ built (the Search button). Lowest risk, works everywhere.
2. **07 Peek** (select → guesses): ✅ built. The magic moment. The risk is that it gets annoying, so it has an ignore timeout, a per-site blocklist and an off switch.
3. **01 Fetch** (drop the pet on a spot): ✅ built in the browser. Doing it in other desktop apps needs the desktop app.
4. **02 Tap wheel**: ✅ "rerun last" built. A radial menu is a UI swap on the bar. A true double-tap needs the desktop app.
5. **05 Charm collar** (loadouts with shared docs): next step. Pets already act as loadouts; shared docs are the missing part. Add `loadouts: {skills[], contextFiles[]}` and auto-equip by site. Pure data, no new platform work.
6. **06 Feeding bowl**: feasible in the extension for in-page drops and pasted screenshots (vision models read images). Dropping from the Finder or Desktop needs the desktop app.
7. **03 Skill stickers**: every skill has a sticker in the Studio, shown in pet cards. Sticking one onto content as a lasting badge: the "badge stays on the content" part means anchoring to other apps' DOM, which is fragile. Do it in-browser only, if at all.
8. **04 Pet squad**: ✅ built: the dock, pets as skill groups, per-pet permissions, Studio.
9. **10 Trick trail**: chaining is easy on the backend (feed output N into skill N+1). The hopping-pet UI is the real work.
10. **09 Whistle**: needs the desktop app and speech. Do it last.

### Before this is a product, not a demo

- **No API key in the client.** Put a small backend in front of the API (auth, rate limits, usage metering). Today each user pastes their own key, which is fine for an MVP and nothing more.
- **Privacy.** Peek reads selections all the time, though only *locally*. Nothing is sent until you click a skill. Keep it that way, and say so in onboarding.
- **Chrome Web Store review.** The `<all_urls>` content script draws extra scrutiny. Expect a justification step, or switch to `activeTab` and inject on demand, which costs you Peek.
