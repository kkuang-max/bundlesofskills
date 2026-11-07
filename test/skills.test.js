import test from "node:test";
import assert from "node:assert/strict";
import { rankSkills, buildRequest } from "../src/skills.js";

const ids = (ctx, opts) => rankSkills(ctx, opts).slice(0, 3).map((s) => s.id);
const long = "We agreed to ship the beta on Friday. Maya owns the release notes and Sam will fix the login bug. ".repeat(6);

test("mail reading view guesses a reply first", () => {
  assert.equal(ids({ host: "mail.google.com", title: "", text: long, editable: false })[0], "draft-reply");
});

test("text you're editing favours rewrite skills", () => {
  const top = ids({ host: "docs.google.com", title: "", text: "this sentense have some mistake in it", editable: true });
  assert.deepEqual(top.slice(0, 2), ["fix-grammar", "tighten"]);
});

test("code on github is explained as code", () => {
  assert.equal(ids({ host: "github.com", title: "", text: "const add = (a, b) => {\n  return a + b;\n}", editable: false })[0], "explain-code");
});

test("non-Latin text suggests translation", () => {
  assert.equal(ids({ host: "example.com", title: "", text: "明日の会議は午後三時からです。資料を準備してください。", editable: false })[0], "translate");
});

test("search query filters and prefix-matches", () => {
  const r = rankSkills({ host: "x.com", title: "", text: "", editable: false }, { query: "sum" });
  assert.deepEqual(r.map((s) => s.id), ["summarize"]);
});

test("usage history nudges a habit up", () => {
  const essay = "The committee reviewed the proposal and found the budget reasonable overall. ".repeat(15);
  const ctx = { host: "example.com", title: "", text: essay, editable: false };
  assert.equal(ids(ctx)[0], "summarize");
  assert.equal(ids(ctx, { usage: { "action-items": 5 } })[0], "action-items");
});

test("request wraps the selection as data", () => {
  const r = buildRequest({ host: "a.com", title: "T", text: "hello", editable: false }, { skillId: "summarize" });
  assert.match(r.user, /<selected_content>\nhello\n<\/selected_content>/);
  assert.equal(r.label, "Summarize");
  assert.throws(() => buildRequest({ host: "", title: "", text: "", editable: false }, {}));
});
