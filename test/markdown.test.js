import test from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown, stripMarkdown } from "../src/markdown.js";

const types = (bs) => bs.map((b) => b.type);

test("blocks: headings, paragraphs, lists, code, quotes, rules, tables", () => {
  const md = "## Summary\nSome **bold** text\nand more.\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n```js\nconst x = 1;\n```\n\n> quoted\n\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |";
  const b = parseMarkdown(md);
  assert.deepEqual(types(b), ["h", "p", "ul", "ol", "code", "quote", "hr", "table"]);
  assert.equal(b[0].level, 2);
  assert.equal(b[2].items[1].sub.items[0].c[0].v, "nested");
  assert.equal(b[4].lang, "js");
  assert.equal(b[4].text, "const x = 1;");
  assert.equal(b[7].rows[0][1][0].v, "2");
});

test("inline: bold, italic, code, strike, links; snake_case and stray * left alone", () => {
  const n = parseInline("**Bold** and *it* and `x*y` and ~~old~~ [site](https://a.b/c) snake_case_name 2 * 3");
  assert.deepEqual(n.filter((x) => x.t !== "text").map((x) => x.t), ["b", "i", "code", "s", "a"]);
  assert.equal(n.find((x) => x.t === "a").href, "https://a.b/c");
  assert.ok(n.some((x) => x.t === "text" && x.v.includes("snake_case_name 2 * 3")));
});

test("only safe links become links", () => {
  assert.ok(!parseInline("[x](javascript:alert(1))").some((x) => x.t === "a"));
  assert.ok(parseInline("see https://example.com.").some((x) => x.t === "a" && x.href === "https://example.com"));
});

test("checklists and ordered starts", () => {
  const b = parseMarkdown("- [ ] todo\n- [x] done\n\n3. three\n4. four");
  assert.deepEqual(b[0].items.map((i) => i.checked), [false, true]);
  assert.equal(b[1].start, 3);
});

test("unfinished fences while streaming don't break", () => {
  assert.equal(parseMarkdown("```\npartial code").at(-1).type, "code");
});

test("strip to plain text", () => {
  assert.equal(stripMarkdown("## Hi\n- **a**\n- b"), "Hi\n• a\n• b");
});
