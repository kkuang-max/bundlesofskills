import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRequest, defaultLibrary, detectApp, normalizeLibrary, parseFigmaUrl,
  petCanRead, petSvg, pointInPolygon, skillsFor, suggestPet,
} from "../src/library.js";

const lib = defaultLibrary();
const ctx = (over) => ({ host: "example.com", url: "", title: "", app: "web", kinds: ["text"], text: "", images: [], figma: null, label: "", ...over });
const ids = (list) => list.map((s) => s.id);

test("detects the apps it needs to treat differently", () => {
  assert.equal(detectApp("docs.google.com", "https://docs.google.com/document/d/x/edit"), "docs");
  assert.equal(detectApp("docs.google.com", "https://docs.google.com/spreadsheets/d/x"), "sheets");
  assert.equal(detectApp("docs.google.com", "https://docs.google.com/presentation/d/x"), "slides");
  assert.equal(detectApp("www.figma.com"), "figma");
  assert.equal(detectApp("en.wikipedia.org"), "wiki");
  assert.equal(detectApp("mail.google.com"), "mail");
  assert.equal(detectApp("news.ycombinator.com"), "web");
});

test("reads the selected Figma node from the URL", () => {
  assert.deepEqual(parseFigmaUrl("https://www.figma.com/design/AbC123/Checkout?node-id=12-34&t=x"), { fileKey: "AbC123", nodeId: "12:34" });
  assert.deepEqual(parseFigmaUrl("https://www.figma.com/design/AbC123/Checkout"), { fileKey: "AbC123", nodeId: null });
  assert.equal(parseFigmaUrl("https://example.com"), null);
});

test("a pet only offers skills that fit what it was dropped on", () => {
  const frame = ctx({ app: "figma", kinds: ["frame", "image"] });
  const pixel = ids(skillsFor(lib, frame, { petId: "pixel" }));
  assert.ok(pixel.includes("critique") && pixel.includes("critique-comment"));
  // Quill's rewrite skills don't fit a frame (only "action items" reads screenshots),
  // and Quill isn't allowed to read images anyway, so its card shows a lock.
  assert.deepEqual(ids(skillsFor(lib, frame, { petId: "quill" })), ["action-items"]);
  assert.equal(petCanRead(lib.pets.find((p) => p.id === "quill"), frame).ok, false);
  // Rewrites only show up for editable text
  const reading = ids(skillsFor(lib, ctx({ text: "hello there friend" }), { petId: "quill" }));
  assert.ok(!reading.includes("fix-grammar"));
  const editing = ids(skillsFor(lib, ctx({ kinds: ["text", "editable"], text: "this sentense have mistake" }), { petId: "quill" }));
  assert.equal(editing[0], "fix-grammar");
});

test("app boosts reorder skills", () => {
  const essay = "The committee reviewed the proposal and found the budget reasonable overall. ".repeat(12);
  const wiki = ids(skillsFor(lib, ctx({ app: "wiki", text: essay }), { petId: "scout" }));
  assert.equal(wiki[0], "summarize");
  const dated = ids(skillsFor(lib, ctx({ text: "Launch moves to Friday 14 Nov, review on Monday." }), { petId: "scout" }));
  assert.equal(dated[0], "dates");
});

test("search filters across every pet", () => {
  assert.deepEqual(ids(skillsFor(lib, ctx({ kinds: ["frame", "image"] }), { query: "crit" })), ["critique", "critique-comment"]);
});

test("permissions live with the pet", () => {
  assert.equal(petCanRead(lib.pets.find((p) => p.id === "pixel"), ctx({ kinds: ["text"] })).ok, false);
  assert.equal(petCanRead(lib.pets.find((p) => p.id === "quill"), ctx({ kinds: ["image"] })).ok, false);
  assert.equal(suggestPet(lib, ctx({ app: "figma", kinds: ["frame", "image"] })).id, "pixel");
  assert.equal(suggestPet(lib, ctx({ app: "docs", kinds: ["text", "editable"] })).id, "quill");
});

test("requests carry text and images, minus what the pet may not read", () => {
  const c = ctx({ kinds: ["text", "image"], text: "hello", images: ["data:image/jpeg;base64,AAA"] });
  const skill = lib.skills.find((s) => s.id === "summarize");
  const all = buildRequest(c, { skill });
  assert.equal(all.content.length, 2);
  assert.match(all.content[0].text, /<picked_content>\nhello/);
  assert.deepEqual(all.content[1], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAA" } });
  const quill = lib.pets.find((p) => p.id === "quill"); // can't read images
  assert.equal(buildRequest(c, { skill, pet: quill }).content.length, 1);
  const rw = buildRequest(ctx({ kinds: ["editable"], text: "x" }), { skill: lib.skills.find((s) => s.id === "rewrite-ask"), request: "more formal" });
  assert.match(rw.content[0].text, /more formal/);
  assert.match(rw.system, /replace the original text/);
});

test("stored libraries are cleaned up", () => {
  const n = normalizeLibrary({ skills: [{ id: "a", name: "A", prompt: "p", accepts: ["text", "bogus"] }], pets: [{ id: "x", name: "X", skillIds: ["a", "gone"] }] });
  assert.deepEqual(n.skills[0].accepts, ["text"]);
  assert.deepEqual(n.pets[0].skillIds, ["a"]);
  assert.equal(normalizeLibrary(null).pets.length, 5); // Scout, Quill, Pixel, Sprout, Security
});

test("pet markup refuses non-colour values", () => {
  assert.ok(!petSvg('"><img src=x onerror=alert(1)>').includes("onerror"));
});

test("lasso hit-testing", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon([5, 5], sq), true);
  assert.equal(pointInPolygon([15, 5], sq), false);
});

test("reveal-later answers are split off, even mid-stream", async () => {
  const { splitReveal } = await import("../src/library.js");
  const out = "1. What is a cat?\n2. Where do cats sleep?\n\n=== ANSWERS ===\n1. A small mammal.\n   Usually a pet.\n2. Anywhere warm.";
  const r = splitReveal(out);
  assert.equal(r.hasReveal, true);
  assert.equal(r.shown, "1. What is a cat?\n2. Where do cats sleep?");
  assert.deepEqual(r.answers, ["1. A small mammal.\nUsually a pet.", "2. Anywhere warm."]);
  assert.equal(splitReveal("1. Q?\n=== ANSWERS ===\n1. A").answers.length, 1); // partial
  assert.equal(splitReveal("just text").hasReveal, false);
  assert.equal(splitReveal("Q?\n## Answers\n1. A").hasReveal, true);
});

test("old quiz/flashcard templates are upgraded, edited ones are kept", () => {
  const old = defaultLibrary();
  old.skills.find((s) => s.id === "quiz").prompt = "Write 3 short quiz questions that test understanding of this content, then the answers under a 'Answers' heading.";
  old.skills.find((s) => s.id === "flashcards").prompt = "My own flashcards prompt";
  const n = normalizeLibrary(old);
  assert.match(n.skills.find((s) => s.id === "quiz").prompt, /=== ANSWERS ===/);
  assert.equal(n.skills.find((s) => s.id === "flashcards").prompt, "My own flashcards prompt");
});
