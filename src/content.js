// Content script: the pet squad on every page. Everything lives in one closed
// shadow root so page CSS/JS can't touch it.
//
//   Dock     – the squad (04 Pet squad). DRAG a pet onto a paragraph, image,
//              text field, Google Docs page or Figma frame; or CLICK a pet to
//              use what you've already selected / lassoed.
//   Lasso    – draw around anything (text, images, canvas apps) to pick it.
//   Pet card – that pet's skills that fit what you dropped it on.
//   Result   – streams the answer. Rewrites and comments are proposals: nothing
//              changes until you press Approve.
//   Search   – Alt+Shift+P command bar over every pet's skills (kept from v1).
//   Peek     – select text, top 3 guesses pop up (kept from v1).
import {
  CANVAS_APPS,
  describeContext,
  detectApp,
  normalizeLibrary,
  parseFigmaUrl,
  petCanRead,
  petSvg,
  petsWithSkill,
  STICKER_RADIUS,
  pointInPolygon,
  skillsFor,
  suggestPet,
} from "./library.js";

const PEEK_MIN_CHARS = 12;
const PEEK_TIMEOUT_MS = 4000;
const DRAG_THRESHOLD = 5;
const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,dd,dt,figcaption,summary,label,caption";

// ---------------------------------------------------------------- state
let lib = normalizeLibrary(null);
let usage = {};
let prefs = { peekEnabled: true, peekBlocked: [], squadVisible: true, squadCollapsed: false };
let lastRun = null;
let picked = null; // the current lasso pick: {polygon, rect, ctx, target}

chrome.storage.local.get({ library: null, usage: {}, peekEnabled: true, peekBlocked: [], squadVisible: true, squadCollapsed: false, lastRun: null }).then((s) => {
  lib = normalizeLibrary(s.library);
  usage = s.usage;
  lastRun = s.lastRun;
  prefs = { peekEnabled: s.peekEnabled, peekBlocked: s.peekBlocked, squadVisible: s.squadVisible, squadCollapsed: s.squadCollapsed };
  renderDock();
});
chrome.storage.onChanged.addListener((ch) => {
  if (ch.library) lib = normalizeLibrary(ch.library.newValue); // Studio edits apply live
  for (const k of ["peekEnabled", "peekBlocked", "squadVisible", "squadCollapsed"]) if (ch[k]) prefs[k] = ch[k].newValue;
  if (ch.library || ch.squadVisible || ch.squadCollapsed) renderDock();
});

const app = () => detectApp(location.hostname, location.href);
function baseCtx() {
  return { host: location.hostname, url: location.href, title: document.title, app: app(), kinds: [], text: "", images: [], figma: null, label: "" };
}

// ---------------------------------------------------------------- shadow root
const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Inter:wght@400;500;600&display=swap">`;
const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,sans-serif}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647;color:#1B1A1F;font-size:13px}
.layer>*{pointer-events:auto}
.layer>.ghost,.layer>.hl,.layer>.pickline{pointer-events:none}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;padding:0}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #3A6FD8;outline-offset:2px}
.display{font-family:'Bricolage Grotesque',Inter,system-ui,sans-serif;font-weight:800}
.muted{color:#5E5B66}

/* dock: 04 Pet squad */
.dock{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:flex-end;gap:18px;padding:10px 18px 8px;border-radius:22px;background:rgba(255,255,255,.9);border:1px solid #E3DFD6;box-shadow:0 10px 30px rgba(27,26,31,.14);backdrop-filter:blur(8px);user-select:none;touch-action:none}
.dock.collapsed{gap:8px;padding:6px 10px}
.pet{display:flex;flex-direction:column;align-items:center;gap:2px;cursor:grab;min-width:44px}
.pet:active{cursor:grabbing}
.pet .nm{font-size:11px;font-weight:600}
.pet .rl{font-size:10px;color:#5E5B66}
.pet.away svg{opacity:.25}
.pet .slot{width:52px;height:48px;border-radius:14px;border:2px dashed currentColor;opacity:.6}
.tool{display:flex;flex-direction:column;align-items:center;gap:2px}
.tool .ic{width:44px;height:44px;border-radius:50%;border:2px solid #E3DFD6;background:#fff;display:flex;align-items:center;justify-content:center;color:#5E5B66}
.tool .ic.on{border-color:#3A6FD8;color:#3A6FD8}
.tool .nm{font-size:11px;font-weight:600}
.sep{width:1px;align-self:stretch;background:#E3DFD6;margin:4px 0}
.mini{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center}

/* drag */
.ghost{position:fixed;transform:translate(-50%,-60%) rotate(8deg);filter:drop-shadow(0 10px 14px rgba(27,26,31,.25))}
.hl{position:fixed;border-radius:8px;background:rgba(58,111,216,.12);outline:2px dashed #3A6FD8;outline-offset:2px;transition:all .06s}
.hl .tag{position:absolute;left:0;top:-24px;background:#3A6FD8;color:#fff;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;white-space:nowrap}

/* lasso */
.lasso{position:fixed;inset:0;cursor:crosshair;background:rgba(27,26,31,.04)}
.lasso .hint,.pickchip{position:fixed;left:50%;top:16px;transform:translateX(-50%);background:#1B1A1F;color:#fff;padding:8px 14px;border-radius:999px;font-size:12.5px;box-shadow:0 8px 20px rgba(27,26,31,.25);display:flex;gap:10px;align-items:center}
.pickchip button{color:#C9B8FF;font-weight:600}
svg.pickline{position:fixed;inset:0;width:100vw;height:100vh;overflow:visible}

/* pet card (menu) */
.card{position:fixed;width:260px;background:#fff;border:1px solid #E3DFD6;border-radius:14px;box-shadow:0 12px 28px rgba(27,26,31,.18);padding:12px;display:flex;flex-direction:column;gap:6px;animation:pop .14s ease-out}
.card .top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.card .top .display{font-size:16px}
.card .ctx{font-size:11px;color:#5E5B66;margin-top:-2px}
.skill{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 8px;border-radius:8px;font-size:12.5px}
.skill:hover,.skill.first{background:var(--tint,#F0EBFF)}
.skill.first{font-weight:600}
.card .ask{display:flex;gap:6px;margin-top:2px}
.card .ask input{flex:1;min-width:0;border:1px solid #E3DFD6;border-radius:8px;padding:7px 9px;font-size:12.5px;color:#1B1A1F;background:#fff}
.card .foot{display:flex;align-items:center;gap:6px;border-top:1px solid #EEEAE2;padding-top:7px;font-size:11px;color:#5E5B66}
.card .warn{font-size:11.5px;color:#8A4B12;background:#FFF4E0;border-radius:8px;padding:7px 9px}
.card .none{font-size:12px;color:#5E5B66;padding:6px 2px}
.link{color:#3A6FD8;text-decoration:underline;font-size:11px}
@keyframes pop{from{transform:translateY(6px) scale(.97);opacity:0}}

/* sticker */
.stk{flex:none;white-space:nowrap;letter-spacing:-.02em;display:inline-flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(27,26,31,.25);font-family:'Bricolage Grotesque',Inter,sans-serif;font-weight:800;color:#1B1A1F;line-height:1;text-align:center;overflow:hidden}

/* search bar & result */
.scrim{position:fixed;inset:0;background:rgba(27,26,31,.18)}
.bar,.result{position:fixed;left:50%;top:12vh;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));background:#fff;border-radius:16px;box-shadow:0 24px 48px rgba(27,26,31,.28);overflow:hidden}
.bar .row{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #EEEAE2}
.bar input{flex:1;border:0;outline:0;font-size:16px;font-weight:500;background:none;color:#1B1A1F}
.kbd{font-size:11px;color:#5E5B66;padding:3px 6px;border:1px solid #E3DFD6;border-radius:5px}
.list{padding:6px;max-height:340px;overflow:auto;display:flex;flex-direction:column;gap:2px}
.item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 10px;border-radius:9px}
.item[aria-selected=true]{background:#FFF0E6}
.item .grow{flex:1}
.item .hint{font-size:11px;color:#5E5B66}
.bfoot{display:flex;justify-content:space-between;gap:8px;padding:9px 14px;background:#FBFAF7;border-top:1px solid #EEEAE2;font-size:11px;color:#5E5B66}
.result .head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #EEEAE2;font-weight:600}
.result .head .x{margin-left:auto;font-size:18px;line-height:1;padding:4px 8px;border-radius:8px;color:#5E5B66}
.result .sub{font-size:11px;color:#5E5B66;font-weight:400}
.out{padding:14px;max-height:46vh;overflow:auto;white-space:pre-wrap;line-height:1.5;font-size:13.5px}
.out.err{color:#9B2C1A}
.diff{padding:12px 14px;display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto}
.diff .lbl{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#5E5B66}
.diff .old{white-space:pre-wrap;color:#7A2E1F;background:#FCEDEA;border-radius:8px;padding:8px 10px;text-decoration:line-through;text-decoration-color:rgba(122,46,31,.4);max-height:120px;overflow:auto;font-size:13px}
.diff textarea{width:100%;min-height:90px;resize:vertical;border:1px solid #BFE0D2;background:#EAF6F0;border-radius:8px;padding:8px 10px;font:13.5px/1.5 Inter,system-ui,sans-serif;color:#1B1A1F}
.actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 14px;border-top:1px solid #EEEAE2}
.actions button{padding:8px 12px;border-radius:8px;border:1px solid #E3DFD6;font-weight:600;font-size:12px}
.actions button.primary{background:#1B1A1F;color:#fff;border-color:#1B1A1F}
.actions button.ok{background:#1E6B4F;color:#fff;border-color:#1E6B4F}
.actions button[disabled]{opacity:.45;cursor:default}
.actions .note{font-size:11px;color:#5E5B66;margin-left:auto}
.thinking .head svg{animation:bob .6s ease-in-out infinite alternate}
@keyframes bob{to{transform:translateY(-3px)}}

/* peek */
.peek{position:fixed;display:flex;align-items:center;gap:4px;padding:4px;background:#1B1A1F;border-radius:12px;box-shadow:0 10px 22px rgba(27,26,31,.25);animation:pop .14s ease-out}
.peek .pb{display:flex;align-items:center;gap:6px;color:#fff;padding:5px 9px 5px 5px;border-radius:8px;font-size:12px;white-space:nowrap}
.peek .pb:hover,.peek .pb.first{background:#3A3940}
.peek .more{color:#fff;padding:6px 8px;border-radius:8px}
`;

const host = document.createElement("skill-pet-root");
// Closed so page scripts can't read results; the e2e build opens it so Playwright can see in.
const shadow = host.attachShadow({ mode: typeof __SHADOW_MODE__ === "string" ? __SHADOW_MODE__ : "closed" });
shadow.innerHTML = `${FONT}<style>${CSS}</style><div class="layer"></div>`;
const layer = shadow.querySelector(".layer");
document.documentElement.appendChild(host);

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v; // only our own static SVG
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) if (c != null && c !== false) n.append(c);
  return n;
}

function sticker(skill, size = 22) {
  const { label, color, shape } = skill.sticker;
  return el("span", {
    class: "stk",
    "aria-hidden": "true",
    text: label,
    style: { width: `${size}px`, height: `${size}px`, background: color, borderRadius: STICKER_RADIUS[shape] || "50%", fontSize: `${Math.max(7, Math.round(size * (label.length <= 2 ? 0.4 : label.length <= 3 ? 0.32 : 0.25)))}px`, borderWidth: size > 30 ? "3px" : "2px" },
  });
}
const ICON = {
  lasso: `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3c4.4 0 7 2 7 4.6S13.9 12 10 12 3 10.2 3 7.6 5.6 3 10 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2.5"/><path d="M6.5 11.2c-.8 1.3-.7 2.8.6 3.6 1.2.8 1.4 2 .6 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  search: `<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  plus: `<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  lock: `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="5.5" width="7" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  min: `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

// Transient UI (menus, panels, highlight). The dock and the lasso pick persist.
function clearUI({ keepPick = true } = {}) {
  layer.querySelectorAll(".card,.result,.bar,.scrim,.peek,.hl,.ghost").forEach((n) => n.remove());
  clearTimeout(peekTimer);
  activePort?.disconnect();
  activePort = null;
  if (!keepPick) clearPick();
}
function place(node, x, y) {
  // Position a floating node near (x,y), kept inside the viewport.
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  node.style.left = `${Math.min(Math.max(8, x), innerWidth - w - 8)}px`;
  node.style.top = `${Math.min(Math.max(8, y), innerHeight - h - 8)}px`;
}

// ---------------------------------------------------------------- reading the page
function deepActiveElement() {
  let a = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}
const isField = (n) => n && (n.tagName === "TEXTAREA" || (n.tagName === "INPUT" && /^(text|search|email|url|)$/i.test(n.type)));
const editableRoot = (n) => n?.closest?.("[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']");

/** The current text selection (fields or page), or null. */
function readSelection() {
  const a = deepActiveElement();
  if (isField(a) && a.selectionEnd > a.selectionStart) {
    return { text: a.value.slice(a.selectionStart, a.selectionEnd), editable: true, rect: a.getBoundingClientRect(), target: { kind: "field", el: a, start: a.selectionStart, end: a.selectionEnd } };
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed && sel.toString().trim()) {
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const editable = Boolean(editableRoot(node));
    return { text: sel.toString(), editable, rect: range.getBoundingClientRect(), target: editable ? { kind: "rich", range: range.cloneRange() } : null };
  }
  return null;
}

/** Screenshot of a viewport rect, as a downscaled JPEG data URL. Hides our UI first. */
async function captureRect(rect) {
  layer.style.visibility = "hidden";
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "capture" });
  } finally {
    layer.style.visibility = "";
  }
  if (!res?.dataUrl) throw new Error(res?.error || "Couldn't take a screenshot of this page.");
  const img = new Image();
  img.src = res.dataUrl;
  await img.decode();
  const sx = img.naturalWidth / innerWidth;
  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  const w = Math.max(1, Math.min(innerWidth, rect.right) - x);
  const h = Math.max(1, Math.min(innerHeight, rect.bottom) - y);
  const scale = Math.min(1, 1568 / Math.max(w * sx, h * sx));
  const c = document.createElement("canvas");
  c.width = Math.round(w * sx * scale);
  c.height = Math.round(h * sx * scale);
  c.getContext("2d").drawImage(img, x * sx, y * sx, w * sx, h * sx, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

/**
 * What's under the pointer? Returns {rect, label, build()} or null.
 * build() resolves the full Context (+ a write-back target) only on drop,
 * because screenshots and Figma calls are slow.
 */
function targetAt(x, y) {
  // 1) inside the lasso pick
  if (picked && inRect(x, y, picked.rect)) return { rect: picked.rect, label: "Your lasso pick", build: async () => ({ ctx: picked.ctx, target: picked.target }) };
  // 2) inside the current text selection
  const sel = readSelection();
  if (sel && inRect(x, y, sel.rect, 12)) return { rect: sel.rect, label: "Your selection", build: async () => selectionCtx(sel) };

  layer.style.display = "none"; // look through our own UI
  const node = document.elementFromPoint(x, y);
  layer.style.display = "";
  if (!node || node === host || node === document.documentElement || node === document.body) return null;
  const a = app();

  // 3) Figma: the canvas. Uses the frame selected in Figma (it's in the URL).
  if (a === "figma") {
    const canvas = node.closest("canvas") || (node.tagName === "CANVAS" ? node : null);
    if (canvas) {
      const fig = parseFigmaUrl(location.href);
      const rect = canvas.getBoundingClientRect();
      return { rect, label: fig?.nodeId ? "Selected Figma frame" : "Figma canvas (select a frame first for comments)", build: () => figmaCtx(rect, fig) };
    }
  }
  // 4) Google Docs/Sheets/Slides draw on a canvas → screenshot the page area
  if (CANVAS_APPS.includes(a)) {
    const page = node.closest(".kix-page-paginated,.kix-page,.punch-viewer-content,.grid-container,canvas") || node;
    const rect = page.getBoundingClientRect();
    return { rect, label: "This page (screenshot)", build: async () => imageCtx(rect, "Screenshot of " + (a === "docs" ? "the doc page" : a === "sheets" ? "the sheet" : "the slide")) };
  }
  // 5) images & media
  const media = node.closest("img,picture,svg,video,canvas");
  if (media && media.getBoundingClientRect().width > 24) {
    const rect = media.getBoundingClientRect();
    return { rect, label: "Image", build: async () => imageCtx(rect, media.getAttribute("alt") ? `Image: ${media.getAttribute("alt")}` : "Image") };
  }
  // 6) text fields / rich editors → editable
  if (isField(node)) {
    const rect = node.getBoundingClientRect();
    return { rect, label: "Text field", build: async () => fieldCtx(node) };
  }
  const er = editableRoot(node);
  if (er) {
    const blk = (er.innerText || "").length < 6000 ? er : node.closest(BLOCKS + ",div") || er;
    const rect = blk.getBoundingClientRect();
    return { rect, label: "Editable text", build: async () => richCtx(blk) };
  }
  // 7) a block of text
  let blk = node.closest(BLOCKS);
  if (!blk) {
    blk = node;
    while (blk && blk !== document.body && (blk.innerText || "").trim().length < 20) blk = blk.parentElement;
  }
  if (blk && blk !== document.body && (blk.innerText || "").trim().length >= 2 && (blk.innerText || "").length < 20000) {
    const rect = blk.getBoundingClientRect();
    return { rect, label: blk.matches("h1,h2,h3,h4,h5,h6") ? "Heading" : "Text", build: async () => textCtx(blk.innerText) };
  }
  return null;
}
const inRect = (x, y, r, pad = 0) => r && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;

function selectionCtx(sel) {
  const ctx = baseCtx();
  ctx.text = sel.text.trim().slice(0, 50000);
  ctx.kinds = sel.editable ? ["text", "editable"] : ["text"];
  ctx.label = describeContext(ctx);
  return { ctx, target: sel.target };
}
function textCtx(text) {
  const ctx = baseCtx();
  ctx.text = text.trim().slice(0, 50000);
  ctx.kinds = ["text"];
  ctx.label = describeContext(ctx);
  return { ctx, target: null };
}
function fieldCtx(field) {
  const s = field.selectionEnd > field.selectionStart ? field.selectionStart : 0;
  const e = field.selectionEnd > field.selectionStart ? field.selectionEnd : field.value.length;
  const ctx = baseCtx();
  ctx.text = field.value.slice(s, e);
  ctx.kinds = ["text", "editable"];
  ctx.label = describeContext(ctx);
  return { ctx, target: { kind: "field", el: field, start: s, end: e } };
}
function richCtx(blk) {
  const range = document.createRange();
  range.selectNodeContents(blk);
  const ctx = baseCtx();
  ctx.text = (blk.innerText || "").trim().slice(0, 50000);
  ctx.kinds = ["text", "editable"];
  ctx.label = describeContext(ctx);
  return { ctx, target: { kind: "rich", range } };
}
async function imageCtx(rect, label) {
  const ctx = baseCtx();
  ctx.images = [await captureRect(rect)];
  ctx.kinds = ["image"];
  ctx.label = label;
  return { ctx, target: null };
}
async function figmaCtx(rect, fig) {
  const ctx = baseCtx();
  ctx.kinds = ["frame", "image"];
  ctx.figma = fig ? { ...fig } : null;
  // With a Figma token: a crisp render + the frame's text layers. Without: a screenshot.
  let frame = null;
  if (fig?.nodeId) {
    frame = await chrome.runtime.sendMessage({ type: "figma-frame", fileKey: fig.fileKey, nodeId: fig.nodeId }).catch(() => null);
    if (frame?.error) frame = null;
  }
  if (frame && !frame.skipped) {
    ctx.figma.name = frame.name;
    if (frame.text) {
      ctx.text = frame.text;
      ctx.kinds.push("text");
    }
    ctx.images = frame.image ? [frame.image] : [await captureRect(rect)];
  } else {
    ctx.images = [await captureRect(rect)];
  }
  ctx.label = describeContext(ctx);
  return { ctx, target: null };
}

/** Write text back where it came from. Returns false if this spot can't be edited. */
function applyReplace(target, text) {
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
    // Deprecated, but the only way that keeps the editor's own undo working.
    return document.execCommand("insertText", false, text);
  }
  return false;
}

// ---------------------------------------------------------------- dock (pet squad)
let dock = null;
function renderDock() {
  dock?.remove();
  dock = null;
  if (!prefs.squadVisible) return;
  const collapsed = prefs.squadCollapsed;
  dock = el("div", { class: "dock" + (collapsed ? " collapsed" : ""), role: "toolbar", "aria-label": "Pet squad: drag a pet onto your work" });
  for (const pet of lib.pets) {
    const p = el("div", { class: "pet", tabindex: "0", role: "button", "aria-label": `${pet.name}, ${pet.role}. Drag onto something, or press Enter to use your selection.`, title: `Drag ${pet.name} onto your work` }, [
      el("span", { html: petSvg(pet.color, collapsed ? 30 : 52) }),
      collapsed ? null : el("span", { class: "nm", text: pet.name }),
      collapsed ? null : el("span", { class: "rl", text: pet.role }),
    ]);
    p.addEventListener("pointerdown", (e) => startDrag(e, pet, p));
    p.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        usePet(pet, p.getBoundingClientRect());
      }
    });
    dock.append(p);
  }
  if (!collapsed) {
    dock.append(
      el("div", { class: "sep" }),
      tool("lasso", "Lasso", () => startLasso()),
      tool("search", "Search", () => openBar()),
      tool("plus", "Adopt", () => chrome.runtime.sendMessage({ type: "open-studio" }), "Open Skill Studio to make a new pet"),
    );
  }
  dock.append(el("button", { class: "mini muted", "aria-label": collapsed ? "Expand pet squad" : "Collapse pet squad", html: collapsed ? ICON.plus : ICON.min, onclick: () => chrome.storage.local.set({ squadCollapsed: !collapsed }) }));
  layer.append(dock);
}
function tool(icon, name, onclick, title) {
  return el("button", { class: "tool", onclick, title: title || name, "aria-label": title || name, "data-tool": icon }, [el("span", { class: "ic", html: ICON[icon] }), el("span", { class: "nm", text: name })]);
}

let drag = null;
function startDrag(e, pet, petEl) {
  if (e.button !== 0) return;
  e.preventDefault(); // keep the page's text selection alive
  const sel = readSelection(); // remember it before anything moves
  petEl.setPointerCapture(e.pointerId);
  drag = { pet, petEl, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, hl: null, target: null, sel };
  const move = (ev) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      clearUI();
      petEl.classList.add("away");
      drag.ghost = el("div", { class: "ghost", html: petSvg(pet.color, 64, true) });
      layer.append(drag.ghost);
    }
    drag.ghost.style.left = `${ev.clientX}px`;
    drag.ghost.style.top = `${ev.clientY}px`;
    drag.target = targetAt(ev.clientX, ev.clientY);
    showHighlight(drag.target);
  };
  const up = async (ev) => {
    petEl.removeEventListener("pointermove", move);
    petEl.removeEventListener("pointerup", up);
    petEl.removeEventListener("pointercancel", up);
    const d = drag;
    drag = null;
    petEl.classList.remove("away");
    d.ghost?.remove();
    if (!d.moved) return usePet(pet, petEl.getBoundingClientRect(), d.sel); // a click
    const t = d.target;
    if (!t) {
      layer.querySelector(".hl")?.remove();
      return;
    }
    await dropPet(pet, t, ev.clientX, ev.clientY);
  };
  petEl.addEventListener("pointermove", move);
  petEl.addEventListener("pointerup", up);
  petEl.addEventListener("pointercancel", up);
}

function showHighlight(t) {
  let hl = layer.querySelector(".hl");
  if (!t) return hl?.remove();
  if (!hl) {
    hl = el("div", { class: "hl" }, [el("span", { class: "tag" })]);
    layer.prepend(hl);
  }
  Object.assign(hl.style, { left: `${t.rect.left}px`, top: `${t.rect.top}px`, width: `${t.rect.width}px`, height: `${t.rect.height}px` });
  hl.firstChild.textContent = t.label;
}

async function dropPet(pet, t, x, y) {
  const card = petCard(pet, null, null, "Sniffing…");
  layer.append(card);
  place(card, x + 16, y - 20);
  try {
    const { ctx, target } = await t.build();
    card.remove();
    mountCard(pet, ctx, target, x + 16, y - 20);
  } catch (e) {
    card.querySelector(".ctx").textContent = e.message || String(e);
  }
}

/** Click (or Enter) on a pet: use the lasso pick, else the selection, else ask to drag. */
function usePet(pet, anchor, sel = readSelection()) {
  clearUI();
  let pick = null;
  if (picked) pick = { ctx: picked.ctx, target: picked.target };
  else if (sel) pick = selectionCtx(sel);
  const x = anchor.left;
  const y = anchor.top - 12;
  if (!pick) {
    const card = petCard(pet, null, null, "Drag me onto text, an image, a field or a Figma frame, or lasso something first.");
    layer.append(card);
    place(card, x, y - card.offsetHeight);
    return;
  }
  const card = mountCard(pet, pick.ctx, pick.target, x, y);
  place(card, x, y - card.offsetHeight);
}

function mountCard(pet, ctx, target, x, y) {
  const card = petCard(pet, ctx, target);
  layer.append(card);
  place(card, x, y);
  card.querySelector("button.skill,input")?.focus();
  return card;
}

/** The pet card from the 04 mockup: name, role, its skills that fit, permissions. */
function petCard(pet, ctx, target, message) {
  const tint = pet.color + "33";
  const fits = ctx ? skillsFor(lib, ctx, { petId: pet.id, usage }) : [];
  const unfit = ctx ? pet.skillIds.length - fits.length : 0;
  const access = ctx ? petCanRead(pet, ctx) : { ok: true, blocked: [] };
  const reads = [pet.canRead.text && "text", pet.canRead.images && "images & frames"].filter(Boolean).join(", ") || "nothing";

  const ask = el("input", { "aria-label": `Ask ${pet.name} anything about this`, placeholder: `Ask ${pet.name}…` });
  ask.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && ask.value.trim()) run(ctx, target, { instruction: ask.value.trim(), petId: pet.id });
    if (e.key === "Escape") clearUI();
  });
  ["keyup", "keypress"].forEach((t) => ask.addEventListener(t, (e) => e.stopPropagation()));

  return el("div", { class: "card", role: "dialog", "aria-label": `${pet.name}'s skills`, style: { "--tint": tint } }, [
    el("div", { class: "top" }, [el("span", { class: "display", text: pet.name }), el("span", { class: "muted", style: { fontSize: "11px" }, text: `${pet.role} · ${pet.skillIds.length} skills` })]),
    el("div", { class: "ctx", text: message || (ctx ? `Picked: ${ctx.label}` : "") }),
    ctx && !access.ok ? el("div", { class: "warn", text: `${pet.name} isn't allowed to read ${access.blocked.join(" or ")}. Pick another pet, or change ${pet.name}'s permissions in the Studio.` }) : null,
    ...(ctx && access.ok
      ? fits.length
        ? fits.slice(0, 6).map((s, i) => el("button", { class: "skill" + (i === 0 ? " first" : ""), onclick: () => pickSkill(ctx, target, s, pet) }, [sticker(s, 28), el("span", { text: s.name })]))
        : [el("div", { class: "none", text: `None of ${pet.name}'s skills work on ${ctx.kinds.includes("frame") || ctx.kinds.includes("image") ? "images" : "this"}. Try another pet.` })]
      : []),
    ctx && access.ok ? el("div", { class: "ask" }, [ask]) : null,
    el("div", { class: "foot" }, [
      el("span", { html: ICON.lock }),
      el("span", { text: `Can read: ${reads}` }),
      unfit > 0 && ctx ? el("span", { style: { marginLeft: "auto" }, text: `${unfit} hidden (don't fit)` }) : null,
    ]),
  ]);
}

/** "…as I ask" skills need a request first. */
function pickSkill(ctx, target, skill, pet) {
  if (!/\{\{request\}\}/.test(skill.prompt)) return run(ctx, target, { skillId: skill.id, petId: pet?.id });
  const card = layer.querySelector(".card");
  const input = el("input", { "aria-label": "How should it change?", placeholder: "How should it change? e.g. more formal" });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && input.value.trim()) run(ctx, target, { skillId: skill.id, petId: pet?.id, request: input.value.trim() });
  });
  card?.querySelector(".ask")?.replaceChildren(input);
  input.focus();
}

// ---------------------------------------------------------------- lasso
let lassoOn = false;
function startLasso() {
  if (lassoOn) return;
  clearUI({ keepPick: false });
  lassoOn = true;
  layer.querySelector('[data-tool="lasso"] .ic')?.classList.add("on");
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "pickline");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("fill", "rgba(58,111,216,.10)");
  path.setAttribute("stroke", "#3A6FD8");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-dasharray", "6 5");
  svg.append(path);
  const pts = [];
  const pane = el("div", { class: "lasso" }, [el("div", { class: "hint", text: "Draw around text, images or frames · Esc to cancel" })]);
  pane.append(svg);
  layer.append(pane);
  const d = () => "M" + pts.map((p) => p.join(",")).join("L") + (pts.length > 2 ? "Z" : "");
  pane.addEventListener("pointerdown", (e) => {
    pane.setPointerCapture(e.pointerId);
    pts.length = 0;
    pts.push([e.clientX, e.clientY]);
  });
  pane.addEventListener("pointermove", (e) => {
    if (!pts.length || !(e.buttons & 1)) return;
    const [lx, ly] = pts[pts.length - 1];
    if (Math.hypot(e.clientX - lx, e.clientY - ly) > 4) pts.push([e.clientX, e.clientY]);
    path.setAttribute("d", d());
  });
  pane.addEventListener("pointerup", async () => {
    pane.remove();
    lassoOn = false;
    layer.querySelector('[data-tool="lasso"] .ic')?.classList.remove("on");
    if (pts.length < 3) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const rect = new DOMRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (rect.width < 10 || rect.height < 10) return;
    svg.setAttribute("class", "pickline");
    layer.prepend(svg); // keep the outline as the visible "pick"
    const chip = el("div", { class: "pickchip", role: "status", text: "Reading your pick…" });
    layer.append(chip);
    try {
      const ctx = await lassoCtx(pts, rect);
      picked = { polygon: pts.slice(), rect, ctx, target: null, svg, chip };
      chip.replaceChildren(
        el("span", { text: `Picked: ${ctx.label}. Drag a pet here, or click one.` }),
        el("button", { text: "Clear", onclick: () => clearPick() }),
      );
    } catch (e) {
      chip.textContent = e.message || String(e);
      setTimeout(() => {
        svg.remove();
        chip.remove();
      }, 2500);
    }
  });
}
function clearPick() {
  picked?.svg.remove();
  picked?.chip.remove();
  picked = null;
}

/** Text whose lines sit inside the lasso, plus a screenshot when there are images or a canvas. */
async function lassoCtx(poly, rect) {
  const ctx = baseCtx();
  const pieces = [];
  let lastBlock = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement?.closest("script,style,noscript,skill-pet-root") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const range = document.createRange();
  for (let n = walker.nextNode(), count = 0; n && count < 20000; n = walker.nextNode(), count++) {
    range.selectNodeContents(n);
    const b = range.getBoundingClientRect();
    if (b.bottom < rect.top || b.top > rect.bottom || b.right < rect.left || b.left > rect.right) continue;
    const hit = [...range.getClientRects()].some((r) => pointInPolygon([r.left + r.width / 2, r.top + r.height / 2], poly));
    if (!hit) continue;
    const blk = n.parentElement.closest(BLOCKS + ",div,section,article") || n.parentElement;
    pieces.push((lastBlock && blk !== lastBlock ? "\n" : "") + n.nodeValue.replace(/\s+/g, " "));
    lastBlock = blk;
  }
  ctx.text = pieces.join(" ").replace(/ *\n */g, "\n").trim().slice(0, 50000);
  if (ctx.text) ctx.kinds.push("text");

  const media = [...document.querySelectorAll("img,svg,video,canvas,picture")].filter((m) => {
    if (m.closest("skill-pet-root")) return false;
    const r = m.getBoundingClientRect();
    return r.width > 24 && r.height > 24 && pointInPolygon([r.left + r.width / 2, r.top + r.height / 2], poly);
  });
  const a = app();
  if (media.length || CANVAS_APPS.includes(a) || !ctx.text) {
    ctx.images = [await captureRect(rect)];
    ctx.kinds.push("image");
  }
  if (a === "figma") {
    const fig = parseFigmaUrl(location.href);
    if (fig) {
      ctx.figma = fig;
      ctx.kinds.push("frame");
    }
  }
  ctx.label = describeContext(ctx);
  return ctx;
}

// ---------------------------------------------------------------- search bar (kept)
function openBar() {
  const sel = readSelection();
  const base = picked ? { ctx: picked.ctx, target: picked.target } : sel ? selectionCtx(sel) : { ctx: { ...baseCtx(), kinds: ["text"], label: "Nothing picked" }, target: null };
  const { ctx, target } = base;
  clearUI();
  let selected = 0;
  let items = [];
  const input = el("input", { "aria-label": "Find a skill or type what you need", placeholder: "Find a skill, or ask anything…", autocomplete: "off" });
  const list = el("div", { class: "list", role: "listbox", "aria-label": "Skills" });
  function render() {
    const q = input.value;
    items = skillsFor(lib, ctx, { query: q, usage }).map((s) => {
      const owners = petsWithSkill(lib, s.id);
      return { skill: s, label: s.name, hint: owners.length ? `via ${owners.map((p) => p.name).join(", ")}` : "no pet", opts: { skillId: s.id, petId: owners[0]?.id } };
    });
    if (q.trim()) items.push({ label: `Ask: “${q.trim()}”`, hint: "free-form", opts: { instruction: q.trim(), petId: suggestPet(lib, ctx)?.id } });
    selected = Math.min(selected, Math.max(0, items.length - 1));
    list.replaceChildren(
      ...items.map((it, i) =>
        el("button", { class: "item", role: "option", "aria-selected": String(i === selected), onclick: () => (it.skill ? pickBarSkill(it) : run(ctx, target, it.opts)) }, [
          it.skill ? sticker(it.skill, 26) : el("span", { html: ICON.search, class: "muted" }),
          el("span", { class: "grow", text: it.label }),
          el("span", { class: "hint", text: i === selected ? `${it.hint} · ↵` : it.hint }),
        ]),
      ),
    );
  }
  function pickBarSkill(it) {
    if (/\{\{request\}\}/.test(it.skill.prompt)) {
      const req = prompt("How should it change?"); // eslint-disable-line no-alert
      if (req) run(ctx, target, { ...it.opts, request: req });
      return;
    }
    run(ctx, target, it.opts);
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
      const it = items[selected];
      it.skill ? pickBarSkill(it) : run(ctx, target, it.opts);
    } else if (e.key === "Escape") clearUI();
  });
  ["keyup", "keypress"].forEach((t) => input.addEventListener(t, (e) => e.stopPropagation()));
  layer.append(
    el("div", { class: "scrim", onclick: () => clearUI() }),
    el("div", { class: "bar", role: "dialog", "aria-label": "Search skills" }, [
      el("div", { class: "row" }, [el("span", { html: petSvg(suggestPet(lib, ctx)?.color || "#FFB86B", 34) }), input, el("span", { class: "kbd", text: "esc" })]),
      list,
      el("div", { class: "bfoot" }, [el("span", { text: `Picked: ${ctx.label}` }), el("span", { text: "↑↓ ↵ · drag a pet for its own skills" })]),
    ]),
  );
  render();
  input.focus();
}

// ---------------------------------------------------------------- run + approve
let activePort = null;
function run(ctx, target, opts) {
  clearUI();
  const skill = opts.skillId ? lib.skills.find((s) => s.id === opts.skillId) : null;
  const pet = opts.petId ? lib.pets.find((p) => p.id === opts.petId) : null;
  const action = skill?.action || "answer";
  const label = skill ? skill.name : opts.instruction;
  lastRun = { ...opts, label };
  if (opts.skillId) usage[opts.skillId] = (usage[opts.skillId] || 0) + 1;
  chrome.storage.local.set({ usage, lastRun: { skillId: opts.skillId, petId: opts.petId, instruction: opts.instruction, label } });

  const canReplace = action === "replace" && Boolean(target);
  const canComment = action === "comment" && Boolean(ctx.figma?.fileKey);
  const proposing = canReplace || canComment;

  const out = el("div", { class: "out", "aria-live": "polite" });
  const proposal = el("textarea", { "aria-label": "Proposed text (you can edit it before approving)", readonly: true });
  const body = proposing
    ? el("div", { class: "diff" }, [
        canReplace ? el("div", { class: "lbl", text: "Original" }) : null,
        canReplace ? el("div", { class: "old", text: ctx.text }) : null,
        el("div", { class: "lbl", text: canReplace ? "Proposed change · edit before approving" : `Proposed comment on ${ctx.figma.name || ctx.figma.nodeId || "this file"}` }),
        proposal,
      ])
    : out;

  const status = el("span", { class: "note", role: "status" });
  const approve = proposing ? el("button", { class: "ok", text: canReplace ? "Approve & replace" : "Approve & post comment", disabled: true }) : null;
  const copy = el("button", { class: proposing ? "" : "primary", text: "Copy", disabled: true });
  const again = el("button", { text: "Run again", onclick: () => run(ctx, target, opts) });
  const discard = el("button", { text: proposing ? "Discard" : "Close", onclick: () => clearUI() });
  if (action === "replace" && !target) status.textContent = "This spot can't be edited directly. Copy and paste it.";
  if (action === "comment" && !ctx.figma) status.textContent = "Comments post to Figma frames. Here you can copy it.";

  const panel = el("div", { class: "result thinking", role: "dialog", "aria-label": label }, [
    el("div", { class: "head" }, [
      el("span", { html: petSvg(pet?.color || "#FFB86B", 30) }),
      el("span", {}, [el("div", { text: label }), el("div", { class: "sub", text: `${pet ? pet.name + " · " : ""}${ctx.label}` })]),
      el("button", { class: "x", "aria-label": "Close", text: "×", onclick: () => clearUI() }),
    ]),
    body,
    el("div", { class: "actions" }, [approve, copy, again, discard, status]),
  ]);
  layer.append(el("div", { class: "scrim", onclick: () => clearUI() }), panel);

  let text = "";
  const port = chrome.runtime.connect({ name: "run-skill" });
  activePort = port;
  port.onMessage.addListener((m) => {
    if (m.type === "delta") {
      text += m.text;
      if (proposing) proposal.value = text;
      else {
        out.textContent = text;
        out.scrollTop = out.scrollHeight;
      }
    } else if (m.type === "done") {
      panel.classList.remove("thinking");
      copy.removeAttribute("disabled");
      if (approve) {
        approve.removeAttribute("disabled");
        proposal.removeAttribute("readonly");
        proposal.value = text.trim();
      }
    } else if (m.type === "error") {
      panel.classList.remove("thinking");
      const err = el("div", { class: "out err", text: m.message });
      if (m.code === "no-key") err.append(" ", el("button", { class: "link", text: "Open options", onclick: () => chrome.runtime.sendMessage({ type: "open-options" }) }));
      body.replaceWith(err);
      approve?.remove();
    }
  });
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText((proposing ? proposal.value : text).trim());
    copy.textContent = "Copied";
  });
  approve?.addEventListener("click", async () => {
    const final = proposal.value.trim();
    approve.disabled = true;
    if (canReplace) {
      if (applyReplace(target, final)) {
        clearUI({ keepPick: false });
      } else {
        status.textContent = "Couldn't write here. Use Copy.";
        approve.disabled = false;
      }
      return;
    }
    status.textContent = "Posting…";
    const r = await chrome.runtime.sendMessage({ type: "figma-comment", fileKey: ctx.figma.fileKey, nodeId: ctx.figma.nodeId, message: final });
    if (r?.error) {
      status.textContent = r.error;
      approve.disabled = false;
    } else {
      status.textContent = "Comment posted to Figma ✓";
      approve.textContent = "Posted";
    }
  });
  port.postMessage({ context: ctx, skillId: opts.skillId, petId: opts.petId, instruction: opts.instruction, request: opts.request });
}

// ---------------------------------------------------------------- peek (kept)
let peekTimer = 0;
function showPeek() {
  if (layer.querySelector(".bar,.result,.card,.lasso") || drag) return;
  const sel = readSelection();
  if (!sel || sel.text.trim().length < PEEK_MIN_CHARS) return;
  const { ctx, target } = selectionCtx(sel);
  clearUI();
  const top3 = skillsFor(lib, ctx, { usage }).slice(0, 3);
  if (!top3.length) return;
  const bar = el("div", { class: "peek", role: "toolbar", "aria-label": "Skill pet suggestions" }, [
    ...top3.map((s, i) =>
      el("button", { class: "pb" + (i === 0 ? " first" : ""), onclick: () => run(ctx, target, { skillId: s.id, petId: petsWithSkill(lib, s.id)[0]?.id }) }, [sticker(s, 22), el("span", { text: s.name })]),
    ),
    el("button", { class: "more", "aria-label": "More skills", text: "•••", onclick: () => openBar() }),
  ]);
  layer.append(bar);
  const r = sel.rect;
  let top = r.bottom + 8;
  if (top + bar.offsetHeight > innerHeight - 90) top = Math.max(8, r.top - bar.offsetHeight - 8);
  place(bar, r.left, top);
  const arm = () => (peekTimer = setTimeout(() => bar.isConnected && bar.remove(), PEEK_TIMEOUT_MS));
  bar.addEventListener("mouseenter", () => clearTimeout(peekTimer));
  bar.addEventListener("mouseleave", arm);
  arm();
}

document.addEventListener(
  "mouseup",
  (e) => {
    if (!prefs.peekEnabled || e.composedPath().includes(host)) return;
    if (prefs.peekBlocked.some((h) => location.hostname === h || location.hostname.endsWith("." + h))) return;
    setTimeout(showPeek, 10);
  },
  true,
);
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape") return;
    if (lassoOn) {
      layer.querySelector(".lasso")?.remove();
      lassoOn = false;
      layer.querySelector('[data-tool="lasso"] .ic')?.classList.remove("on");
    } else if (layer.querySelector(".card,.result,.bar,.peek")) clearUI();
    else if (picked) clearPick();
  },
  true,
);
document.addEventListener(
  "mousedown",
  (e) => {
    if (!e.composedPath().includes(host) && layer.querySelector(".peek,.card")) clearUI();
  },
  true,
);

// ---------------------------------------------------------------- hotkeys
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "summon") openBar();
  if (msg.type === "lasso") startLasso();
  if (msg.type === "toggle-squad") chrome.storage.local.set({ squadVisible: !prefs.squadVisible });
  if (msg.type === "rerun-last") {
    if (!lastRun) return openBar();
    const sel = readSelection();
    const pick = picked ? { ctx: picked.ctx, target: picked.target } : sel ? selectionCtx(sel) : null;
    if (!pick) return openBar();
    run(pick.ctx, pick.target, lastRun);
  }
});
