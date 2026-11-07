// Content script: the pet squad on every page. Everything lives in one closed
// shadow root so page CSS/JS can't touch it.
//
//   Dock     – the squad (04 Pet squad). DRAG a pet onto a paragraph, image,
//              text field, Google Docs page or Figma frame; or CLICK a pet to
//              use what you've already selected.
//   Select   – click paragraphs / images / fields / frames, or drag a box; Shift adds more.
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
  splitReveal,
  suggestPet,
} from "./library.js";
import { STATUS_LABEL, filterHistory, timeAgo } from "./history.js";
import { renderAnswer } from "./answer-view.js";
import { MARKDOWN_CSS, copyRich } from "./markdown.js";

const PEEK_MIN_CHARS = 12;
const PEEK_TIMEOUT_MS = 4000;
const DRAG_THRESHOLD = 5;
const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,dd,dt,figcaption,summary,label,caption";

// ---------------------------------------------------------------- state
let lib = normalizeLibrary(null);
let usage = {};
let prefs = { peekEnabled: true, peekBlocked: [], squadVisible: true, squadCollapsed: false, squadMiniStyle: "pets", pinsEnabled: true };
let lastRun = null;
let picked = null; // what the select tool picked: {rect, ctx, target, svg, chip}

chrome.storage.local.get({ library: null, usage: {}, peekEnabled: true, peekBlocked: [], squadVisible: true, squadCollapsed: false, squadMiniStyle: "pets", pinsEnabled: true, lastRun: null }).then((s) => {
  lib = normalizeLibrary(s.library);
  usage = s.usage;
  lastRun = s.lastRun;
  prefs = { peekEnabled: s.peekEnabled, peekBlocked: s.peekBlocked, squadVisible: s.squadVisible, squadCollapsed: s.squadCollapsed, squadMiniStyle: s.squadMiniStyle, pinsEnabled: s.pinsEnabled };
  renderDock();
  loadPins();
});
chrome.storage.onChanged.addListener((ch) => {
  if (ch.library) lib = normalizeLibrary(ch.library.newValue); // Studio edits apply live
  for (const k of ["peekEnabled", "peekBlocked", "squadVisible", "squadCollapsed", "squadMiniStyle", "pinsEnabled"]) if (ch[k]) prefs[k] = ch[k].newValue;
  if (ch.pinsEnabled) renderPins();
  if (ch.library) renderPins();
  if (ch.library || ch.squadVisible || ch.squadCollapsed || ch.squadMiniStyle) renderDock();
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
.dock{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:flex-end;gap:18px;padding:10px 14px 8px 18px;border-radius:22px;background:rgba(255,255,255,.92);border:1px solid #E3DFD6;box-shadow:0 10px 30px rgba(27,26,31,.14);backdrop-filter:blur(8px);user-select:none;touch-action:none;transition:gap .18s ease,padding .18s ease,border-radius .18s ease}
.pet{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:grab;min-width:44px;border-radius:12px;outline-offset:3px;transition:min-width .18s ease}
.pet:active{cursor:grabbing}
.pet .face{display:block;line-height:0;transition:transform .15s ease}
.pet:hover .face{transform:translateY(-3px) rotate(-4deg)}
.pet:hover .e-open,.pet:focus-visible .e-open,.thinking .head .e-open{display:none}
.pet:hover .e-happy,.pet:focus-visible .e-happy,.thinking .head .e-happy{display:inline!important}
.pet .face svg{width:52px;height:52px;transition:width .18s ease,height .18s ease}
.pet .dot{display:block;width:0;height:0;border-radius:50%;border:0 solid #1B1A1F;transition:all .18s ease}
.pet .nm{font-size:11px;font-weight:600}
.pet .rl{font-size:10px;color:#5E5B66}
.pet .nm,.pet .rl{max-height:16px;max-width:90px;white-space:nowrap;overflow:hidden;transition:max-height .18s ease,max-width .18s ease,opacity .18s ease}
.pet .key{position:absolute;top:-4px;right:-6px;font:600 9.5px/1 Inter,system-ui,sans-serif;color:#5E5B66;background:#fff;border:1px solid #E3DFD6;border-radius:5px;padding:2px 4px;opacity:0;transition:opacity .15s}
.dock:hover .pet .key,.dock:focus-within .pet .key,.dock.open .pet .key{opacity:1}
.pet.away .face svg,.pet.away .dot{opacity:.25}
.extras{display:flex;align-items:flex-end;gap:14px;max-width:420px;max-height:90px;overflow:hidden;transition:max-width .2s ease,max-height .2s ease,opacity .15s ease}
.tool{display:flex;flex-direction:column;align-items:center;gap:2px}
.tool .ic{width:44px;height:44px;border-radius:50%;border:2px solid #E3DFD6;background:#fff;display:flex;align-items:center;justify-content:center;color:#5E5B66}
.tool:hover .ic{border-color:#C9C3B7;color:#1B1A1F}
.tool .ic.on{border-color:#3A6FD8;color:#3A6FD8}
.tool .nm{font-size:11px;font-weight:600}
.help{align-self:center;width:24px;height:24px;border-radius:50%;border:1px solid #E3DFD6;color:#5E5B66;font-weight:700;font-size:12px}
.sep{width:1px;align-self:stretch;background:#E3DFD6;margin:4px 0}
.minbtn{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;align-self:center}
.minbtn:hover{background:#F2EFE9}

/* minimized: small pets, or dots. Opens on hover / focus / text selection / select tool / pick / drag. */
.dock.mini:not(.open){gap:8px;padding:6px 8px 6px 12px;border-radius:999px}
.dock.mini:not(.open){align-items:center}
.dock.mini:not(.open) .pet{min-width:0;gap:0}
.dock.mini:not(.open) .pet .face svg{width:30px;height:30px}
.dock.mini:not(.open) .pet .nm,.dock.mini:not(.open) .pet .rl{max-height:0;max-width:0;opacity:0}
.dock.mini:not(.open) .extras{max-width:0;max-height:0;opacity:0}
.dock.mini:not(.open) .minbtn{width:20px;height:20px}
.dock.mini.dots:not(.open){gap:7px;padding:7px 8px 7px 12px}
.dock.mini.dots:not(.open) .pet .face svg{width:0;height:0}
.dock.mini.dots:not(.open) .pet .dot{width:13px;height:13px;border-width:1.5px}
.dock.mini.dots:not(.open) .pet:hover .dot{transform:scale(1.25)}

/* hover card */
.tip{position:fixed;width:250px;background:#fff;border:1px solid #E3DFD6;border-radius:14px;box-shadow:0 14px 30px rgba(27,26,31,.18);padding:11px 12px;display:flex;flex-direction:column;gap:7px;pointer-events:none;animation:pop .12s ease-out}
.tt-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.tt-top .display{font-size:16px}
.tt-top .muted{font-size:11px}
.tt-ctx{font-size:11px;color:#234A99;background:#EAF2FD;border-radius:7px;padding:5px 8px}
.tt-list{display:flex;flex-direction:column;gap:3px}
.tt-skill{display:flex;align-items:center;gap:7px;font-size:12px;padding:2px 0}
.tt-skill .grow{flex:1;min-width:0}
.tt-skill.dim{opacity:.4}
.tt-act{font-size:10px;color:#8A4B12;background:#FFF0E6;border-radius:5px;padding:1px 5px;white-space:nowrap}
.tt-foot{display:flex;flex-direction:column;gap:2px;border-top:1px solid #EEEAE2;padding-top:6px;font-size:10.5px;color:#5E5B66}
.tt-foot svg{vertical-align:-2px}

/* keys */
kbd{font:600 10.5px/1 Inter,system-ui,sans-serif;background:#F2EFE9;border:1px solid #E3DFD6;border-bottom-width:2px;border-radius:5px;padding:2px 5px;color:#1B1A1F}
.skill .grow{flex:1;min-width:0}
.skill .num{opacity:.55}
.skill:hover .num,.skill:focus .num{opacity:1}
.kb{display:inline-flex;gap:4px;align-items:center;color:#C9C3BE;font-size:11.5px}
.kb kbd{background:#3A3940;border-color:#56545C;color:#fff}
.selecting .hint{gap:12px;white-space:nowrap}
.shortcuts{width:min(520px,calc(100vw - 32px))}
.sc{padding:8px 16px 14px;display:flex;flex-direction:column;gap:6px;max-height:62vh;overflow:auto}
.sc-h{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#5E5B66;margin-top:8px}
.sc-row{display:flex;gap:12px;align-items:center;font-size:13px}
.sc-keys{display:flex;gap:3px;min-width:120px;align-items:center;color:#5E5B66}
@media (prefers-reduced-motion:reduce){.dock,.dock *{transition:none!important}}

/* drag */
.ghost{position:fixed;transform:translate(-50%,-60%) rotate(8deg);filter:drop-shadow(0 10px 14px rgba(27,26,31,.25))}
.hl{position:fixed;border-radius:8px;background:rgba(58,111,216,.12);outline:2px dashed #3A6FD8;outline-offset:2px;transition:all .06s}
.hl .tag{position:absolute;left:0;top:-24px;background:#3A6FD8;color:#fff;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;white-space:nowrap}

/* select tool */
.selecting{position:fixed;inset:0;cursor:default;background:rgba(27,26,31,.03)}
.selecting .hl{pointer-events:none}
.marquee{position:fixed;border:1.5px solid #3A6FD8;background:rgba(58,111,216,.12);border-radius:3px;pointer-events:none}
.selecting .hint,.pickchip{position:fixed;left:50%;top:16px;transform:translateX(-50%);background:#1B1A1F;color:#fff;padding:8px 14px;border-radius:999px;font-size:12.5px;box-shadow:0 8px 20px rgba(27,26,31,.25);display:flex;gap:10px;align-items:center}
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

/* loading */
.loading{padding:16px 14px 18px;display:flex;flex-direction:column;gap:14px}
.ld-top{display:flex;align-items:center;gap:12px}
.ld-pet svg{animation:hop .55s ease-in-out infinite alternate;transform-origin:50% 100%}
@keyframes hop{from{transform:translateY(0) rotate(-4deg)}to{transform:translateY(-6px) rotate(4deg)}}
.ld-title{font-weight:600;font-size:14px}
.ld-sub{font-size:12px;color:#5E5B66}
.ld-time{margin-left:auto;font-variant-numeric:tabular-nums;font-size:12px;color:#5E5B66;background:#F2EFE9;border-radius:999px;padding:3px 9px}
.skel{display:flex;flex-direction:column;gap:9px}
.skel i{display:block;height:10px;border-radius:5px;background:linear-gradient(90deg,#EFEBE3 0%,#F8F6F1 40%,#EFEBE3 80%);background-size:300% 100%;animation:shimmer 1.2s linear infinite}
.skel i:nth-child(1){width:92%}.skel i:nth-child(2){width:78%}.skel i:nth-child(3){width:86%}.skel i:nth-child(4){width:54%}
.skel.small{padding:0 2px}.skel.small i{height:8px}
@keyframes shimmer{from{background-position:100% 0}to{background-position:-200% 0}}
.out.streaming>:last-child::after{content:"";display:inline-block;width:7px;height:15px;margin-left:2px;vertical-align:-2px;background:#1B1A1F;border-radius:1px;animation:blink 1s steps(2) infinite}
@keyframes blink{50%{opacity:0}}
.spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:rot .7s linear infinite;vertical-align:-2px;opacity:.7}
@keyframes rot{to{transform:rotate(360deg)}}
.card.sniffing .ctx{display:flex;align-items:center;gap:6px}
@media (prefers-reduced-motion:reduce){.ld-pet svg,.skel i,.spin,.out.streaming>:last-child::after,.thinking .head svg{animation:none}}
[hidden]{display:none!important}


/* long answers: expand, scroll, reveal */
.result{display:flex;flex-direction:column;max-height:calc(100vh - 24vh)}
.result .out{flex:1;min-height:0;overscroll-behavior:contain}
.result.big{width:min(1000px,calc(100vw - 32px));top:3vh;max-height:94vh}
.result.big .out{max-height:none;font-size:14.5px;line-height:1.6;padding:18px 22px}
.result.big .diff{max-height:none;flex:1}
.result.big .diff textarea{min-height:40vh}
.result .head .grow{flex:1;min-width:0}
.x.expand{margin-left:auto;display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border-radius:8px;color:#5E5B66}
.x.expand:hover,.x.expand[aria-pressed=true]{background:#F2EFE9;color:#1B1A1F}
.x.expand + .x{margin-left:0}
.history.big{width:min(760px,calc(100vw - 32px))}
.history.big .hout{max-height:none}
.hh .grow{flex:1}
.reveal{margin-top:14px;border-top:1px dashed #E3DFD6;padding-top:10px;display:flex;flex-direction:column;gap:8px;white-space:normal}
.rv-head{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#5E5B66}
.spoilers{display:flex;flex-direction:column;gap:6px}
.spoiler{display:block;width:100%;text-align:left;padding:8px 10px;border-radius:9px;background:#F2EFE9;border:1px dashed #D9D4C9;white-space:normal;font-size:13px;line-height:1.45;cursor:pointer;position:relative}
.spoiler .sp-txt{filter:blur(6px);user-select:none;transition:filter .2s}
.spoiler:not(.shown)::after{content:"Click to reveal";position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:600;color:#5E5B66;background:#fff;border:1px solid #E3DFD6;border-radius:999px;padding:2px 8px}
.spoiler.shown{background:#EAF6F0;border-style:solid;border-color:#BFE0D2;cursor:default}
.spoiler.shown .sp-txt{filter:none;user-select:text}
.hout .reveal{margin-top:8px}


/* pins: pets left where they worked */
.pins{position:fixed;left:0;top:0;width:0;height:0}
.pin{position:fixed;width:34px;height:34px;padding:0;border-radius:50%;line-height:0;filter:drop-shadow(0 4px 8px rgba(27,26,31,.28));transition:transform .12s ease;animation:pinpop .25s ease-out}
.pin:hover,.pin:focus-visible{transform:scale(1.15) rotate(-6deg)}
.pin svg{width:34px;height:34px}
.pin-count{position:absolute;top:-4px;right:-6px;min-width:16px;height:16px;border-radius:999px;background:#1B1A1F;color:#fff;font:700 10px/16px Inter,system-ui,sans-serif;text-align:center;padding:0 4px}
.pin-flag{position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);background:#1E6B4F;color:#fff;font:700 8.5px/1 Inter,system-ui,sans-serif;padding:2px 4px;border-radius:4px;white-space:nowrap}
@keyframes pinpop{from{transform:scale(.3);opacity:0}}
svg.pinline{position:fixed;inset:0;width:100vw;height:100vh;overflow:visible;pointer-events:none}
.pincard{width:340px;max-height:min(560px,calc(100vh - 24px));overflow:auto}
.pincard.big{width:min(760px,calc(100vw - 32px))}
.pincard .top{align-items:center}
.pincard .top .x{font-size:18px;line-height:1;padding:2px 6px;border-radius:8px;color:#5E5B66}
.pin-runs{display:flex;flex-direction:column;gap:6px}
.pin-run{border:1px solid #EEEAE2;border-radius:10px;padding:2px 8px 6px}
.pin-run summary{display:flex;align-items:center;gap:7px;cursor:pointer;padding:5px 0;font-size:12.5px;font-weight:600;list-style:none}
.pin-run summary::-webkit-details-marker{display:none}
.pin-run summary .grow{flex:1;min-width:0}
.pin-out{font-size:12.5px;max-height:220px;overflow:auto;padding:2px 2px 4px}
.pincard.big .pin-out{max-height:none}
.pin-more{display:flex;flex-direction:column;gap:6px;border-top:1px solid #EEEAE2;padding-top:8px}
.pin-more .lbl{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#5E5B66}
.pin-pets{display:flex;gap:2px}
.pp{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;opacity:.5;border:1px solid transparent}
.pp[aria-pressed=true]{opacity:1;border-color:#1B1A1F;background:#FBFAF7}
.pin-skills{display:flex;flex-wrap:wrap;gap:5px}
.chip-skill{display:inline-flex;align-items:center;gap:5px;padding:4px 9px 4px 4px;border:1px solid #E3DFD6;border-radius:999px;font-size:12px;background:#fff}
.chip-skill:hover{border-color:#C9C3B7;background:#FBFAF7}

/* history */
.history{position:fixed;right:16px;top:16px;bottom:100px;width:min(380px,calc(100vw - 32px));background:#fff;border:1px solid #E3DFD6;border-radius:16px;box-shadow:0 18px 40px rgba(27,26,31,.22);display:flex;flex-direction:column;overflow:hidden;animation:pop .14s ease-out}
.hh{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #EEEAE2}
.hh .x{font-size:18px;line-height:1;padding:4px 8px;border-radius:8px;color:#5E5B66}
.hctl{display:flex;flex-direction:column;gap:8px;padding:10px 14px;border-bottom:1px solid #EEEAE2}
.hctl input{border:1px solid #E3DFD6;border-radius:8px;padding:7px 9px;font-size:12.5px;color:#1B1A1F;background:#fff}
.segs{display:flex;background:#F2EFE9;border-radius:9px;padding:2px}
.seg{flex:1;padding:5px 8px;border-radius:7px;font-size:12px;color:#5E5B66;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.seg[aria-pressed=true]{background:#fff;color:#1B1A1F;font-weight:600;box-shadow:0 1px 3px rgba(27,26,31,.12)}
.hlist{flex:1;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px}
.hlist .none{font-size:12.5px;color:#5E5B66;padding:24px 8px;text-align:center}
.hitem{border:1px solid #EEEAE2;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:7px}
.hrow{display:flex;align-items:center;gap:9px}
.hmeta{flex:1;min-width:0}
.hname{font-weight:600;font-size:13px}
.hsub{font-size:11px;color:#5E5B66;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hstat{font-size:10.5px;font-weight:600;padding:3px 7px;border-radius:999px;background:#F2EFE9;color:#5E5B66;white-space:nowrap;display:inline-flex;gap:5px;align-items:center}
.hstat.s-done{background:#EAF2FD;color:#234A99}
.hstat.s-approved,.hstat.s-posted{background:#E3F3EC;color:#1E6B4F}
.hstat.s-error{background:#FCEDEA;color:#9B2C1A}
.hstat.s-running{background:#FFF0E6;color:#8A4B12}
.hout{font-size:12.5px;line-height:1.45;white-space:pre-wrap;max-height:4.4em;overflow:hidden;color:#1B1A1F}
.hout.open{max-height:none}
.hout.err{color:#9B2C1A}
.hact{display:flex;gap:12px}
.hfoot{padding:9px 14px;border-top:1px solid #EEEAE2;background:#FBFAF7}

/* peek */
.peek{position:fixed;display:flex;align-items:center;gap:4px;padding:4px;background:#1B1A1F;border-radius:12px;box-shadow:0 10px 22px rgba(27,26,31,.25);animation:pop .14s ease-out}
.peek .pb{display:flex;align-items:center;gap:6px;color:#fff;padding:5px 9px 5px 5px;border-radius:8px;font-size:12px;white-space:nowrap}
.peek .pb:hover,.peek .pb.first{background:#3A3940}
.peek .more{color:#fff;padding:6px 8px;border-radius:8px}
`;

const host = document.createElement("skill-pet-root");
// Closed so page scripts can't read results; the e2e build opens it so Playwright can see in.
const shadow = host.attachShadow({ mode: typeof __SHADOW_MODE__ === "string" ? __SHADOW_MODE__ : "closed" });
shadow.innerHTML = `${FONT}<style>${CSS}${MARKDOWN_CSS}</style><div class="layer"></div>`;
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
  expand: `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 1.5h4v4M5.5 12.5h-4v-4M12.5 1.5L8 6M1.5 12.5L6 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  shrink: `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M12.5 5.5h-4v-4M1.5 8.5h4v4M8.5 5.5L13 1M5.5 8.5L1 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  history: `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M3 3.5v3h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 6.5V10l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  select: `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.5 2"/><path d="M9.5 9.5l7.5 3-3.2 1.2-1.3 3.3z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  search: `<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  plus: `<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  lock: `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="5.5" width="7" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  min: `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

// Transient UI (menus, panels, highlight). The dock and the current pick persist.
function clearUI({ keepPick = true } = {}) {
  layer.querySelectorAll(".card,.result,.bar,.scrim,.peek,.hl,.ghost,.history,.tip,svg.pinline").forEach((n) => n.remove());
  setOpen("card", false);
  clearInterval(tickTimer);
  historyRender = null;
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
    return { text: a.value.slice(a.selectionStart, a.selectionEnd), editable: true, rect: a.getBoundingClientRect(), place: { node: a }, target: { kind: "field", el: a, start: a.selectionStart, end: a.selectionEnd } };
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed && sel.toString().trim()) {
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const editable = Boolean(editableRoot(node));
    return { text: sel.toString(), editable, rect: range.getBoundingClientRect(), place: { range: range.cloneRange() }, target: editable ? { kind: "rich", range: range.cloneRange() } : null };
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
function targetAt(x, y, { elementsOnly = false } = {}) {
  // 1) inside what the select tool picked
  if (!elementsOnly && picked && inRect(x, y, picked.rect)) return { rect: picked.rect, label: "Your selection", build: async () => ({ ctx: picked.ctx, target: picked.target }) };
  // 2) inside the current text selection
  const sel = elementsOnly ? null : readSelection();
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
      return { anchor: canvas, rect, label: fig?.nodeId ? "Selected Figma frame" : "Figma canvas (select a frame first for comments)", build: () => figmaCtx(rect, fig) };
    }
  }
  // 4) Google Docs/Sheets/Slides draw on a canvas → screenshot the page area
  if (CANVAS_APPS.includes(a)) {
    const page = node.closest(".kix-page-paginated,.kix-page,.punch-viewer-content,.grid-container,canvas") || node;
    const rect = page.getBoundingClientRect();
    return { anchor: page, rect, label: "This page (screenshot)", build: async () => imageCtx(rect, "Screenshot of " + (a === "docs" ? "the doc page" : a === "sheets" ? "the sheet" : "the slide")) };
  }
  // 5) images & media
  const media = node.closest("img,picture,svg,video,canvas");
  if (media && media.getBoundingClientRect().width > 24) {
    const rect = media.getBoundingClientRect();
    return { anchor: media, rect, label: "Image", build: async () => imageCtx(rect, media.getAttribute("alt") ? `Image: ${media.getAttribute("alt")}` : "Image") };
  }
  // 6) text fields / rich editors → editable
  if (isField(node)) {
    const rect = node.getBoundingClientRect();
    return { anchor: node, rect, label: "Text field", build: async () => fieldCtx(node) };
  }
  const er = editableRoot(node);
  if (er) {
    const blk = (er.innerText || "").length < 6000 ? er : node.closest(BLOCKS + ",div") || er;
    const rect = blk.getBoundingClientRect();
    return { anchor: blk, rect, label: "Editable text", build: async () => richCtx(blk) };
  }
  // 7) a block of text
  let blk = node.closest(BLOCKS);
  if (!blk) {
    blk = node;
    while (blk && blk !== document.body && (blk.innerText || "").trim().length < 20) blk = blk.parentElement;
  }
  if (blk && blk !== document.body && (blk.innerText || "").trim().length >= 2 && (blk.innerText || "").length < 20000) {
    const rect = blk.getBoundingClientRect();
    return { anchor: blk, rect, label: blk.matches("h1,h2,h3,h4,h5,h6") ? "Heading" : "Text", build: async () => textCtx(blk.innerText) };
  }
  return null;
}
const inRect = (x, y, r, pad = 0) => r && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;

function selectionCtx(sel) {
  const ctx = baseCtx();
  ctx.text = sel.text.trim().slice(0, 50000);
  ctx.kinds = sel.editable ? ["text", "editable"] : ["text"];
  ctx.label = describeContext(ctx);
  if (sel.place) setAnchor(ctx, [sel.place]);
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
// Full bar, or minimized to small pets / dots. A minimized bar opens while you
// hover it, focus it, select text, use the select tool, have a pick, drag a pet, or use a card.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const ALT = IS_MAC ? "⌥" : "Alt+";
let dock = null;
const openReasons = new Set();
let hoverOffTimer = 0;
function setOpen(reason, on) {
  if (on) openReasons.add(reason);
  else openReasons.delete(reason);
  dock?.classList.toggle("open", openReasons.size > 0);
}

function renderDock() {
  dock?.remove();
  dock = null;
  hideTip();
  // The old bar is gone, so its hover/focus can't end on their own.
  openReasons.delete("hover");
  openReasons.delete("focus");
  if (!prefs.squadVisible) return;
  const mini = prefs.squadCollapsed;
  dock = el("div", {
    class: `dock${mini ? " mini" : ""}${prefs.squadMiniStyle === "dots" ? " dots" : ""}${openReasons.size ? " open" : ""}`,
    role: "toolbar",
    "aria-label": "Pet squad: drag a pet onto your work",
  });
  lib.pets.forEach((pet, i) => {
    const key = i < 9 ? String(i + 1) : "";
    const p = el("div", { class: "pet", tabindex: "0", role: "button", "data-pet": pet.id, "aria-label": `${pet.name}, ${pet.role}. Drag onto something, or press Enter to use your selection.${key ? ` Shortcut ${ALT}${key}.` : ""}` }, [
      el("span", { class: "face", html: petSvg(pet, 52) }),
      el("span", { class: "dot", style: { background: pet.color }, "aria-hidden": "true" }),
      el("span", { class: "nm", text: pet.name }),
      el("span", { class: "rl", text: pet.role }),
      key ? el("kbd", { class: "key", text: key, "aria-hidden": "true" }) : null,
    ]);
    p.addEventListener("pointerdown", (e) => startDrag(e, pet, p));
    p.addEventListener("pointerenter", () => scheduleTip(pet, p));
    p.addEventListener("pointerleave", hideTipSoon);
    p.addEventListener("focus", () => showTip(pet, p));
    p.addEventListener("blur", hideTip);
    p.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        usePet(pet, p.getBoundingClientRect());
      }
    });
    dock.append(p);
  });
  dock.append(
    el("div", { class: "extras" }, [
      el("div", { class: "sep" }),
      tool("select", "Select", () => startSelect(), `Select (${ALT}⇧L, or ${ALT}click / ${ALT}drag)`),
      tool("search", "Search", () => openBar(), `Search skills (${ALT}⇧P)`),
      tool("history", "History", () => openHistory(), `What the pets generated on this site (${ALT}⇧H)`),
      tool("plus", "Adopt", () => chrome.runtime.sendMessage({ type: "open-studio" }), "Open Skill Studio to make a new pet"),
      el("button", { class: "help", "aria-label": "Keyboard shortcuts", title: `Shortcuts (${ALT}/)`, text: "?", onclick: () => openShortcuts() }),
    ]),
    el("button", {
      class: "minbtn muted",
      "aria-label": mini ? "Keep the squad expanded" : "Minimize the squad",
      title: mini ? "Keep expanded" : "Minimize",
      html: mini ? ICON.plus : ICON.min,
      onclick: () => chrome.storage.local.set({ squadCollapsed: !mini }),
    }),
  );
  dock.addEventListener("pointerenter", () => {
    clearTimeout(hoverOffTimer);
    setOpen("hover", true);
  });
  dock.addEventListener("pointerleave", () => {
    hoverOffTimer = setTimeout(() => setOpen("hover", false), 350);
  });
  dock.addEventListener("focusin", () => setOpen("focus", true));
  dock.addEventListener("focusout", (e) => !dock.contains(e.relatedTarget) && setOpen("focus", false));
  layer.append(dock);
}
function tool(icon, name, onclick, title) {
  return el("button", { class: "tool", onclick, title: title || name, "aria-label": title || name, "data-tool": icon }, [el("span", { class: "ic", html: ICON[icon] }), el("span", { class: "nm", text: name })]);
}

// Selecting text opens a minimized bar, so the pets are right there.
let selRaf = 0;
document.addEventListener("selectionchange", () => {
  cancelAnimationFrame(selRaf);
  selRaf = requestAnimationFrame(() => setOpen("selection", Boolean(readSelection())));
});

// ---------------------------------------------------------------- hover card: what a pet can do
let tipTimer = 0;
let tipOff = 0;
function scheduleTip(pet, petEl) {
  if (drag) return;
  clearTimeout(tipTimer);
  clearTimeout(tipOff);
  // Instant when moving between pets, short delay for the first one.
  tipTimer = setTimeout(() => showTip(pet, petEl), layer.querySelector(".tip") ? 0 : 220);
}
function hideTipSoon() {
  clearTimeout(tipTimer);
  tipOff = setTimeout(hideTip, 120);
}
function hideTip() {
  clearTimeout(tipTimer);
  layer.querySelector(".tip")?.remove();
}
function currentPick() {
  if (picked) return { ctx: picked.ctx, target: picked.target };
  const sel = readSelection();
  return sel ? selectionCtx(sel) : null;
}
function showTip(pet, petEl) {
  if (drag || layer.querySelector(".card,.result,.bar,.history")) return;
  hideTip();
  const pick = currentPick();
  const fitIds = pick ? new Set(skillsFor(lib, pick.ctx, { petId: pet.id }).map((s) => s.id)) : null;
  const access = pick ? petCanRead(pet, pick.ctx) : { ok: true };
  const skills = pet.skillIds.map((id) => lib.skills.find((s) => s.id === id)).filter(Boolean);
  const reads = [pet.canRead.text && "text", pet.canRead.images && "images & frames"].filter(Boolean).join(", ") || "nothing";
  const i = lib.pets.indexOf(pet);
  const ACT = { replace: "rewrites · you approve", comment: "comments · you approve" };
  const tip = el("div", { class: "tip", role: "tooltip", style: { "--tint": pet.color + "33" } }, [
    el("div", { class: "tt-top" }, [
      el("span", { class: "display", text: pet.name }),
      el("span", { class: "muted", text: `${pet.role} · ${skills.length} skill${skills.length === 1 ? "" : "s"}` }),
    ]),
    pick ? el("div", { class: "tt-ctx", text: access.ok ? `For your pick (${pick.ctx.label}): ${fitIds.size} fit` : `Can't read your pick (${pick.ctx.label})` }) : null,
    el("div", { class: "tt-list" }, skills.length
      ? skills.slice(0, 8).map((s) =>
          el("div", { class: "tt-skill" + (fitIds && (!fitIds.has(s.id) || !access.ok) ? " dim" : "") }, [
            sticker(s, 20),
            el("span", { class: "grow", text: s.name }),
            ACT[s.action] ? el("span", { class: "tt-act", text: ACT[s.action] }) : null,
          ]),
        )
      : [el("div", { class: "muted", text: "No skills yet. Teach it some in the Studio." })]),
    skills.length > 8 ? el("div", { class: "muted", style: { fontSize: "11px" }, text: `+${skills.length - 8} more` }) : null,
    el("div", { class: "tt-foot" }, [
      el("span", {}, [el("span", { html: ICON.lock }), ` Reads ${reads}`]),
      el("span", { text: i < 9 ? `Drag onto your work · ${ALT}${i + 1}` : "Drag onto your work" }),
    ]),
  ]);
  layer.append(tip);
  const r = petEl.getBoundingClientRect();
  const dr = dock.getBoundingClientRect();
  tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2), innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${Math.max(8, dr.top - tip.offsetHeight - 10)}px`;
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
      hideTip();
      setOpen("drag", true);
      petEl.classList.add("away");
      drag.ghost = el("div", { class: "ghost", html: petSvg(pet, 64, true) });
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
    setOpen("drag", false);
    petEl.classList.remove("away");
    d.ghost?.remove();
    hideTip();
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
  const card = petCard(pet, null, null, `Sniffing ${t.label.toLowerCase()}…`);
  card.classList.add("sniffing");
  card.querySelector(".ctx").prepend(spinner(), " ");
  layer.append(card);
  place(card, x + 16, y - 20);
  try {
    const { ctx, target } = await t.build();
    if (!ctx.anchorId) {
      // Pin to the thing it was dropped on, at the exact spot (as a fraction, so it survives resizes).
      const r = t.rect;
      const point = r.width && r.height ? { fx: Math.min(1, Math.max(0, (x - r.left) / r.width)), fy: Math.min(1, Math.max(0, (y - r.top) / r.height)) } : null;
      setAnchor(ctx, [t.anchor ? { node: t.anchor } : docAnchor(r)], point);
    }
    card.remove();
    mountCard(pet, ctx, target, x + 16, y - 20);
  } catch (e) {
    card.querySelector(".ctx").textContent = e.message || String(e);
  }
}

/** Click (or Enter) on a pet: use the select-tool pick, else the text selection, else ask to drag. */
function usePet(pet, anchor, sel = readSelection()) {
  clearUI();
  let pick = null;
  if (picked) pick = { ctx: picked.ctx, target: picked.target };
  else if (sel) pick = selectionCtx(sel);
  const x = anchor.left;
  const y = anchor.top - 12;
  if (!pick) {
    const card = petCard(pet, null, null, "Drag me onto text, an image, a field or a Figma frame, or select something first.");
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
  setOpen("card", true);
  (card.querySelector("button.skill") || card)?.focus();
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

  const card = el("div", { class: "card", role: "dialog", tabindex: "-1", "aria-label": `${pet.name}'s skills`, style: { "--tint": tint } }, [
    el("div", { class: "top" }, [el("span", { class: "display", text: pet.name }), el("span", { class: "muted", style: { fontSize: "11px" }, text: `${pet.role} · ${pet.skillIds.length} skills` })]),
    el("div", { class: "ctx", text: message || (ctx ? `Picked: ${ctx.label}` : "") }),
    ctx && !access.ok ? el("div", { class: "warn", text: `${pet.name} isn't allowed to read ${access.blocked.join(" or ")}. Pick another pet, or change ${pet.name}'s permissions in the Studio.` }) : null,
    ...(ctx && access.ok
      ? fits.length
        ? fits.slice(0, 9).map((s, i) => el("button", { class: "skill" + (i === 0 ? " first" : ""), onclick: () => pickSkill(ctx, target, s, pet) }, [sticker(s, 28), el("span", { class: "grow", text: s.name }), el("kbd", { class: "num", text: String(i + 1), "aria-hidden": "true" })]))
        : [el("div", { class: "none", text: `None of ${pet.name}'s skills work on ${ctx.kinds.includes("frame") || ctx.kinds.includes("image") ? "images" : "this"}. Try another pet.` })]
      : []),
    ctx && access.ok ? el("div", { class: "ask" }, [ask]) : null,
    el("div", { class: "foot" }, [
      el("span", { html: ICON.lock }),
      el("span", { text: `Can read: ${reads}` }),
      unfit > 0 && ctx ? el("span", { style: { marginLeft: "auto" }, text: `${unfit} hidden (don't fit)` }) : null,
    ]),
  ]);
  // Card keys: 1–9 run a skill, ↑↓ move, / asks, esc closes.
  card.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const btns = [...card.querySelectorAll("button.skill")];
    const d = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (d && !e.altKey && !e.metaKey && !e.ctrlKey && btns[d - 1]) {
      e.preventDefault();
      e.stopPropagation();
      btns[d - 1].click();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const i = btns.indexOf(shadow.activeElement);
      btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
    } else if (e.key === "/") {
      e.preventDefault();
      e.stopPropagation();
      card.querySelector(".ask input")?.focus();
    }
  });
  return card;
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

// ---------------------------------------------------------------- select tool
// Like a design tool's select: hover highlights the paragraph / image / field /
// frame under the pointer, click picks it, drag draws a box. Shift adds more
// (Enter or a plain click finishes). Start from the dock, Alt+Shift+L, or just
// Alt+click / Alt+drag anywhere.
let selecting = false;
let selectCancel = null;
const SVGNS = "http://www.w3.org/2000/svg";
function outlineSvg(rects) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "pickline");
  for (const r of rects) {
    const box = document.createElementNS(SVGNS, "rect");
    for (const [k, v] of Object.entries({ x: r.left - 3, y: r.top - 3, width: r.width + 6, height: r.height + 6, rx: 8, fill: "rgba(58,111,216,.10)", stroke: "#3A6FD8", "stroke-width": 2, "stroke-dasharray": "6 5" })) box.setAttribute(k, v);
    svg.append(box);
  }
  return svg;
}

function startSelect(startEvent = null) {
  if (selecting) return;
  clearUI({ keepPick: false });
  hideTip();
  selecting = true;
  setOpen("select", true);
  layer.querySelector('[data-tool="select"] .ic')?.classList.add("on");
  const picks = []; // {kind:"el", t} | {kind:"box", rect}
  let origin = null;
  let boxing = false;
  let hover = null;
  const hint = el("div", { class: "hint" }, [
    "Click something, or drag a box",
    el("span", { class: "kb" }, [el("kbd", { text: "⇧" }), " add more"]),
    el("span", { class: "kb" }, [el("kbd", { text: "↵" }), " done"]),
    el("span", { class: "kb" }, [el("kbd", { text: "esc" }), " cancel"]),
  ]);
  const hl = el("div", { class: "hl" }, [el("span", { class: "tag" })]);
  hl.hidden = true;
  const marquee = el("div", { class: "marquee" });
  marquee.hidden = true;
  let chosen = outlineSvg([]);
  const pane = el("div", { class: "selecting" }, [hint]);
  pane.append(chosen, hl, marquee);
  layer.append(pane);

  const redrawChosen = () => {
    const fresh = outlineSvg(picks.map((p) => anchorRect(p.anchor)));
    chosen.replaceWith(fresh);
    chosen = fresh;
    hint.firstChild.textContent = picks.length ? `${picks.length} selected` : "Click something, or drag a box";
  };
  const showHover = (x, y) => {
    hover = targetAt(x, y, { elementsOnly: true });
    hl.hidden = !hover;
    if (!hover) return;
    Object.assign(hl.style, { left: `${hover.rect.left}px`, top: `${hover.rect.top}px`, width: `${hover.rect.width}px`, height: `${hover.rect.height}px` });
    hl.firstChild.textContent = hover.label;
  };
  const begin = (e) => {
    e.preventDefault(); // stop Shift-click from stretching the page's own text selection
    pane.setPointerCapture(e.pointerId);
    origin = [e.clientX, e.clientY];
    boxing = false;
  };
  pane.addEventListener("mousedown", (e) => e.preventDefault());
  pane.addEventListener("pointerdown", begin);
  pane.addEventListener("pointermove", (e) => {
    if (origin && e.buttons & 1) {
      if (!boxing && Math.hypot(e.clientX - origin[0], e.clientY - origin[1]) > 6) {
        boxing = true;
        hl.hidden = true;
        marquee.hidden = false;
      }
      if (boxing) {
        const [x0, y0] = origin;
        Object.assign(marquee.style, { left: `${Math.min(x0, e.clientX)}px`, top: `${Math.min(y0, e.clientY)}px`, width: `${Math.abs(e.clientX - x0)}px`, height: `${Math.abs(e.clientY - y0)}px` });
      }
      return;
    }
    showHover(e.clientX, e.clientY);
  });
  pane.addEventListener("pointerup", (e) => {
    if (!origin) return;
    const [x0, y0] = origin;
    origin = null;
    marquee.hidden = true;
    if (boxing) {
      const rect = new DOMRect(Math.min(x0, e.clientX), Math.min(y0, e.clientY), Math.abs(e.clientX - x0), Math.abs(e.clientY - y0));
      if (rect.width > 8 && rect.height > 8) picks.push({ kind: "box", rect, anchor: docAnchor(rect) });
    } else {
      const t = targetAt(e.clientX, e.clientY, { elementsOnly: true });
      if (t) picks.push({ kind: "el", t, anchor: t.anchor ? { node: t.anchor } : docAnchor(t.rect) });
    }
    if (e.shiftKey) return redrawChosen(); // keep adding
    finish();
  });
  if (startEvent) {
    begin(startEvent); // Alt+click / Alt+drag: the pointer is already down
    showHover(startEvent.clientX, startEvent.clientY);
  }

  // Scrolling while selecting: keep the chosen outlines on their things.
  const follow = () => picks.length && redrawChosen();
  addEventListener("scroll", follow, true);
  let lastPointer = [0, 0];
  pane.addEventListener("pointermove", (e) => (lastPointer = [e.clientX, e.clientY]));
  // The page still scrolls under the select tool: scroll whatever is under the
  // pointer (an inner scroller, else the page), then re-aim the hover highlight.
  pane.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      layer.style.display = "none";
      let n = document.elementFromPoint(e.clientX, e.clientY);
      layer.style.display = "";
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
      const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
      while (n && n !== document.body && n !== document.documentElement) {
        const cs = getComputedStyle(n);
        if ((/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight) || (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth)) break;
        n = n.parentElement;
      }
      (n && n !== document.body && n !== document.documentElement ? n : document.scrollingElement || document.documentElement).scrollBy(dx, dy);
      requestAnimationFrame(() => showHover(...lastPointer));
    },
    { passive: false },
  );
  selectEnter = () => finish();
  selectCancel = () => {
    removeEventListener("scroll", follow, true);
    pane.remove();
    endSelect();
  };
  async function finish() {
    removeEventListener("scroll", follow, true);
    pane.remove();
    endSelect();
    if (!picks.length) return;
    const anchors = picks.map((p) => p.anchor);
    const rects = anchors.map(anchorRect);
    const svg = outlineSvg(rects);
    layer.prepend(svg); // the outlines stay as the visible "pick"
    const chip = el("div", { class: "pickchip", role: "status" }, [spinner(), "Reading what you selected…"]);
    layer.append(chip);
    setOpen("pick", true);
    try {
      const parts = await Promise.all(
        picks.map((p, i) => (p.kind === "box" ? regionCtx(boxPolygon(rects[i]), rects[i]).then((ctx) => ({ ctx, target: null })) : p.t.build())),
      );
      const { ctx, target } = mergePicks(parts);
      setAnchor(ctx, anchors);
      picked = { rect: unionRect(anchors.map(anchorRect)), anchors, ctx, target, svg, chip };
      const n = Math.min(lib.pets.length, 9);
      chip.replaceChildren(
        el("span", { text: `Selected: ${ctx.label}.` }),
        el("span", { class: "kb" }, [el("kbd", { text: n > 1 ? `1–${n}` : "1" }), " pick a pet"]),
        el("span", { class: "kb" }, ["or drag one here"]),
        el("button", { text: "Clear", onclick: () => clearPick() }),
      );
    } catch (e) {
      chip.textContent = e.message || String(e);
      setTimeout(() => {
        svg.remove();
        chip.remove();
        setOpen("pick", false);
      }, 2500);
    }
  }
}

// The pick is pinned to the page: each part remembers what it's attached to
// (an element, or a spot in the document for a box) and its outline follows
// it when you scroll, resize, or the layout shifts.
const docAnchor = (r) => ({ doc: new DOMRect(r.left + scrollX, r.top + scrollY, r.width, r.height) });
function anchorRect(a) {
  if (a.path && !a.node?.isConnected) a.node = safeQuery(a.path); // SPA re-render: find it again
  if (a.node?.isConnected) return a.node.getBoundingClientRect();
  if (a.range?.startContainer?.isConnected) return a.range.getBoundingClientRect();
  if (a.doc) return new DOMRect(a.doc.x - scrollX, a.doc.y - scrollY, a.doc.width, a.doc.height);
  return new DOMRect(-9999, -9999, 0, 0);
}
function unionRect(rects) {
  const l = Math.min(...rects.map((r) => r.left));
  const t = Math.min(...rects.map((r) => r.top));
  return new DOMRect(l, t, Math.max(...rects.map((r) => r.right)) - l, Math.max(...rects.map((r) => r.bottom)) - t);
}
let pinRaf = 0;
function repositionPick() {
  cancelAnimationFrame(pinRaf);
  pinRaf = requestAnimationFrame(() => {
    if (!picked?.anchors) return;
    const rects = picked.anchors.map(anchorRect);
    [...picked.svg.querySelectorAll("rect")].forEach((box, i) => {
      const r = rects[i];
      if (!r) return;
      box.setAttribute("x", r.left - 3);
      box.setAttribute("y", r.top - 3);
      box.setAttribute("width", r.width + 6);
      box.setAttribute("height", r.height + 6);
    });
    picked.rect = unionRect(rects);
  });
}
addEventListener("scroll", repositionPick, true); // capture: inner scrollers too
addEventListener("resize", repositionPick);
new ResizeObserver(repositionPick).observe(document.documentElement);


// ---------------------------------------------------------------- pins: pets stay where they worked
// After a pet generates something, it stays on the page at that exact spot as a
// small pin. Pins are anchored to the element / text / box they worked on, so
// they scroll and reflow with the page, and they're saved per page so they come
// back next visit. Click one to reread the answers, reveal quiz answers, or run
// another skill / ask a follow-up on the same spot.
const anchors = new Map(); // anchorId → {parts:[{node}|{range}|{doc}|{path}], point}
let pins = []; // see makePin()
const PAGE_KEY = location.origin + location.pathname + location.search;
const rid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function setAnchor(ctx, parts, point = null) {
  const id = rid("a");
  anchors.set(id, { parts, point });
  ctx.anchorId = id;
  return id;
}

/** A CSS path that finds this element again after a reload (or an SPA re-render). */
function cssPath(n) {
  if (!(n instanceof Element)) n = n?.parentElement;
  const parts = [];
  while (n && n !== document.body && n !== document.documentElement && parts.length < 12) {
    if (n.id && !/\d{3,}/.test(n.id)) {
      parts.unshift(`#${CSS_ESCAPE(n.id)}`);
      break;
    }
    let i = 1;
    for (let sib = n.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.tagName === n.tagName) i++;
    parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`);
    n = n.parentElement;
  }
  return parts.length ? (parts[0].startsWith("#") ? "" : "body > ") + parts.join(" > ") : "";
}
const CSS_ESCAPE = (v) => (globalThis.CSS?.escape ? globalThis.CSS.escape(v) : v.replace(/[^\w-]/g, "\\$&"));
function safeQuery(path) {
  try {
    return path ? document.querySelector(path) : null;
  } catch {
    return null;
  }
}
/** Saveable form of an anchor part. */
function serializePart(a) {
  const r = anchorRect(a);
  const doc = { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  const el = a.node || (a.range ? a.range.commonAncestorContainer : null);
  return { path: el ? cssPath(el) : "", doc };
}
function restorePart(p) {
  const node = safeQuery(p.path);
  return node ? { node, path: p.path } : { doc: new DOMRect(p.doc.x, p.doc.y, p.doc.width, p.doc.height), path: p.path };
}

function pinPoint(pin) {
  const a = anchors.get(pin.anchorId);
  if (!a) return null;
  const rects = a.parts.map(anchorRect).filter((r) => r.width || r.height);
  if (!rects.length) return null;
  const r = unionRect(rects);
  // Dropped at a spot → exactly there; otherwise the top-right corner of the thing.
  const x = a.point ? r.left + a.point.fx * r.width : r.right - 4;
  const y = a.point ? r.top + a.point.fy * r.height : r.top;
  return { x, y, rect: r };
}

const pinsLayer = el("div", { class: "pins" });
layer.prepend(pinsLayer);

function renderPins() {
  pinsLayer.replaceChildren(
    ...(prefs.pinsEnabled === false ? [] : pins).map((pin) => {
      const pet = lib.pets.find((p) => p.id === pin.petId) || { name: "Pet", species: pin.species, color: pin.color };
      const n = pin.runs.length;
      const b = el("button", {
        class: "pin",
        "data-pin": pin.id,
        "aria-label": `${pet.name} left ${n} answer${n === 1 ? "" : "s"} here: ${pin.runs[0]?.skillName || ""}. Open.`,
        title: `${pet.name}: ${pin.runs.map((r) => r.skillName).join(", ")}`,
        html: petSvg({ species: pet.species || pin.species, color: pet.color || pin.color }, 34, true),
      });
      if (n > 1) b.append(el("span", { class: "pin-count", text: String(n), "aria-hidden": "true" }));
      if (pin.runs.some((r) => r.status === "posted")) b.append(el("span", { class: "pin-flag", text: "Posted", "aria-hidden": "true" }));
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        openPinCard(pin, b);
      });
      b.addEventListener("pointerenter", () => showPinOutline(pin));
      b.addEventListener("pointerleave", () => !layer.querySelector(`.pincard[data-pin="${pin.id}"]`) && hidePinOutline());
      return b;
    }),
  );
  positionPins();
}
function positionPins() {
  for (const b of pinsLayer.children) {
    const pin = pins.find((p) => p.id === b.dataset.pin);
    const pt = pin && pinPoint(pin);
    const visible = pt && pt.y > -20 && pt.y < innerHeight + 20 && pt.x > -20 && pt.x < innerWidth + 20;
    b.hidden = !visible;
    if (visible) {
      b.style.left = `${pt.x - 17}px`;
      b.style.top = `${pt.y - 17}px`;
    }
  }
  // An open pin card and its outline follow their pin.
  const card = layer.querySelector(".pincard");
  if (card) {
    const pin = pins.find((p) => p.id === card.dataset.pin);
    const pt = pin && pinPoint(pin);
    if (pt) placeBesidePin(card, pt);
    if (pin) showPinOutline(pin);
  }
}
addEventListener("scroll", () => requestAnimationFrame(positionPins), true);
addEventListener("resize", () => requestAnimationFrame(positionPins));
new ResizeObserver(() => requestAnimationFrame(positionPins)).observe(document.documentElement);

/** Right of the pin, or left of it when there's no room, so the pin stays visible. */
function placeBesidePin(card, pt) {
  const w = card.offsetWidth;
  place(card, pt.x + 26 + w < innerWidth - 8 ? pt.x + 26 : pt.x - 26 - w, pt.y - 14);
}
function showPinOutline(pin) {
  const a = anchors.get(pin.anchorId);
  if (!a) return;
  hidePinOutline();
  const svg = outlineSvg(a.parts.map(anchorRect).filter((r) => r.width || r.height));
  svg.classList.add("pinline");
  layer.prepend(svg);
}
function hidePinOutline() {
  layer.querySelectorAll("svg.pinline").forEach((n) => n.remove());
}

async function savePins() {
  const { pins: all = {} } = await chrome.storage.local.get("pins");
  const mine = pins.map((p) => ({ ...p, parts: anchors.get(p.anchorId)?.parts.map(serializePart) || p.parts, point: anchors.get(p.anchorId)?.point || null }));
  if (mine.length) all[PAGE_KEY] = mine;
  else delete all[PAGE_KEY];
  // Keep storage bounded: the 60 most recently used pages.
  const keys = Object.keys(all).sort((a, b) => Math.max(...all[b].map((p) => p.at)) - Math.max(...all[a].map((p) => p.at)));
  for (const k of keys.slice(60)) delete all[k];
  await chrome.storage.local.set({ pins: all });
}
async function loadPins() {
  const { pins: all = {} } = await chrome.storage.local.get("pins");
  pins = (all[PAGE_KEY] || []).map((p) => {
    const anchorId = rid("a");
    anchors.set(anchorId, { parts: p.parts.map(restorePart), point: p.point });
    return { ...p, anchorId };
  });
  renderPins();
}

/** Called when a run finishes: add it to the pin on that spot (or leave a new pin). */
function pinRun(ctx, pet, skill, label, historyId) {
  if (!ctx.anchorId || !anchors.has(ctx.anchorId)) return;
  let pin = pins.find((p) => p.anchorId === ctx.anchorId);
  const { images, ...plainCtx } = ctx; // screenshots aren't stored; they're retaken when needed
  if (!pin) {
    pin = { id: rid("pin"), anchorId: ctx.anchorId, petId: pet?.id || null, species: pet?.species, color: pet?.color, ctx: plainCtx, runs: [], at: Date.now() };
    pins.push(pin);
  }
  pin.live = ctx; // this session: keep the full context (with screenshots) for follow-ups
  if (pet) Object.assign(pin, { petId: pet.id, species: pet.species, color: pet.color });
  pin.runs.unshift({ historyId, skillName: label, skillId: skill?.id || null, status: "done", at: Date.now() });
  pin.at = Date.now();
  renderPins();
  savePins();
}
function markPinRun(historyId, status) {
  const pin = pins.find((p) => p.runs.some((r) => r.historyId === historyId));
  if (!pin) return;
  pin.runs.find((r) => r.historyId === historyId).status = status;
  renderPins();
  savePins();
}
function removePin(pin) {
  pins = pins.filter((p) => p !== pin);
  hidePinOutline();
  renderPins();
  savePins();
}

/** Rebuild what's needed to run another skill on a pin's spot. */
async function pinContext(pin) {
  const a = anchors.get(pin.anchorId);
  const ctx = { ...(pin.live || pin.ctx), anchorId: pin.anchorId };
  let target = null;
  const node = a?.parts.length === 1 ? a.parts[0].node : null;
  if (node && ctx.kinds.includes("editable")) {
    if (isField(node)) target = fieldCtx(node).target;
    else if (editableRoot(node)) {
      const fresh = richCtx(node);
      target = fresh.target;
      ctx.text = fresh.ctx.text; // the text may have changed since
    }
  }
  if ((ctx.kinds.includes("image") || ctx.kinds.includes("frame")) && !(ctx.images || []).length && a) {
    const r = unionRect(a.parts.map(anchorRect));
    if (r.bottom > 0 && r.top < innerHeight) ctx.images = [await captureRect(r)];
  }
  return { ctx, target };
}

async function openPinCard(pin, pinEl) {
  clearUI();
  let petId = pin.petId && lib.pets.some((p) => p.id === pin.petId) ? pin.petId : lib.pets[0]?.id;
  const { history = [] } = await chrome.storage.local.get("history");
  const byId = new Map(history.map((e) => [e.id, e]));
  const ctx = pin.live || pin.ctx;

  const runsBox = el("div", { class: "pin-runs" });
  pin.runs.forEach((r, i) => {
    const e = byId.get(r.historyId);
    const text = e ? e.final || e.output : "";
    const outBox = el("div", { class: "pin-out" });
    if (text) renderAnswer(outBox, text, true);
    else outBox.textContent = "(This answer is no longer in History.)";
    const skill = r.skillId ? lib.skills.find((s) => s.id === r.skillId) : null;
    const item = el("details", { class: "pin-run", open: i === 0 }, [
      el("summary", {}, [
        skill ? sticker(skill, 22) : el("span", { html: ICON.search, class: "muted" }),
        el("span", { class: "grow", text: r.skillName }),
        r.status === "posted" ? el("span", { class: "hstat s-posted", text: "Posted" }) : e?.status === "approved" ? el("span", { class: "hstat s-approved", text: "Applied" }) : null,
        el("span", { class: "muted", style: { fontSize: "11px" }, text: timeAgo(r.at) }),
      ]),
      outBox,
      text ? el("div", { class: "hact" }, [el("button", { class: "link", text: "Copy", onclick: async (ev) => { await copyRich(text); ev.target.textContent = "Copied"; } })]) : null,
    ]);
    runsBox.append(item);
  });

  const skillsRow = el("div", { class: "pin-skills" });
  const petsRow = el("div", { class: "pin-pets", role: "group", "aria-label": "Which pet" });
  const ask = el("input", { "aria-label": "Ask a follow-up about this spot", placeholder: "Ask a follow-up…" });
  const renderSkills = () => {
    const pet = lib.pets.find((p) => p.id === petId);
    petsRow.replaceChildren(...lib.pets.map((p) => el("button", { class: "pp", "aria-pressed": String(p.id === petId), "aria-label": p.name, title: p.name, html: petSvg(p, 26), onclick: () => ((petId = p.id), renderSkills()) })));
    const access = pet ? petCanRead(pet, ctx) : { ok: false, blocked: [] };
    const fits = pet && access.ok ? skillsFor(lib, ctx, { petId: pet.id, usage }).slice(0, 6) : [];
    skillsRow.replaceChildren(
      ...(fits.length
        ? fits.map((s) => el("button", { class: "chip-skill", onclick: () => go({ skillId: s.id, petId }) }, [sticker(s, 20), s.name]))
        : [el("span", { class: "muted", style: { fontSize: "11.5px" }, text: access.ok ? `None of ${pet?.name}'s skills fit this.` : `${pet?.name} can't read ${access.blocked.join(" or ")}.` })]),
    );
    ask.placeholder = `Ask ${pet?.name || "a pet"} a follow-up…`;
  };
  const go = async (opts) => {
    const { ctx: fresh, target } = await pinContext(pin);
    const skill = opts.skillId ? lib.skills.find((s) => s.id === opts.skillId) : null;
    if (skill && /\{\{request\}\}/.test(skill.prompt)) {
      const req = prompt("How should it change?"); // eslint-disable-line no-alert
      if (!req) return;
      opts.request = req;
    }
    run(fresh, target, opts);
  };
  ask.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && ask.value.trim()) go({ instruction: followUp(pin, byId, ask.value.trim()), petId });
    if (e.key === "Escape") clearUI();
  });
  ["keyup", "keypress"].forEach((t) => ask.addEventListener(t, (e) => e.stopPropagation()));

  const card = el("div", { class: "card pincard", role: "dialog", "data-pin": pin.id, "aria-label": "Answers left here" }, [
    el("div", { class: "top" }, [
      el("span", { class: "display", text: "Left here" }),
      el("span", { class: "muted", style: { fontSize: "11px", marginLeft: "auto" }, text: `${pin.runs.length} answer${pin.runs.length === 1 ? "" : "s"}` }),
      expandButton(() => card),
      el("button", { class: "x", "aria-label": "Close", text: "×", onclick: () => clearUI() }),
    ]),
    el("div", { class: "ctx", text: `On: ${ctx.label || "this spot"}` }),
    runsBox,
    el("div", { class: "pin-more" }, [el("div", { class: "lbl", text: "Do more here" }), petsRow, skillsRow, el("div", { class: "ask" }, [ask])]),
    el("div", { class: "foot" }, [
      el("button", { class: "link", text: "Remove this pin", onclick: () => (removePin(pin), clearUI()) }),
      el("button", { class: "link", style: { marginLeft: "auto" }, text: "History", onclick: () => openHistory() }),
    ]),
  ]);
  renderSkills();
  layer.append(card);
  const pt = pinPoint(pin) || { x: pinEl.getBoundingClientRect().right, y: pinEl.getBoundingClientRect().top };
  placeBesidePin(card, pt);
  showPinOutline(pin);
  setOpen("card", true);
  card.querySelector(".chip-skill,input")?.focus();
}

/** Follow-ups carry the earlier answers so "make it shorter" etc. has context. */
function followUp(pin, byId, question) {
  const prev = pin.runs
    .slice(0, 3)
    .map((r) => byId.get(r.historyId))
    .filter(Boolean)
    .map((e) => `### ${e.skillName}\n${(e.final || e.output || "").slice(0, 3000)}`)
    .join("\n\n");
  return prev ? `Earlier answers about this same content:\n\n${prev}\n\nFollow-up request: ${question}` : question;
}

let selectEnter = null;
const boxPolygon = (r) => [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]];

/** Combine several picks. One pick keeps its write-back target (so a selected field can be rewritten). */
function mergePicks(parts) {
  if (parts.length === 1) return parts[0];
  const ctx = baseCtx();
  ctx.text = parts.map((p) => p.ctx.text).filter(Boolean).join("\n\n").slice(0, 50000);
  ctx.images = parts.flatMap((p) => p.ctx.images || []).slice(0, 5);
  ctx.kinds = [...new Set(parts.flatMap((p) => p.ctx.kinds).filter((k) => k !== "editable"))];
  ctx.figma = parts.find((p) => p.ctx.figma)?.ctx.figma || null;
  ctx.label = `${parts.length} items · ${describeContext(ctx)}`;
  return { ctx, target: null };
}

function endSelect() {
  selecting = false;
  selectCancel = null;
  selectEnter = null;
  setOpen("select", false);
  layer.querySelector('[data-tool="select"] .ic')?.classList.remove("on");
}
function clearPick() {
  picked?.svg.remove();
  picked?.chip.remove();
  picked = null;
  setOpen("pick", false);
}

// Alt+click / Alt+drag anywhere on the page = select, no button needed.
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!e.altKey || e.button !== 0 || e.composedPath().includes(host) || selecting) return;
    e.preventDefault();
    e.stopPropagation();
    startSelect(e);
  },
  true,
);

// ---------------------------------------------------------------- keyboard shortcuts
const typingIn = (n) => isField(n) || Boolean(editableRoot(n)) || n?.tagName === "SELECT";
function petByNumber(n) {
  const pet = lib.pets[n - 1];
  if (!pet) return;
  const petEl = dock ? [...dock.querySelectorAll(".pet")][n - 1] : null;
  setOpen("card", true);
  // Let the bar expand before measuring where the pet is.
  requestAnimationFrame(() => usePet(pet, (petEl || dock || host).getBoundingClientRect()));
}
function openShortcuts() {
  clearUI();
  const row = (keys, what) => el("div", { class: "sc-row" }, [el("span", { class: "sc-keys" }, keys.map((k) => el("kbd", { text: k }))), el("span", { text: what })]);
  layer.append(
    el("div", { class: "scrim", onclick: () => clearUI() }),
    el("div", { class: "result shortcuts", role: "dialog", "aria-label": "Keyboard shortcuts" }, [
      el("div", { class: "head" }, [el("span", { class: "display", style: { fontSize: "18px" }, text: "Shortcuts" }), el("button", { class: "x", "aria-label": "Close", text: "×", onclick: () => clearUI() })]),
      el("div", { class: "sc" }, [
        el("div", { class: "sc-h", text: "Selecting" }),
        row([`${ALT}⇧L`], "Select tool: click things or drag a box"),
        row([`${ALT}click`], "Select the thing under the pointer, straight away"),
        row([`${ALT}drag`], "Select everything in a box, straight away"),
        row(["⇧ click"], "While selecting: add more things · ↵ to finish"),
        row(["esc"], "Cancel selecting / clear the selection / close"),
        el("div", { class: "sc-h", text: "Pets" }),
        row([`${ALT}1`, "…", `${ALT}9`], "Use pet 1–9 on your pick or selection (works while typing)"),
        row(["1", "…", "9"], "Same, when you have a pick or a selection and aren't typing"),
        row(["drag a pet"], "Drop it on text, a field, an image, a Docs page or a Figma frame"),
        el("div", { class: "sc-h", text: "In a pet's card" }),
        row(["1", "…", "9"], "Run that skill"),
        row(["↑", "↓"], "Move between skills"),
        row(["/"], "Ask the pet anything"),
        el("div", { class: "sc-h", text: "Everywhere" }),
        row([`${ALT}⇧P`], "Search all skills"),
        row([`${ALT}⇧H`], "History for this site"),
        row([`${ALT}⇧S`], "Show / hide the squad"),
        row([`${ALT}⇧R`], "Rerun the last skill"),
        row([`${ALT}/`], "This list"),
      ]),
      el("div", { class: "bfoot" }, [el("span", { text: "Rebind the ⌥⇧ ones at chrome://extensions/shortcuts" })]),
    ]),
  );
}

document.addEventListener(
  "keydown",
  (e) => {
    const active = deepActiveElement();
    const inOurUI = e.composedPath().includes(host);
    const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
    // Alt+1..9 → pet n, even while typing (uses the text you selected in the field).
    if (digit && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      return petByNumber(Number(digit));
    }
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // In-page fallbacks for when Chrome didn't assign the extension shortcut.
      const act = { KeyL: () => startSelect(), KeyP: () => openBar(), KeyH: () => openHistory() }[e.code];
      if (act) {
        e.preventDefault();
        e.stopPropagation();
        return act();
      }
    }
    if (selecting && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      return selectEnter?.();
    }
    if (e.altKey && e.code === "Slash") {
      e.preventDefault();
      return openShortcuts();
    }
    // Bare 1..9 → pet n, only when there's something picked and you're not typing.
    if (digit && !e.altKey && !e.ctrlKey && !e.metaKey && !inOurUI && !typingIn(active) && !layer.querySelector(".card,.result,.bar,.history,.selecting") && (picked || readSelection())) {
      e.preventDefault();
      e.stopPropagation();
      return petByNumber(Number(digit));
    }
  },
  true,
);

/** Text inside a box (or polygon), plus a screenshot when there are images or a canvas. */
async function regionCtx(poly, rect) {
  const ctx = baseCtx();
  const pieces = [];
  let lastBlock = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement?.closest("script,style,noscript,skill-pet-root") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const range = document.createRange();
  let wordBudget = 40000;
  for (let n = walker.nextNode(), count = 0; n && count < 20000; n = walker.nextNode(), count++) {
    range.selectNodeContents(n);
    const b = range.getBoundingClientRect();
    if (b.bottom < rect.top || b.top > rect.bottom || b.right < rect.left || b.left > rect.right) continue;
    // Word by word, so a box over half a line takes just those words.
    const words = [];
    const re = /\S+/g;
    for (let m; (m = re.exec(n.nodeValue)) && wordBudget-- > 0; ) {
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (r.width && pointInPolygon([r.left + r.width / 2, r.top + r.height / 2], poly)) words.push(m[0]);
    }
    if (!words.length) continue;
    const blk = n.parentElement.closest(BLOCKS + ",div,section,article") || n.parentElement;
    pieces.push((lastBlock && blk !== lastBlock ? "\n" : "") + words.join(" "));
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
      el("div", { class: "row" }, [el("span", { html: petSvg(suggestPet(lib, ctx) || "#FFB86B", 34) }), input, el("span", { class: "kbd", text: "esc" })]),
      list,
      el("div", { class: "bfoot" }, [el("span", { text: `Picked: ${ctx.label}` }), el("span", { text: "↑↓ ↵ · drag a pet for its own skills" })]),
    ]),
  );
  render();
  input.focus();
}

// ---------------------------------------------------------------- run + approve
let activePort = null;
let tickTimer = 0;

/** The loading state shown until the first words arrive. */
function loader(pet, ctx, verb) {
  const n = (ctx.images || []).length;
  const what = [ctx.text ? `${ctx.text.trim().split(/\s+/).length} words` : "", n ? `${n} image${n > 1 ? "s" : ""}` : ""].filter(Boolean).join(" + ") || "your request";
  return el("div", { class: "loading", role: "status", "aria-live": "polite" }, [
    el("div", { class: "ld-top" }, [
      el("span", { class: "ld-pet", html: petSvg(pet || "#FFB86B", 40, true) }),
      el("div", {}, [el("div", { class: "ld-title", text: `${pet ? pet.name : "The pet"} is ${verb}…` }), el("div", { class: "ld-sub", text: `Sending ${what} to the model` })]),
      el("span", { class: "ld-time", text: "0s" }),
    ]),
    el("div", { class: "skel", "aria-hidden": "true" }, [el("i"), el("i"), el("i"), el("i")]),
  ]);
}

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
  let historyId = null;
  const logStatus = (status, final) => historyId && chrome.runtime.sendMessage({ type: "history-update", id: historyId, status, final }).catch(() => {});

  const out = el("div", { class: "out streaming", "aria-live": "polite" });
  const proposal = el("textarea", { "aria-label": "Proposed text (you can edit it before approving)", readonly: true });
  const body = proposing
    ? el("div", { class: "diff" }, [
        canReplace ? el("div", { class: "lbl", text: "Original" }) : null,
        canReplace ? el("div", { class: "old", text: ctx.text }) : null,
        el("div", { class: "lbl", text: canReplace ? "Proposed change · edit before approving" : `Proposed comment on ${ctx.figma.name || ctx.figma.nodeId || "this file"}` }),
        proposal,
      ])
    : out;
  const load = loader(pet, ctx, action === "replace" ? "rewriting" : action === "comment" ? "drafting a comment" : "thinking");

  const status = el("span", { class: "note", role: "status" });
  const approve = proposing ? el("button", { class: "ok", text: canReplace ? "Approve & replace" : "Approve & post comment", hidden: true }) : null;
  const copy = el("button", { class: proposing ? "" : "primary", text: "Copy", hidden: true });
  const again = el("button", { text: "Run again", hidden: true, onclick: () => run(ctx, target, opts) });
  const stop = el("button", { text: "Stop", onclick: () => port.postMessage({ type: "stop" }) });
  const discard = el("button", {
    text: proposing ? "Discard" : "Close",
    hidden: true,
    onclick: () => {
      if (proposing) logStatus("discarded");
      clearUI();
    },
  });
  const historyBtn = el("button", { class: "link", text: "History", onclick: () => openHistory() });
  if (action === "replace" && !target) status.textContent = "This spot can't be edited directly. Copy and paste it.";
  if (action === "comment" && !ctx.figma) status.textContent = "Comments post to Figma frames. Here you can copy it.";
  const note = status.textContent;

  const panel = el("div", { class: "result thinking", role: "dialog", "aria-label": label }, [
    el("div", { class: "head" }, [
      el("span", { html: petSvg(pet || "#FFB86B", 30) }),
      el("span", { class: "grow" }, [el("div", { text: label }), el("div", { class: "sub", text: `${pet ? pet.name + " · " : ""}${ctx.label}` })]),
      expandButton(() => panel),
      el("button", { class: "x", "aria-label": "Close", text: "×", onclick: () => clearUI() }),
    ]),
    load,
    el("div", { class: "actions" }, [approve, copy, again, stop, discard, status]),
  ]);
  layer.append(el("div", { class: "scrim", onclick: () => clearUI() }), panel);

  // Elapsed timer while generating.
  const t0 = Date.now();
  clearInterval(tickTimer);
  const tick = () => {
    const sec = Math.round((Date.now() - t0) / 1000);
    const t = load.querySelector(".ld-time");
    if (t) t.textContent = `${sec}s`;
    if (!load.isConnected) status.textContent = `Generating… ${sec}s`;
  };
  tickTimer = setInterval(tick, 500);

  const finish = (ok) => {
    clearInterval(tickTimer);
    panel.classList.remove("thinking");
    out.classList.remove("streaming");
    stop.remove();
    again.hidden = false;
    discard.hidden = false;
    if (ok) copy.hidden = false;
    status.replaceChildren(document.createTextNode(note ? note + " " : ok ? "Saved to " : "Logged in "), historyBtn);
  };

  let text = "";
  const port = chrome.runtime.connect({ name: "run-skill" });
  activePort = port;
  port.onMessage.addListener((m) => {
    if (m.type === "started") historyId = m.historyId;
    else if (m.type === "delta") {
      if (load.isConnected) load.replaceWith(body); // first words: swap the loader for the text
      text += m.text;
      if (proposing) proposal.value = text;
      else {
        // Follow the text only if you haven't scrolled up to read.
        const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
        renderAnswer(out, text, false);
        if (atBottom) out.scrollTop = out.scrollHeight;
      }
    } else if (m.type === "done") {
      if (load.isConnected) load.replaceWith(body);
      if (!proposing) renderAnswer(out, text, true);
      finish(true);
      // Leave the pet where it worked, so this answer stays reachable on the page.
      if (historyId) pinRun(ctx, pet, skill, label, historyId);
      if (approve) {
        approve.hidden = false;
        proposal.removeAttribute("readonly");
        proposal.value = text.trim();
        proposal.focus();
      }
    } else if (m.type === "stopped") {
      if (load.isConnected) load.replaceWith(el("div", { class: "out muted", text: "Stopped before any text came back." }));
      finish(Boolean(text));
      approve?.remove();
    } else if (m.type === "error") {
      const err = el("div", { class: "out err", text: m.message });
      if (m.code === "no-key") err.append(" ", el("button", { class: "link", text: "Open options", onclick: () => chrome.runtime.sendMessage({ type: "open-options" }) }));
      (load.isConnected ? load : body).replaceWith(err);
      finish(false);
      approve?.remove();
    }
  });
  copy.addEventListener("click", async () => {
    // Answers copy as rich text (formatted when pasted into Docs/Gmail); proposals as plain text.
    if (proposing) await navigator.clipboard.writeText(proposal.value.trim());
    else await copyRich(text.trim());
    copy.textContent = "Copied";
  });
  approve?.addEventListener("click", async () => {
    const final = proposal.value.trim();
    approve.disabled = true;
    if (canReplace) {
      if (applyReplace(target, final)) {
        logStatus("approved", final);
        clearUI({ keepPick: false });
      } else {
        status.textContent = "Couldn't write here. Use Copy.";
        approve.disabled = false;
      }
      return;
    }
    status.replaceChildren(spinner(), " Posting to Figma…");
    const r = await chrome.runtime.sendMessage({ type: "figma-comment", fileKey: ctx.figma.fileKey, nodeId: ctx.figma.nodeId, message: final });
    if (r?.error) {
      status.textContent = r.error;
      approve.disabled = false;
    } else {
      logStatus("posted", final);
      markPinRun(historyId, "posted");
      status.textContent = "Comment posted to Figma ✓ (inside the frame)";
      approve.textContent = "Posted";
    }
  });
  port.postMessage({ source: "page", context: ctx, skillId: opts.skillId, petId: opts.petId, instruction: opts.instruction, request: opts.request });
}

const spinner = () => el("span", { class: "spin", "aria-hidden": "true" });


// ---------------------------------------------------------------- long answers
/** Expand/shrink a panel to see more text. */
function expandButton(getPanel) {
  const b = el("button", { class: "x expand", "aria-label": "Expand to see more", "aria-pressed": "false", title: "Expand", html: ICON.expand });
  b.addEventListener("click", () => {
    const big = getPanel().classList.toggle("big");
    b.setAttribute("aria-pressed", String(big));
    b.setAttribute("aria-label", big ? "Shrink" : "Expand to see more");
    b.title = big ? "Shrink" : "Expand";
    b.innerHTML = big ? ICON.shrink : ICON.expand;
  });
  return b;
}

// Scroll our panels ourselves: canvas apps (Figma, Google Docs) swallow wheel
// events at the window, which would leave long answers unscrollable.
layer.addEventListener(
  "wheel",
  (e) => {
    const path = e.composedPath();
    const scroller = path.find((n) => n instanceof Element && layer.contains(n) && n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY));
    const panel = path.find((n) => n instanceof Element && n.matches?.(".result,.history,.card,.bar"));
    if (!scroller && !panel) return;
    e.preventDefault();
    e.stopPropagation();
    if (scroller) scroller.scrollTop += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * scroller.clientHeight : e.deltaY;
  },
  { passive: false },
);

// ---------------------------------------------------------------- history panel
// Everything generated on this site (or everywhere), newest first, live.
let historyScope = "site";
function openHistory() {
  clearUI();
  const search = el("input", { type: "search", "aria-label": "Search history", placeholder: "Search history…" });
  const list = el("div", { class: "hlist" });
  const scopeBtns = ["site", "all"].map((k) =>
    el("button", { class: "seg", "aria-pressed": String(historyScope === k), text: k === "site" ? location.hostname.replace(/^www\./, "") : "Everywhere", onclick: () => ((historyScope = k), scopeBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(["site", "all"][i] === k))), render()) }),
  );
  const panel = el("div", { class: "history", role: "dialog", "aria-label": "History" }, [
    el("div", { class: "hh" }, [
      el("span", { class: "display grow", style: { fontSize: "18px" }, text: "History" }),
      expandButton(() => panel),
      el("button", { class: "x", "aria-label": "Close history", text: "×", onclick: () => clearUI() }),
    ]),
    el("div", { class: "hctl" }, [el("div", { class: "segs", role: "group", "aria-label": "Which history" }, scopeBtns), search]),
    list,
    el("div", { class: "hfoot" }, [el("button", { class: "link", text: "Open full history in Studio", onclick: () => chrome.runtime.sendMessage({ type: "open-studio", hash: "history" }) })]),
  ]);
  search.addEventListener("keydown", (e) => e.stopPropagation());
  search.addEventListener("input", () => render());
  async function render() {
    if (!panel.isConnected) return;
    const { history = [] } = await chrome.storage.local.get("history");
    const items = filterHistory(history, { host: historyScope === "site" ? location.hostname : "", query: search.value }).slice(0, 100);
    list.replaceChildren(
      ...(items.length
        ? items.map(historyItem)
        : [el("div", { class: "none", text: historyScope === "site" ? "Nothing generated on this site yet. Drag a pet onto something." : "Nothing generated yet." })]),
    );
  }
  historyRender = render;
  layer.append(panel);
  render();
  search.focus();
}
let historyRender = null;
chrome.storage.onChanged.addListener((ch) => {
  if (ch.history && historyRender) historyRender();
});

function historyItem(e) {
  const skill = e.skillId ? lib.skills.find((s) => s.id === e.skillId) : null;
  const st = e.sticker || skill?.sticker;
  const text = e.final || e.output || e.error;
  const body = el("div", { class: "hout" + (e.status === "error" ? " err" : "") });
  if (text && e.status !== "error") renderAnswer(body, text, e.status !== "running");
  else body.textContent = text || (e.status === "running" ? "" : "(no text)");
  const more = el("button", { class: "link", text: "Show more", onclick: () => { body.classList.toggle("open"); more.textContent = body.classList.contains("open") ? "Show less" : "Show more"; } });
  return el("article", { class: "hitem" }, [
    el("div", { class: "hrow" }, [
      st ? sticker({ sticker: st }, 26) : el("span", { html: petSvg({ species: e.petSpecies, color: e.petColor }, 26) }),
      el("div", { class: "hmeta" }, [
        el("div", { class: "hname", text: e.skillName }),
        el("div", { class: "hsub", text: [e.petName, e.source === "studio" ? "Studio test" : e.picked, timeAgo(e.at)].filter(Boolean).join(" · ") }),
      ]),
      el("span", { class: `hstat s-${e.status}` }, [e.status === "running" ? spinner() : null, STATUS_LABEL[e.status] || e.status]),
    ]),
    e.status === "running" && !text ? el("div", { class: "skel small", "aria-hidden": "true" }, [el("i"), el("i")]) : body,
    el("div", { class: "hact" }, [
      text && e.status !== "error" ? el("button", { class: "link", text: "Copy", onclick: async (ev) => { await copyRich(text); ev.target.textContent = "Copied"; } }) : null,
      text && text.length > 220 ? more : null,
      historyScope === "all" && e.url && e.url !== location.href ? el("a", { class: "link", href: e.url, target: "_blank", rel: "noopener", text: e.host }) : null,
    ]),
  ]);
}

// ---------------------------------------------------------------- peek (kept)
let peekTimer = 0;
function showPeek() {
  if (layer.querySelector(".bar,.result,.card,.selecting") || drag) return;
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
    if (selecting) selectCancel?.();
    else if (layer.querySelector(".card,.result,.bar,.peek,.history")) clearUI();
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
  if (msg.type === "lasso" || msg.type === "select") startSelect();
  if (msg.type === "history") openHistory();
  if (msg.type === "toggle-squad") chrome.storage.local.set({ squadVisible: !prefs.squadVisible });
  if (msg.type === "rerun-last") {
    if (!lastRun) return openBar();
    const sel = readSelection();
    const pick = picked ? { ctx: picked.ctx, target: picked.target } : sel ? selectionCtx(sel) : null;
    if (!pick) return openBar();
    run(pick.ctx, pick.target, lastRun);
  }
});
