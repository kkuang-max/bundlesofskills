// End-to-end: loads the unpacked extension in Chromium and fakes OpenRouter and
// the Figma API. Walks: squad dock → drag a pet onto a text field → approve a
// rewrite; drag onto an image (screenshot goes to the model); lasso a paragraph
// → click a pet; search bar; a fake Figma file → approve & post a comment;
// Skill Studio → drag a skill onto a pet, create a skill.
// Run: npm run build && npm run e2e   (screenshots → test/screenshots/)
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");

const EXT = path.resolve(__dirname, "../extension");
const SS = path.resolve(__dirname, "screenshots") + "/";
fs.mkdirSync(SS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: SS + name + ".png" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIGMA_PAGE = `<!doctype html><html><head><title>Checkout flow – Figma</title></head><body style="margin:0;background:#E5E5E5">
<div style="height:48px;background:#2C2C2C"></div><canvas id="c" width="1000" height="560" style="display:block"></canvas>
<script>const g=document.getElementById('c').getContext('2d');g.fillStyle='#fff';g.fillRect(300,60,260,440);g.fillStyle='#3A6FD8';g.fillRect(330,420,200,44);g.fillStyle='#D9D4C9';g.fillRect(330,100,160,20);</script></body></html>`;
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

(async () => {
  const srv = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(fs.readFileSync(path.join(__dirname, "fixture.html"))); }).listen(8765);
  const ctx = await chromium.launchPersistentContext("", { headless: true, channel: "chromium", args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], viewport: { width: 1100, height: 760 } });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const extId = new URL(sw.url()).host;

  // ---- fakes
  const calls = [];
  await ctx.route("https://openrouter.ai/**", async (route) => {
    const body = JSON.parse(route.request().postData());
    calls.push(body);
    await sleep(1200); // so the loading state is visible
    const sys = body.messages[0].content;
    const user = JSON.stringify(body.messages[1].content);
    const text = /=== ANSWERS ===/.test(user)
      ? Array.from({ length: 4 }, (_, i) => `${i + 1}. Question ${i + 1}: what does the note say about point ${i + 1}?\n   (Think about who owns it, when it happens, and why it matters for the beta.)`).join("\n\n") +
        "\n\n" + "Extra context line to make this long. ".repeat(60) + "\n\n=== ANSWERS ===\n" +
        Array.from({ length: 4 }, (_, i) => `${i + 1}. Answer ${i + 1}: SECRET-${i + 1}`).join("\n")
      : /replace the original text/.test(sys) ? "This sentence has some mistakes in it and needs fixing."
      : /posted as a comment/.test(sys) ? "Primary button label is vague; say “Pay $42” instead of “Continue”."
      : "• Beta ships Friday 14 Nov\n• Maya: release notes; Sam: login bug\n• Design review next week";
    const chunk = (delta, finish) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish || null }] })}\n\n`;
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: ": OPENROUTER PROCESSING\n\n" + chunk({ content: text.slice(0, 15) }) + chunk({ content: text.slice(15) }) + chunk({}, "stop") + "data: [DONE]\n\n" });
  });
  let figmaComment = null;
  await ctx.route("https://www.figma.com/**", (route) => route.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: FIGMA_PAGE }));
  await ctx.route("https://api.figma.com/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/comments")) {
      figmaComment = { token: route.request().headers()["x-figma-token"], body: JSON.parse(route.request().postData()) };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "c1" }) });
    }
    if (u.pathname.includes("/nodes")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ nodes: { "12:34": { document: { name: "Checkout / Pay", type: "FRAME", children: [{ type: "TEXT", characters: "Continue" }] } } } }) });
    if (u.pathname.includes("/images")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ images: { "12:34": "https://figma-render.test/frame.png" } }) });
    route.fulfill({ status: 404, body: "{}" });
  });
  await ctx.route("https://figma-render.test/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX }));

  await sw.evaluate(() => chrome.storage.local.set({ apiKey: "sk-or-v1-test", figmaToken: "figd_test" }));
  const page = await ctx.newPage();
  await page.goto("http://localhost:8765/");
  await sleep(600);
  await shot(page, "1-squad");

  // Pets are role=button elements named "<Name>, <Role>…" inside the (test-build open) shadow root.
  const NAMES = ["Scout", "Quill", "Pixel", "Sprout"];
  const petOn = async (pg, i) => {
    const b = await pg.getByRole("button", { name: new RegExp(`^${NAMES[i]},`) }).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + 24 };
  };
  const pets = [];
  for (let i = 0; i < 4; i++) pets.push(await petOn(page, i));
  const pet = (i) => pets[i];

  async function drag(from, to) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y - 10, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await sleep(150);
  }
  const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

  // ---- 1) drag Quill onto the textarea → approve a rewrite
  await drag(pet(1), await center("#t"));
  await shot(page, "2-drag-quill-onto-field");
  await page.mouse.up();
  await sleep(500);
  await shot(page, "3-quill-card");
  await page.keyboard.press("Enter"); // first skill is focused: Fix spelling & grammar
  await sleep(500);
  await shot(page, "4a-loading");
  assert.ok(await page.getByText("Quill is rewriting…").isVisible(), "loading screen while generating");
  await sleep(1400);
  await shot(page, "4-approve-rewrite");
  assert.equal(await page.inputValue("#t"), "this sentense have some mistake in it and need fixing", "nothing changes before approval");
  // Approve button is the first action button; tab to it is fiddly, so click by text position via accessibility tree
  await page.getByRole("button", { name: "Approve & replace" }).click();
  await sleep(200);
  assert.equal(await page.inputValue("#t"), "This sentence has some mistakes in it and needs fixing.");
  console.log("✓ drag Quill → field → approve rewrite");

  // ---- 2) drag Pixel onto the image → its design skills, screenshot sent
  await drag(pet(2), await center("#img"));
  await page.mouse.up();
  await sleep(900);
  await shot(page, "5-pixel-on-image");
  await page.getByRole("button", { name: "Describe image" }).click();
  await sleep(1800);
  const imgCall = calls.at(-1);
  assert.ok(imgCall.messages[1].content.some((p) => p.type === "image_url" && p.image_url.url.startsWith("data:image/jpeg")), "image sent");
  await page.getByRole("button", { name: "Close", exact: true }).first().click();
  console.log("✓ drag Pixel → image → screenshot goes to the model");

  // ---- 3) select tool: drag a box over the paragraph, then click Scout
  await sw.evaluate(async () => { for (const t of await chrome.tabs.query({})) chrome.tabs.sendMessage(t.id, { type: "lasso" }).catch(() => {}); });
  await sleep(200);
  const p = await page.locator("#p").boundingBox();
  await page.mouse.move(p.x - 10, p.y - 8);
  await page.mouse.down();
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2, { steps: 4 });
  await shot(page, "6a-select-box");
  await page.mouse.move(p.x + p.width + 10, p.y + p.height + 8, { steps: 6 });
  await page.mouse.up();
  await sleep(500);
  await shot(page, "6-lasso-pick");
  await page.mouse.click(pet(0).x, pet(0).y);
  await sleep(300);
  await shot(page, "7-scout-card-on-lasso");
  await page.getByRole("button", { name: "Summarize" }).click();
  await sleep(1800);
  const lassoCall = calls.at(-1);
  assert.match(lassoCall.messages[1].content[0].text, /Maya owns the release notes/);
  await shot(page, "8-summary");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  console.log("✓ select tool box → click Scout → summarize");

  // ---- history panel on the page (this site)
  await page.getByRole("button", { name: "What the pets generated on this site" }).click();
  await sleep(300);
  await shot(page, "8a-history-panel");
  const hp = page.getByRole("dialog", { name: "History" });
  assert.ok(await hp.getByText("Approved & applied").isVisible(), "rewrite logged as approved");
  assert.ok((await hp.locator(".hitem").count()) >= 3, "runs on this site");
  await page.keyboard.press("Escape");
  console.log("✓ in-page history for this site");

  // ---- long answer: scroll even when the page swallows wheel events, expand, reveal quiz answers
  await page.evaluate(() => window.addEventListener("wheel", (e) => e.preventDefault(), { passive: false, capture: true }));
  await page.locator("#p").selectText();
  await page.keyboard.press("Alt+Digit4"); // Sprout
  await sleep(300);
  await page.getByRole("button", { name: "Quiz me" }).click();
  await sleep(500);
  await shot(page, "8b-quiz-loading");
  await sleep(1300);
  const outBox = page.locator(".result .out");
  const before = await outBox.evaluate((n) => n.scrollTop);
  const ob = await outBox.boundingBox();
  await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2);
  await page.mouse.wheel(0, 400);
  await sleep(150);
  assert.ok((await outBox.evaluate((n) => n.scrollTop)) > before, "long answers scroll");
  assert.equal(await page.locator(".spoiler:not(.shown)").count(), 4, "all 4 answers hidden");
  assert.ok(!(await page.locator(".result .out > div").first().innerText()).includes("SECRET"), "questions part has no answers");
  await shot(page, "8c-quiz-hidden");
  await page.getByRole("button", { name: "Expand to see more" }).click();
  await sleep(200);
  const bigW = (await page.locator(".result").boundingBox()).width;
  assert.ok(bigW > 900, `expanded (${bigW}px)`);
  await outBox.evaluate((n) => (n.scrollTop = n.scrollHeight));
  await page.getByRole("button", { name: "Reveal answer 2" }).click();
  await sleep(250);
  assert.equal(await page.locator(".spoiler.shown").count(), 1);
  await shot(page, "8d-quiz-expanded-revealed");
  await page.getByRole("button", { name: "Reveal all" }).click();
  assert.equal(await page.locator(".spoiler.shown").count(), 4);
  await page.keyboard.press("Escape");
  await page.mouse.click(900, 40);
  console.log("✓ long answers scroll (even if the page eats wheel events), expand, quiz answers revealed on click");

  // ---- 4) search bar still works
  await page.locator("#p").selectText();
  await sw.evaluate(async () => { for (const t of await chrome.tabs.query({})) chrome.tabs.sendMessage(t.id, { type: "summon" }).catch(() => {}); });
  await sleep(250);
  await page.keyboard.type("dat");
  await sleep(100);
  await shot(page, "9-search");
  await page.keyboard.press("Escape");
  console.log("✓ search bar");

  // ---- minimized squad, hover/selection expand, hover cards, shortcuts
  const dockClass = () => page.evaluate(() => document.querySelector("skill-pet-root").shadowRoot.querySelector(".dock").className);
  const dockWidth = () => page.evaluate(() => document.querySelector("skill-pet-root").shadowRoot.querySelector(".dock").getBoundingClientRect().width);
  await page.mouse.click(900, 40); // clear selection
  await page.getByRole("button", { name: "Minimize the squad" }).click();
  await page.mouse.move(900, 300);
  await sleep(700);
  const fullW = 600;
  const miniW = await dockWidth();
  await shot(page, "9b-minimized-pets");
  assert.ok(/mini/.test(await dockClass()) && miniW < fullW * 0.6, `minimized is small (${miniW}px)`);
  // hover → expands
  const db = await page.evaluate(() => { const r = document.querySelector("skill-pet-root").shadowRoot.querySelector(".dock").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(db.x, db.y);
  await sleep(450);
  assert.ok(/open/.test(await dockClass()), "hover expands");
  await shot(page, "9c-hover-expands");
  await page.mouse.move(900, 300);
  await sleep(800);
  assert.ok(!/open/.test(await dockClass()), "leaving collapses again");
  // dots
  await sw.evaluate(() => chrome.storage.local.set({ squadMiniStyle: "dots" }));
  await sleep(300);
  await shot(page, "9d-minimized-dots");
  assert.ok((await dockWidth()) < miniW, "dots are smaller still");
  // selecting text expands the bar
  await page.locator("#p").selectText();
  await sleep(250);
  assert.ok(/open/.test(await dockClass()), "selection expands");
  // hover a pet → what it can do (with your selection taken into account)
  await sleep(300);
  const scoutBox = await page.getByRole("button", { name: /^Scout,/ }).boundingBox();
  await page.mouse.move(scoutBox.x + scoutBox.width / 2, scoutBox.y + 20);
  await sleep(450);
  const tip = page.getByRole("tooltip");
  assert.ok(await tip.isVisible(), "hover card");
  assert.match(await tip.innerText(), /Summarize[\s\S]*For your pick|For your pick[\s\S]*Summarize/);
  await shot(page, "9e-hover-card");
  // Alt+1 with a selection → Scout's card; then "1" runs its first skill
  await page.keyboard.press("Alt+Digit1");
  await sleep(300);
  assert.ok(await page.getByRole("dialog", { name: "Scout's skills" }).isVisible(), "Alt+1 opens pet 1");
  await shot(page, "9f-alt1-card");
  await page.keyboard.press("Digit1");
  await sleep(1700);
  assert.match(calls.at(-1).messages[1].content.at(-1).text ?? calls.at(-1).messages[1].content[0].text, /Skill:/);
  await page.keyboard.press("Escape");
  await page.mouse.click(900, 40);
  // Alt+drag a box anywhere, then "2" → Quill on the pick
  const pb = await page.locator("#p").boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.move(pb.x - 8, pb.y - 8);
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width + 8, pb.y + pb.height + 8, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await sleep(500);
  assert.ok(/open/.test(await dockClass()), "a pick keeps the bar open");
  await shot(page, "9g-alt-drag-select");
  await page.keyboard.press("Digit2");
  await sleep(300);
  assert.ok(await page.getByRole("dialog", { name: "Quill's skills" }).isVisible(), "2 sends the pick to pet 2");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape"); // clears the pick
  // Select tool (Alt+Shift+L): hover highlights, click picks, Shift-click adds, Enter finishes
  await page.keyboard.press("Alt+Shift+KeyL");
  await sleep(150);
  await page.mouse.move(pb.x + 40, pb.y + 10);
  await sleep(150);
  await shot(page, "9h-select-hover");
  await page.keyboard.down("Shift");
  await page.mouse.click(pb.x + 40, pb.y + 10);
  const ib = await page.locator("#img").boundingBox();
  await page.mouse.click(ib.x + 40, ib.y + 40);
  await page.keyboard.up("Shift");
  await shot(page, "9h2-select-two");
  await page.keyboard.press("Enter");
  await sleep(600);
  const chipText = await page.getByRole("status").filter({ hasText: "Selected" }).innerText();
  assert.match(chipText, /Selected: 2 items · \d+ words · 1 image/);
  await page.keyboard.press("Escape");
  // Alt+2 while typing in the textarea → Quill on the field's selection
  await page.evaluate(() => { const t = document.getElementById("t"); t.focus(); t.setSelectionRange(0, 4); });
  await page.keyboard.press("Alt+Digit2");
  await sleep(300);
  assert.match(await page.getByRole("dialog", { name: "Quill's skills" }).innerText(), /1 word \(editable\)/);
  await page.keyboard.press("Escape");
  // Alt+/ → cheat sheet
  await page.keyboard.press("Alt+Slash");
  await sleep(200);
  assert.ok(await page.getByRole("dialog", { name: "Keyboard shortcuts" }).isVisible());
  await shot(page, "9i-shortcuts");
  await page.keyboard.press("Escape");
  // ---- pinned selection: the outline follows the page when you scroll
  await page.keyboard.press("Alt+Shift+KeyL");
  await sleep(150);
  const pp = await page.locator("#p").boundingBox();
  await page.mouse.move(pp.x + 40, pp.y + 10);
  await page.mouse.wheel(0, 120); // the page still scrolls while the select tool is open
  await sleep(200);
  assert.ok((await page.evaluate(() => scrollY)) > 0, "page scrolls under the select tool");
  await page.evaluate(() => scrollTo(0, 0));
  await sleep(100);
  await page.mouse.move(pp.x + 40, pp.y + 12);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(500);
  const outlineY = () => page.evaluate(() => Number(document.querySelector("skill-pet-root").shadowRoot.querySelector("svg.pickline rect").getAttribute("y")));
  const y0 = await outlineY();
  await page.evaluate(() => scrollTo(0, 150));
  await sleep(250);
  const y1 = await outlineY();
  assert.ok(Math.abs(y0 - 150 - y1) < 2, `outline pinned to the paragraph (${y0} → ${y1})`);
  await shot(page, "9j-pinned-after-scroll");
  // dropping a pet on the scrolled pick still works
  const pinned = await page.locator("#p").boundingBox();
  const q2 = await page.getByRole("button", { name: /^Quill,/ }).boundingBox();
  await page.mouse.move(q2.x + q2.width / 2, q2.y + 20);
  await page.mouse.down();
  await page.mouse.move(pinned.x + 60, pinned.y + 10, { steps: 10 });
  await page.mouse.up();
  await sleep(400);
  assert.match(await page.getByRole("dialog", { name: "Quill's skills" }).innerText(), /Picked: 41 words/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.evaluate(() => scrollTo(0, 0));
  console.log("✓ selection is pinned to the page: follows scroll, still a drop target");

  await sw.evaluate(() => chrome.storage.local.set({ squadCollapsed: false, squadMiniStyle: "pets" }));
  await sleep(300);
  console.log("✓ minimize (small pets / dots), hover + selection + lasso expand, hover cards, shortcuts");

  // ---- 5) fake Figma: drag Pixel onto the canvas → approve & post comment
  const fig = await ctx.newPage();
  await fig.goto("https://www.figma.com/design/AbC123/Checkout?node-id=12-34");
  await sleep(700);
  const fp = await petOn(fig, 2);
  const fpet = () => fp;
  await fig.mouse.move(fpet(2).x, fpet(2).y);
  await fig.mouse.down();
  await fig.mouse.move(430, 300, { steps: 12 });
  await sleep(150);
  await fig.screenshot({ path: SS + "10-figma-drag.png" });
  await fig.mouse.up();
  await sleep(900);
  await fig.screenshot({ path: SS + "11-figma-card.png" });
  await fig.getByRole("button", { name: "Leave critique as comment" }).click();
  await sleep(1900);
  await fig.screenshot({ path: SS + "12-figma-approve.png" });
  assert.equal(figmaComment, null, "nothing posted before approval");
  await fig.getByRole("button", { name: "Approve & post comment" }).click();
  await sleep(500);
  assert.equal(figmaComment.token, "figd_test");
  assert.deepEqual(figmaComment.body.client_meta, { node_id: "12:34", node_offset: { x: 0, y: 0 } });
  assert.match(figmaComment.body.message, /Pay \$42/);
  const figCall = calls.at(-1);
  assert.match(figCall.messages[1].content[0].text, /Continue/, "frame text layers from the Figma API");
  await fig.screenshot({ path: SS + "13-figma-posted.png" });
  console.log("✓ Figma frame → approve → comment posted to node 12:34");

  // ---- 6) Skill Studio
  const studio = await ctx.newPage();
  await studio.setViewportSize({ width: 1280, height: 1500 });
  await studio.goto(`chrome-extension://${extId}/studio.html`);
  await sleep(400);
  await studio.screenshot({ path: SS + "14-studio.png" });
  // characters: default squad is dog / bird / cat / frog; switch Scout to a bunny
  assert.deepEqual((await sw.evaluate(() => chrome.storage.local.get("library"))).library.pets.map((p) => p.species), ["dog", "bird", "cat", "frog"]);
  await studio.locator(".pet", { has: studio.locator('input[value="Scout"]') }).getByRole("button", { name: "Bunny" }).click();
  await sleep(300);
  assert.equal((await sw.evaluate(() => chrome.storage.local.get("library"))).library.pets[0].species, "bunny");
  await studio.screenshot({ path: SS + "14b-studio-characters.png" });
  await sleep(200);
  await page.bringToFront();
  await shot(page, "14c-dock-with-bunny");
  assert.ok(await page.evaluate(() => document.querySelector("skill-pet-root").shadowRoot.querySelectorAll(".dock .pet-art").length === 4));
  console.log("✓ characters: species per pet, switchable in the Studio, live on pages");
  // drag "Pull dates" onto Pixel
  const src = studio.locator(".skillrow", { hasText: "Pull dates" });
  const dst = studio.locator(".pet", { has: studio.locator('input[value="Pixel"]') });
  await src.dragTo(dst, { targetPosition: { x: 120, y: 30 } });
  await sleep(300);
  let stored = await sw.evaluate(() => chrome.storage.local.get("library"));
  assert.ok(stored.library.pets.find((p) => p.id === "pixel").skillIds.includes("dates"), "drag skill onto pet");
  console.log("✓ Studio: drag a skill onto a pet");
  // new skill
  await studio.getByRole("button", { name: "+ New skill" }).click();
  await studio.fill("#fName", "Make it pirate");
  await studio.fill("#fPrompt", "Rewrite this in pirate speak. Output only the rewrite.");
  await studio.selectOption("#fAction", "replace");
  await studio.check("#pet-quill");
  await studio.fill("#tText", "Hello team, the build is green.");
  await studio.click("#tRun");
  await sleep(400);
  await studio.screenshot({ path: SS + "15a-studio-try-loading.png" });
  assert.match(await studio.locator("#tOut").innerText(), /Generating/);
  await sleep(1400);
  await studio.screenshot({ path: SS + "15-studio-editor.png" });
  await studio.click("#edSave");
  await sleep(300);
  stored = await sw.evaluate(() => chrome.storage.local.get("library"));
  const made = stored.library.skills.find((s) => s.name === "Make it pirate");
  assert.ok(made && made.accepts.includes("editable"));
  assert.ok(stored.library.pets.find((p) => p.id === "quill").skillIds.includes(made.id));
  await studio.screenshot({ path: SS + "16-studio-after.png" });
  console.log("✓ Studio: new skill saved and taught to Quill");

  // ---- Studio history tab
  const { history } = await sw.evaluate(() => chrome.storage.local.get("history"));
  const by = (n) => history.find((e) => e.skillName === n);
  assert.equal(by("Fix spelling & grammar").status, "approved");
  assert.equal(by("Fix spelling & grammar").final, "This sentence has some mistakes in it and needs fixing.");
  assert.equal(by("Leave critique as comment").status, "posted");
  assert.equal(by("Make it pirate").source, "studio");
  await studio.getByRole("tab", { name: /History/ }).click();
  await sleep(300);
  await studio.screenshot({ path: SS + "17-studio-history.png" });
  assert.ok((await studio.locator("#hList .hitem").count()) >= 5);
  console.log("✓ history: approved / posted / studio tests all logged; Studio History tab");

  srv.close();
  await ctx.close();
  console.log("all e2e checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
