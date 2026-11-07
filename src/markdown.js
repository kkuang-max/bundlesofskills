// A small, safe Markdown renderer for model output.
// parseMarkdown() is pure (blocks + inline nodes) so it's unit-tested in node.
// renderMarkdown() builds DOM with createElement/textContent only: model text is
// never parsed as HTML, links are http(s)/mailto only.
//
// Supports: # headings, paragraphs, **bold**, *italic*, ~~strike~~, `code`,
// ``` fenced code ```, - / * / 1. lists (nested by indent), - [ ] / - [x]
// checklists, > quotes, --- rules, [links](https://…), | pipe | tables |.

// ---------------------------------------------------------------- inline
const INLINE = [
  { re: /^`([^`]+)`/, make: (m) => ({ t: "code", v: m[1] }) },
  { re: /^\*\*(?=\S)([\s\S]*?\S)\*\*/, make: (m) => ({ t: "b", c: parseInline(m[1]) }) },
  { re: /^__(?=\S)([\s\S]*?\S)__(?!\w)/, make: (m) => ({ t: "b", c: parseInline(m[1]) }) },
  { re: /^~~(?=\S)([\s\S]*?\S)~~/, make: (m) => ({ t: "s", c: parseInline(m[1]) }) },
  { re: /^\*(?=[^\s*])([^*]*?[^\s*])\*/, make: (m) => ({ t: "i", c: parseInline(m[1]) }) },
  { re: /^_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/, make: (m) => ({ t: "i", c: parseInline(m[1]) }) },
  { re: /^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/, make: (m) => ({ t: "a", href: m[2], c: parseInline(m[1]) }) },
  { re: /^(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/, make: (m) => ({ t: "a", href: m[1], c: [{ t: "text", v: m[1] }] }) },
];

export function parseInline(src) {
  const out = [];
  let buf = "";
  let i = 0;
  const flush = () => buf && (out.push({ t: "text", v: buf }), (buf = ""));
  while (i < src.length) {
    const rest = src.slice(i);
    // _ only opens emphasis at a word start (snake_case stays as-is)
    const prev = src[i - 1] || " ";
    let hit = null;
    for (const rule of INLINE) {
      if ((rest[0] === "_" && /\w/.test(prev)) || (rest.startsWith("http") && /\w/.test(prev))) continue;
      const m = rule.re.exec(rest);
      if (m) {
        hit = { node: rule.make(m), len: m[0].length };
        break;
      }
    }
    if (hit) {
      flush();
      out.push(hit.node);
      i += hit.len;
    } else if (rest[0] === "\\" && /[\\`*_[\]#>~|-]/.test(rest[1] || "")) {
      buf += rest[1];
      i += 2;
    } else if (rest[0] === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
    } else {
      buf += rest[0];
      i++;
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- blocks
const LIST_RE = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => parseInline(c.trim()));

export function parseMarkdown(text) {
  const lines = (text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // fenced code (an unclosed fence while streaming runs to the end)
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", lang: fence[2] || "", text: body.join("\n") });
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      blocks.push({ type: "h", level: Math.min(h[1].length, 4), c: parseInline(h[2]) });
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", blocks: parseMarkdown(body.join("\n")) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if (LIST_RE.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        // A bullet list followed by a numbered one (or vice versa) at the top level is a new list.
        if (m && items.length && m[1].length <= items[0].indent && /\d/.test(m[2]) !== items[0].ordered) break;
        if (m) {
          items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), num: parseInt(m[2], 10) || 1, text: m[3] });
          i++;
        } else if (lines[i].trim() && /^\s+\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += "\n" + lines[i].trim(); // continuation line
          i++;
        } else if (!lines[i].trim() && LIST_RE.test(lines[i + 1] || "") && /\d/.test(LIST_RE.exec(lines[i + 1])[2]) === items[0].ordered) {
          i++; // blank line between items
        } else break;
      }
      blocks.push(buildList(items, 0, items.length));
      continue;
    }
    // paragraph: until a blank line or another block starts
    const body = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !LIST_RE.test(lines[i]) && !/^\s{0,3}(#{1,6}\s|>|```|~~~)/.test(lines[i]) && !(lines[i].includes("|") && isTableSep(lines[i + 1] || ""))) {
      body.push(lines[i++].trim());
    }
    blocks.push({ type: "p", c: parseInline(body.join("\n")) });
  }
  return blocks;
}

function buildList(items, from, to) {
  const base = items[from].indent;
  const list = { type: items[from].ordered ? "ol" : "ul", start: items[from].num, items: [] };
  let k = from;
  while (k < to) {
    const it = items[k];
    let end = k + 1;
    while (end < to && items[end].indent > base) end++;
    const task = /^\[( |x|X)\]\s+/.exec(it.text);
    list.items.push({
      checked: task ? task[1] !== " " : null,
      c: parseInline(task ? it.text.slice(task[0].length) : it.text),
      sub: end > k + 1 ? buildList(items, k + 1, end) : null,
    });
    k = end;
  }
  return list;
}

/** Plain text with the Markdown syntax removed (for previews). */
export function stripMarkdown(text) {
  const inl = (ns) => ns.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? " " : inl(n.c || []))).join("");
  const blk = (bs) =>
    bs
      .map((b) =>
        b.type === "code" ? b.text : b.type === "hr" ? "" : b.type === "quote" ? blk(b.blocks) : b.type === "table" ? [b.head, ...b.rows].map((r) => r.map(inl).join(" | ")).join("\n") : b.items ? b.items.map((it) => `• ${inl(it.c)}${it.sub ? "\n" + blk([it.sub]) : ""}`).join("\n") : inl(b.c),
      )
      .join("\n");
  return blk(parseMarkdown(text));
}

// ---------------------------------------------------------------- DOM
function inlineDom(nodes, doc) {
  const frag = doc.createDocumentFragment();
  for (const n of nodes) {
    if (n.t === "text") frag.append(doc.createTextNode(n.v));
    else if (n.t === "br") frag.append(doc.createElement("br"));
    else if (n.t === "code") {
      const c = doc.createElement("code");
      c.textContent = n.v;
      frag.append(c);
    } else {
      const tag = { b: "strong", i: "em", s: "del", a: "a" }[n.t];
      const e = doc.createElement(tag);
      if (n.t === "a") {
        e.href = n.href;
        e.target = "_blank";
        e.rel = "noopener noreferrer";
      }
      e.append(inlineDom(n.c, doc));
      frag.append(e);
    }
  }
  return frag;
}

function blockDom(b, doc) {
  const mk = (tag, kids) => {
    const e = doc.createElement(tag);
    if (kids) e.append(kids);
    return e;
  };
  switch (b.type) {
    case "h":
      return mk(`h${b.level}`, inlineDom(b.c, doc));
    case "p":
      return mk("p", inlineDom(b.c, doc));
    case "hr":
      return mk("hr");
    case "code": {
      const pre = mk("pre");
      const code = mk("code");
      code.textContent = b.text;
      if (b.lang) code.dataset.lang = b.lang;
      pre.append(code);
      return pre;
    }
    case "quote": {
      const q = mk("blockquote");
      b.blocks.forEach((x) => q.append(blockDom(x, doc)));
      return q;
    }
    case "table": {
      const wrap = mk("div");
      wrap.className = "md-table";
      const t = mk("table");
      const tr = mk("tr");
      b.head.forEach((c) => tr.append(mk("th", inlineDom(c, doc))));
      t.append(mk("thead", tr));
      const tb = mk("tbody");
      b.rows.forEach((r) => {
        const row = mk("tr");
        r.forEach((c) => row.append(mk("td", inlineDom(c, doc))));
        tb.append(row);
      });
      t.append(tb);
      wrap.append(t);
      return wrap;
    }
    case "ul":
    case "ol": {
      const l = mk(b.type);
      if (b.type === "ol" && b.start !== 1) l.start = b.start;
      for (const it of b.items) {
        const li = mk("li");
        if (it.checked !== null) {
          li.className = "task";
          const box = mk("input");
          box.type = "checkbox";
          box.checked = it.checked;
          box.disabled = true;
          box.setAttribute("aria-label", it.checked ? "done" : "not done");
          li.append(box, " ");
        }
        li.append(inlineDom(it.c, doc));
        if (it.sub) li.append(blockDom(it.sub, doc));
        l.append(li);
      }
      return l;
    }
  }
  return mk("div");
}

/** Markdown → a DocumentFragment (safe: no HTML parsing of model text). */
export function renderMarkdown(text, doc = document) {
  const frag = doc.createDocumentFragment();
  for (const b of parseMarkdown(text)) frag.append(blockDom(b, doc));
  return frag;
}

/** Copy as rich text (pastes formatted into Docs/Gmail) with Markdown as the plain-text fallback. */
export async function copyRich(markdown) {
  const div = document.createElement("div");
  div.append(renderMarkdown(markdown));
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([div.innerHTML], { type: "text/html" }),
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(markdown);
  }
}

/** Styles for rendered Markdown, scoped under .md. */
export const MARKDOWN_CSS = `
.md{white-space:normal;line-height:1.55;overflow-wrap:anywhere}
.md>:first-child{margin-top:0}.md>:last-child{margin-bottom:0}
.md p{margin:0 0 .7em}
.md h1,.md h2,.md h3,.md h4{font-family:'Bricolage Grotesque',Inter,system-ui,sans-serif;font-weight:800;line-height:1.25;margin:1em 0 .45em}
.md h1{font-size:1.35em}.md h2{font-size:1.2em}.md h3{font-size:1.07em}.md h4{font-size:1em}
.md ul,.md ol{margin:0 0 .7em;padding-left:1.4em}
.md li{margin:.2em 0}
.md li>ul,.md li>ol{margin:.2em 0 0}
.md li.task{list-style:none;margin-left:-1.3em}
.md li.task input{margin:0 .35em 0 0;vertical-align:-1px;accent-color:#1E6B4F}
.md strong{font-weight:700}
.md code{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#F2EFE9;border-radius:5px;padding:1px 5px}
.md pre{background:#1B1A1F;color:#F5F3EE;border-radius:10px;padding:10px 12px;overflow:auto;margin:0 0 .8em}
.md pre code{background:none;padding:0;color:inherit;white-space:pre}
.md blockquote{margin:0 0 .7em;padding:2px 0 2px 12px;border-left:3px solid #E3DFD6;color:#5E5B66}
.md hr{border:0;border-top:1px solid #E3DFD6;margin:1em 0}
.md a{color:#3A6FD8}
.md .md-table{overflow:auto;margin:0 0 .8em}
.md table{border-collapse:collapse;font-size:.95em}
.md th,.md td{border:1px solid #E3DFD6;padding:5px 9px;text-align:left;vertical-align:top}
.md th{background:#FBFAF7;font-weight:600}
`;
