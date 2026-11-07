// Content script: the pet itself. Three surfaces, all inside one shadow root so
// page CSS can't touch them:
//   • Peek    – select text, the pet peeks out beside it with its top 3 guesses
//   • Burrow  – hotkey opens a search-first command bar over every skill
//   • Result  – streams the answer; Copy / Replace selection / Run again
import { getSkill, rankSkills, words } from "./skills.js";

const PEEK_MIN_CHARS = 12;
const PEEK_TIMEOUT_MS = 4000;

// ---------- context sniffing --------------------------------------------------
/** Snapshot what the user is pointing at, plus enough to write back into it. */
function sniff() {
  const active = deepActiveElement();
  const ctx = { host: location.hostname, title: document.title, text: "", editable: false };
  let target = null;

  if (active && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && /^(text|search|email|url|)$/i.test(active.type)))) {
    const { selectionStart: s, selectionEnd: e } = active;
    if (s != null && e != null && e > s) {
      ctx.text = active.value.slice(s, e);
      ctx.editable = true;
      target = { kind: "field", el: active, start: s, end: e };
    }
  }
  if (!target) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      ctx.text = sel.toString();
      const range = sel.getRangeAt(0);
      const host = range.commonAncestorContainer.parentElement || range.commonAncestorContainer;
      ctx.editable = Boolean(host?.closest?.("[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"));
      target = { kind: ctx.editable ? "rich" : "readonly", range: range.cloneRange(), rect: range.getBoundingClientRect() };
    }
  }
  ctx.text = ctx.text.trim().slice(0, 50_000);
  return { ctx, target };
}

function deepActiveElement() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** Write a result back where the selection was. Returns false if we can't. */
function replaceTarget(target, text) {
  if (!target) return false;
  if (target.kind === "field" && target.el.isConnected) {
    target.el.focus();
    target.el.setRangeText(text, target.start, target.end, "end");
    target.el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (target.kind === "rich") {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(target.range);
    // execCommand is deprecated but is still the only way to edit a
    // contenteditable that keeps the editor's own undo stack working.
    return document.execCommand("insertText", false, text);
  }
  return false;
}

// ---------- shadow-root UI ----------------------------------------------------
const PET_SVG = `<svg viewBox="0 0 64 60" width="34" height="32" aria-hidden="true"><path d="M16 20L12 5l13 7z" fill="var(--pet)" stroke="#1B1A1F" stroke-width="2.5" stroke-linejoin="round"/><path d="M48 20l4-15-13 7z" fill="var(--pet)" stroke="#1B1A1F" stroke-width="2.5" stroke-linejoin="round"/><path d="M10 34c0-15 10-25 22-25s22 10 22 25c0 13-9 20-22 20S10 47 10 34z" fill="var(--pet)" stroke="#1B1A1F" stroke-width="2.5"/><circle cx="25" cy="31" r="3" fill="#1B1A1F"/><circle cx="39" cy="31" r="3" fill="#1B1A1F"/><path d="M29 38q3 3 6 0" fill="none" stroke="#1B1A1F" stroke-width="2.2" stroke-linecap="round"/></svg>`;

const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,sans-serif}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647;--pet:#FFB86B;color:#1B1A1F;font-size:13px}
.layer>*{pointer-events:auto}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer}
button:focus-visible,input:focus-visible{outline:2px solid #3A6FD8;outline-offset:2px}
.peek{position:fixed;display:flex;align-items:center;gap:4px;padding:4px;background:#1B1A1F;border-radius:12px;box-shadow:0 10px 22px rgba(27,26,31,.25);animation:pop .14s ease-out}
.peek .pet{display:flex;padding:0 2px}
.peek button{color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;white-space:nowrap}
.peek button:hover,.peek button.first{background:#3A3940}
@keyframes pop{from{transform:translateY(6px) scale(.96);opacity:0}}
.scrim{position:fixed;inset:0;background:rgba(27,26,31,.18)}
.bar,.result{position:fixed;left:50%;top:14vh;transform:translateX(-50%);width:min(520px,calc(100vw - 32px));background:#fff;border-radius:16px;box-shadow:0 24px 48px rgba(27,26,31,.28);overflow:hidden}
.bar .row{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #EEEAE2}
.bar input{flex:1;border:0;outline:0;font-size:16px;font-weight:500;background:none;color:#1B1A1F}
.kbd{font-size:11px;color:#5E5B66;padding:3px 6px;border:1px solid #E3DFD6;border-radius:5px}
.list{padding:6px;max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:2px}
.item{display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;padding:9px 10px;border-radius:9px}
.item[aria-selected=true]{background:#FFF0E6}
.item .hint{font-size:11px;color:#5E5B66}
.foot{display:flex;justify-content:space-between;gap:8px;padding:9px 14px;background:#FBFAF7;border-top:1px solid #EEEAE2;font-size:11px;color:#5E5B66}
.result .head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #EEEAE2;font-weight:600}
.result .head .pet{display:flex}
.result .head .x{margin-left:auto;font-size:18px;line-height:1;padding:4px 8px;border-radius:8px;color:#5E5B66}
.out{padding:14px;max-height:50vh;overflow:auto;white-space:pre-wrap;line-height:1.5;font-size:13.5px}
.out.err{color:#9B2C1A}
.actions{display:flex;gap:6px;padding:10px 14px;border-top:1px solid #EEEAE2}
.actions button{padding:8px 12px;border-radius:8px;border:1px solid #E3DFD6;font-weight:600;font-size:12px}
.actions button.primary{background:#1B1A1F;color:#fff;border-color:#1B1A1F}
.actions button[disabled]{opacity:.45;cursor:default}
.thinking .pet svg{animation:bob .6s ease-in-out infinite alternate}
@keyframes bob{to{transform:translateY(-3px)}}
`;

const host = document.createElement("skill-pet-root");
const shadow = host.attachShadow({ mode: "closed" });
shadow.innerHTML = `<style>${CSS}</style><div class="layer"></div>`;
const layer = shadow.querySelector(".layer");
let mounted = false;
function mount() {
  if (!mounted) {
    document.documentElement.appendChild(host);
    mounted = true;
  }
}

let usage = {};
let peekEnabled = true;
let peekBlocked = [];
let lastRun = null; // {skillId|instruction, label} – for "rerun last trick"
chrome.storage.local.get({ usage: {}, peekEnabled: true, peekBlocked: [], lastRun: null }).then((s) => {
  ({ usage, peekEnabled, peekBlocked, lastRun } = s);
});
chrome.storage.onChanged.addListener((ch) => {
  if (ch.peekEnabled) peekEnabled = ch.peekEnabled.newValue;
  if (ch.peekBlocked) peekBlocked = ch.peekBlocked.newValue || [];
});

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v; // only ever our own static SVG
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}

function clearUI() {
  layer.replaceChildren();
  clearTimeout(peekTimer);
  activePort?.disconnect();
  activePort = null;
}

// ---------- Peek ---------------------------------------------------------------
let peekTimer = 0;
function showPeek() {
  const { ctx, target } = sniff();
  if (!ctx.text || ctx.text.length < PEEK_MIN_CHARS) return;
  if (layer.querySelector(".bar,.result")) return; // don't stomp on an open panel
  const rect = target?.rect || target?.el?.getBoundingClientRect();
  if (!rect) return;
  clearUI();
  mount();
  const top3 = rankSkills(ctx, { usage }).slice(0, 3);
  const bar = el("div", { class: "peek", role: "toolbar", "aria-label": "Skill pet suggestions" }, [
    el("span", { class: "pet", html: PET_SVG }),
    ...top3.map((s, i) =>
      el("button", { class: i === 0 ? "first" : "", text: s.name, title: s.hint, onclick: () => run(ctx, target, { skillId: s.id }) }),
    ),
    el("button", { "aria-label": "More skills", text: "•••", onclick: () => openBar(ctx, target) }),
  ]);
  layer.append(bar);
  // Place under the selection, flipped above if there's no room; clamp to viewport.
  const bw = bar.offsetWidth;
  const bh = bar.offsetHeight;
  let top = rect.bottom + 8;
  if (top + bh > innerHeight - 8) top = Math.max(8, rect.top - bh - 8);
  const left = Math.min(Math.max(8, rect.left), innerWidth - bw - 8);
  bar.style.top = `${top}px`;
  bar.style.left = `${left}px`;
  // Ignored → duck away. Hovering keeps it.
  const arm = () => (peekTimer = setTimeout(() => bar.isConnected && bar.remove(), PEEK_TIMEOUT_MS));
  bar.addEventListener("mouseenter", () => clearTimeout(peekTimer));
  bar.addEventListener("mouseleave", arm);
  arm();
}

document.addEventListener(
  "mouseup",
  (e) => {
    if (!peekEnabled || e.composedPath().includes(host)) return;
    if (peekBlocked.some((h) => location.hostname === h || location.hostname.endsWith("." + h))) return;
    setTimeout(showPeek, 10); // let the selection settle
  },
  true,
);
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && layer.childElementCount) clearUI();
  },
  true,
);
// Typing or clicking elsewhere dismisses a peek (but not an open bar/result).
document.addEventListener(
  "mousedown",
  (e) => {
    if (!e.composedPath().includes(host) && layer.querySelector(".peek")) clearUI();
  },
  true,
);

// ---------- Burrow (command bar) -------------------------------------------------
function openBar(ctx, target) {
  if (!ctx) ({ ctx, target } = sniff());
  clearUI();
  mount();
  let selected = 0;
  let items = [];
  const input = el("input", { "aria-label": "Find a skill or type what you need", placeholder: "Find a skill, or ask anything…", autocomplete: "off" });
  const list = el("div", { class: "list", role: "listbox", "aria-label": "Skills" });
  const scope = ctx.text
    ? `Using: ${words(ctx.text)} words selected on ${ctx.host}${ctx.editable ? " (editable)" : ""}`
    : `Nothing selected · ${ctx.host}`;

  function render() {
    const q = input.value;
    items = rankSkills(ctx, { query: q, usage }).map((s) => ({ label: s.name, hint: s.hint, opts: { skillId: s.id } }));
    if (q.trim()) items.push({ label: `Ask: “${q.trim()}”`, hint: "free-form", opts: { instruction: q.trim() } });
    selected = Math.min(selected, Math.max(0, items.length - 1));
    list.replaceChildren(
      ...items.map((it, i) =>
        el("button", { class: "item", role: "option", "aria-selected": String(i === selected), onclick: () => run(ctx, target, it.opts) }, [
          el("span", { text: it.label }),
          el("span", { class: "hint", text: i === selected ? `${it.hint} · ↵` : it.hint }),
        ]),
      ),
    );
  }
  input.addEventListener("input", () => {
    selected = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keep page shortcuts (Gmail, Docs…) from firing
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      selected = (selected + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(items.length, 1);
      render();
    } else if (e.key === "Enter" && items[selected]) {
      e.preventDefault();
      run(ctx, target, items[selected].opts);
    } else if (e.key === "Escape") {
      clearUI();
    }
  });
  ["keyup", "keypress"].forEach((t) => input.addEventListener(t, (e) => e.stopPropagation()));

  layer.append(
    el("div", { class: "scrim", onclick: clearUI }),
    el("div", { class: "bar", role: "dialog", "aria-label": "Skill pet" }, [
      el("div", { class: "row" }, [el("span", { html: PET_SVG }), input, el("span", { class: "kbd", text: "esc" })]),
      list,
      el("div", { class: "foot" }, [el("span", { text: scope }), el("span", { text: "↑↓ to pick · ↵ to run" })]),
    ]),
  );
  render();
  input.focus();
}

// ---------- Result -------------------------------------------------------------
let activePort = null;
function run(ctx, target, opts) {
  clearUI();
  mount();
  const label = opts.skillId ? getSkill(opts.skillId)?.name : opts.instruction;
  lastRun = { ...opts, label };
  if (opts.skillId) usage[opts.skillId] = (usage[opts.skillId] || 0) + 1;
  chrome.storage.local.set({ usage, lastRun });

  const out = el("div", { class: "out", "aria-live": "polite", text: "" });
  const copyBtn = el("button", { class: "primary", text: "Copy", disabled: "" });
  const replaceBtn = el("button", { text: "Replace selection", disabled: "" });
  const againBtn = el("button", { text: "Run again", onclick: () => run(ctx, target, opts) });
  const panel = el("div", { class: "result thinking", role: "dialog", "aria-label": `Skill pet: ${label}` }, [
    el("div", { class: "head" }, [
      el("span", { class: "pet", html: PET_SVG }),
      el("span", { text: label }),
      el("button", { class: "x", "aria-label": "Close", text: "×", onclick: clearUI }),
    ]),
    out,
    el("div", { class: "actions" }, [copyBtn, target?.kind === "field" || target?.kind === "rich" ? replaceBtn : null, againBtn]),
  ]);
  layer.append(el("div", { class: "scrim", onclick: clearUI }), panel);

  let text = "";
  const port = chrome.runtime.connect({ name: "run-skill" });
  activePort = port;
  port.onMessage.addListener((m) => {
    if (m.type === "delta") {
      text += m.text;
      out.textContent = text;
      out.scrollTop = out.scrollHeight;
    } else if (m.type === "done") {
      panel.classList.remove("thinking");
      copyBtn.removeAttribute("disabled");
      replaceBtn.removeAttribute("disabled");
    } else if (m.type === "error") {
      panel.classList.remove("thinking");
      out.classList.add("err");
      out.textContent = m.message;
      if (m.code === "no-key") {
        out.append(" ", el("button", { text: "Open options", style: "text-decoration:underline", onclick: () => chrome.runtime.sendMessage({ type: "open-options" }) }));
      }
    }
  });
  copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(text.trim());
    copyBtn.textContent = "Copied";
  });
  replaceBtn.addEventListener("click", () => {
    const ok = replaceTarget(target, text.trim());
    if (ok) clearUI();
    else replaceBtn.textContent = "Couldn't replace — use Copy";
  });
  port.postMessage({ context: ctx, ...opts });
}

// ---------- hotkeys from the service worker -----------------------------------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "summon") openBar();
  if (msg.type === "rerun-last") {
    if (!lastRun) return openBar();
    const { ctx, target } = sniff();
    run(ctx, target, lastRun.skillId ? { skillId: lastRun.skillId } : { instruction: lastRun.instruction });
  }
});
