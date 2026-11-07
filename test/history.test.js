import test from "node:test";
import assert from "node:assert/strict";
import { addEntry, filterHistory, makeEntry, timeAgo, updateEntry } from "../src/history.js";

const ctx = { host: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Cat", title: "Cat", app: "wiki", text: "Cats are small.", images: ["x"], label: "3 words" };
const skill = { id: "summarize", name: "Summarize", action: "answer", sticker: { label: "TL;DR", color: "#FFB86B", shape: "circle" } };
const pet = { id: "scout", name: "Scout", color: "#9ED8C5" };

test("entries capture who, what, where", () => {
  const e = makeEntry({ id: "a", source: "page", context: ctx, skill, pet });
  assert.equal(e.status, "running");
  assert.equal(e.skillName, "Summarize");
  assert.equal(e.petName, "Scout");
  assert.equal(e.host, "en.wikipedia.org");
  assert.equal(e.input, "Cats are small.");
  assert.equal(e.images, 1);
});

test("newest first, capped, updatable", () => {
  let h = [];
  for (let i = 0; i < 5; i++) h = addEntry(h, makeEntry({ id: String(i), source: "page", context: ctx, skill }), 3);
  assert.deepEqual(h.map((e) => e.id), ["4", "3", "2"]);
  h = updateEntry(h, "3", { status: "approved", output: "out", final: "edited" });
  assert.equal(h[1].status, "approved");
  assert.equal(h[1].final, "edited");
  assert.equal(h[0].status, "running");
});

test("filters by site, source and text", () => {
  const h = [
    makeEntry({ id: "1", source: "page", context: ctx, skill }),
    makeEntry({ id: "2", source: "studio", context: { host: "skill-studio" }, instruction: "pirate" }),
    makeEntry({ id: "3", source: "page", context: { ...ctx, host: "www.figma.com" }, skill }),
  ];
  assert.deepEqual(filterHistory(h, { host: "en.wikipedia.org" }).map((e) => e.id), ["1"]);
  assert.deepEqual(filterHistory(h, { source: "studio" }).map((e) => e.id), ["2"]);
  assert.deepEqual(filterHistory(h, { query: "pirate" }).map((e) => e.id), ["2"]);
});

test("relative times", () => {
  assert.equal(timeAgo(1000, 1000 + 10_000), "just now");
  assert.equal(timeAgo(0, 5 * 60_000), "5 min ago");
});
