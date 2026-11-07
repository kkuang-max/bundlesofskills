// Skill Studio: create/edit skills, give them stickers, group them into pets.
// Saves to chrome.storage.local "library"; open tabs pick changes up live.
import {
  KIND_LABEL,
  KINDS,
  STICKER_COLORS,
  STICKER_RADIUS,
  TEMPLATES,
  normalizeLibrary,
  petSvg,
  safeColor,
} from "./library.js";
import { STATUS_LABEL, filterHistory, mutateHistory } from "./history.js";
import { renderAnswer } from "./answer-view.js";

const APPS = { docs: "Google Docs", sheets: "Sheets", slides: "Slides", figma: "Figma", wiki: "Wikis", mail: "Mail", code: "Code sites", web: "Any web page" };
const $ = (id) => document.getElementById(id);

let lib = normalizeLibrary(null);
let filter = "all";

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v; // only our own SVG markup
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) if (c != null && c !== false) n.append(c);
  return n;
}
function sticker(st, size = 34) {
  return el("span", {
    class: "stk",
    "aria-hidden": "true",
    text: st.label,
    style: { width: `${size}px`, height: `${size}px`, background: safeColor(st.color), borderRadius: STICKER_RADIUS[st.shape] || "50%", fontSize: `${Math.max(8, Math.round(size * (st.label.length <= 2 ? 0.4 : st.label.length <= 3 ? 0.32 : 0.25)))}px`, borderWidth: size < 30 ? "2px" : "3px" },
  });
}
function toast(msg) {
  const t = el("div", { class: "toast", role: "status", text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}
const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

async function load() {
  const { library } = await chrome.storage.local.get("library");
  lib = normalizeLibrary(library);
  render();
}
async function save(msg) {
  lib = normalizeLibrary(lib);
  await chrome.storage.local.set({ library: lib });
  render();
  if (msg) toast(msg);
}
chrome.storage.onChanged.addListener((ch) => {
  if (ch.library && JSON.stringify(ch.library.newValue) !== JSON.stringify(lib)) {
    lib = normalizeLibrary(ch.library.newValue);
    render();
  }
});

// ---------------------------------------------------------------- render
function render() {
  renderLibrary();
  renderSquad();
}

function renderFilters() {
  const opts = [["all", "All"], ...KINDS.map((k) => [k, KIND_LABEL[k]])];
  $("filters").replaceChildren(
    ...opts.map(([k, label]) =>
      el("button", { class: "chip", type: "button", "aria-pressed": String(filter === k), text: label, onclick: () => ((filter = k), renderLibrary()) }),
    ),
  );
}

function skillRow(s) {
  const owners = lib.pets.filter((p) => p.skillIds.includes(s.id)).map((p) => p.name);
  // A div, not a <button>: Chromium won't start an HTML5 drag from a button.
  const row = el("div", { class: "skillrow", role: "button", tabindex: "0", draggable: "true", "aria-label": `${s.name}. Edit, or drag onto a pet.`, onclick: () => openEditor(s.id), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openEditor(s.id)) }, [
    sticker(s.sticker),
    el("span", { class: "txt" }, [
      el("div", { class: "nm", text: s.name }),
      el("div", { class: "meta", text: s.prompt }),
    ]),
    el("span", { class: "tag act", text: { answer: "Answer", replace: "Rewrite ✓", comment: "Comment ✓" }[s.action] }),
    el("span", { class: "tag", text: owners.length ? owners.join(", ") : "No pet" }),
  ]);
  row.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/x-skill-id", s.id);
    e.dataTransfer.setData("text/plain", s.name);
    e.dataTransfer.effectAllowed = "copy";
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => row.classList.remove("dragging"));
  return row;
}

function renderLibrary() {
  renderFilters();
  const q = $("q").value.trim().toLowerCase();
  const shown = lib.skills.filter(
    (s) => (filter === "all" || s.accepts.includes(filter)) && (!q || `${s.name} ${s.prompt} ${s.sticker.label}`.toLowerCase().includes(q)),
  );
  const mine = shown.filter((s) => !s.template);
  const tmpl = shown.filter((s) => s.template);
  $("libCount").textContent = `${lib.skills.length} skills`;
  $("lib").replaceChildren(
    el("div", { class: "group-h", text: `Your skills · ${mine.length}` }),
    mine.length ? el("div", { class: "skills" }, mine.map(skillRow)) : el("p", { class: "muted", style: { fontSize: "13px", margin: "4px 0" }, text: "Nothing yet. Make one with + New skill, or edit a template below." }),
    el("div", { class: "group-h", text: `Templates · ${tmpl.length}` }),
    el("div", { class: "skills" }, tmpl.map(skillRow)),
  );
}

function renderSquad() {
  const cards = lib.pets.map((pet) => {
    const members = pet.skillIds.map((id) => lib.skills.find((s) => s.id === id)).filter(Boolean);
    const drop = el("div", { class: "drop", "aria-label": `${pet.name}'s skills` },
      members.length
        ? members.map((s) =>
            el("div", { class: "member" }, [
              sticker(s.sticker, 24),
              el("span", { class: "nm", text: s.name }),
              el("button", { type: "button", "aria-label": `Remove ${s.name} from ${pet.name}`, title: "Remove", text: "×", onclick: () => ((pet.skillIds = pet.skillIds.filter((x) => x !== s.id)), save()) }),
            ]),
          )
        : [el("div", { class: "empty", text: "Drag skills here" })],
    );
    const card = el("div", { class: "pet" }, [
      el("div", { class: "top" }, [
        el("span", { html: petSvg(pet.color, 52) }),
        el("div", { class: "names" }, [
          input(pet, "name", `Name of ${pet.name}`),
          input(pet, "role", `${pet.name}'s role`, "role"),
        ]),
      ]),
      el("div", { class: "swatches", role: "group", "aria-label": `${pet.name}'s color` },
        STICKER_COLORS.map((c) => el("button", { class: "sw", type: "button", style: { background: c }, "aria-label": `Color ${c}`, "aria-pressed": String(pet.color === c), onclick: () => ((pet.color = c), save()) })),
      ),
      drop,
      el("div", { class: "perms" }, [
        el("span", { text: "Can read:" }),
        check(`${pet.id}-text`, "Text", pet.canRead.text, (v) => ((pet.canRead.text = v), save())),
        check(`${pet.id}-img`, "Images & frames", pet.canRead.images, (v) => ((pet.canRead.images = v), save())),
      ]),
      el("div", { class: "bottom" }, [
        el("label", { class: "apps" }, [
          "Comes first in ",
          (() => {
            const sel = el("select", { "aria-label": `${pet.name} comes first in` }, [
              el("option", { value: "", text: "—" }),
              ...Object.entries(APPS).map(([k, v]) => el("option", { value: k, text: v, selected: pet.apps?.[0] === k })),
            ]);
            sel.addEventListener("change", () => ((pet.apps = sel.value ? [sel.value] : []), save()));
            return sel;
          })(),
        ]),
        lib.pets.length > 1 ? el("button", { class: "btn small danger", type: "button", text: "Release", onclick: () => confirm(`Release ${pet.name}? Its skills stay in the library.`) && ((lib.pets = lib.pets.filter((p) => p !== pet)), save(`${pet.name} released`)) }) : null,
      ]),
    ]);
    // drag a skill onto the pet
    card.addEventListener("dragover", (e) => {
      if ([...e.dataTransfer.types].includes("application/x-skill-id")) {
        e.preventDefault();
        card.classList.add("over");
      }
    });
    card.addEventListener("dragleave", (e) => {
      if (!card.contains(e.relatedTarget)) card.classList.remove("over");
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("over");
      const id = e.dataTransfer.getData("application/x-skill-id");
      if (!id) return;
      if (pet.skillIds.includes(id)) return toast(`${pet.name} already knows that`);
      pet.skillIds.push(id);
      save(`${pet.name} learned ${lib.skills.find((s) => s.id === id)?.name}`);
    });
    return card;
  });
  const adopt = el("button", { class: "adopt", type: "button", onclick: adoptPet }, [el("span", { html: petSvg("#E3DFD6", 44) }), "Adopt a new pet"]);
  $("squad").replaceChildren(...cards, adopt);
}
function input(pet, key, label, cls) {
  const i = el("input", { type: "text", value: pet[key] || "", "aria-label": label, class: cls, maxlength: "24" });
  i.addEventListener("change", () => ((pet[key] = i.value.trim() || pet[key]), save()));
  return i;
}
function check(id, label, value, onchange) {
  const c = el("input", { type: "checkbox", id, checked: value });
  c.addEventListener("change", () => onchange(c.checked));
  return el("label", { for: id }, [c, label]);
}
function adoptPet() {
  const used = new Set(lib.pets.map((p) => p.color));
  const color = STICKER_COLORS.find((c) => !used.has(c)) || STICKER_COLORS[lib.pets.length % STICKER_COLORS.length];
  lib.pets.push({ id: uid("pet"), name: "New pet", role: "Helper", color, skillIds: [], canRead: { text: true, images: true }, apps: [] });
  save("Adopted! Name it and drag skills onto it.");
}

// ---------------------------------------------------------------- editor
let draft = null; // {skill, isNew, petIds:Set}
let tryImage = null;

function openEditor(id) {
  const existing = id ? lib.skills.find((s) => s.id === id) : null;
  const skill = existing
    ? structuredClone(existing)
    : { id: uid("skill"), name: "", prompt: "", accepts: ["text"], action: "answer", sticker: { label: "New", color: STICKER_COLORS[lib.skills.length % STICKER_COLORS.length], shape: "circle" }, boost: {} };
  draft = { skill, isNew: !existing, petIds: new Set(lib.pets.filter((p) => p.skillIds.includes(skill.id)).map((p) => p.id)) };
  tryImage = null;
  $("edTitle").textContent = existing ? "Edit skill" : "New skill";
  $("fName").value = skill.name;
  $("fPrompt").value = skill.prompt;
  $("fAction").value = skill.action;
  $("fLabel").value = existing ? skill.sticker.label : "";
  $("tOut").textContent = "";
  $("tOut").classList.remove("err");
  $("tImgName").textContent = "";
  $("edDelete").hidden = !existing;
  $("edDup").hidden = !existing;
  $("edReset").hidden = !TEMPLATES.some((t) => t.id === skill.id);
  $("fAccepts").replaceChildren(...KINDS.map((k) => check(`acc-${k}`, KIND_LABEL[k], skill.accepts.includes(k), (v) => {
    skill.accepts = v ? [...new Set([...skill.accepts, k])] : skill.accepts.filter((x) => x !== k);
  })));
  const apps = skill.boost?.apps || [];
  $("fApps").replaceChildren(...Object.entries(APPS).map(([k, v]) => check(`app-${k}`, v, apps.includes(k), (on) => {
    skill.boost = { ...(skill.boost || {}), apps: on ? [...new Set([...(skill.boost?.apps || []), k])] : (skill.boost?.apps || []).filter((x) => x !== k) };
  })));
  $("fPets").replaceChildren(...lib.pets.map((p) => check(`pet-${p.id}`, p.name, draft.petIds.has(p.id), (on) => (on ? draft.petIds.add(p.id) : draft.petIds.delete(p.id)))));
  renderStickerControls();
  $("editor").showModal();
  $("fName").focus();
}

function renderStickerControls() {
  const st = draft.skill.sticker;
  $("stkPreview").replaceChildren(sticker(st, 84));
  $("fColors").replaceChildren(...STICKER_COLORS.map((c) => el("button", { class: "sw", type: "button", style: { background: c, width: "24px", height: "24px" }, "aria-label": `Sticker color ${c}`, "aria-pressed": String(st.color === c), onclick: () => ((st.color = c), renderStickerControls()) })));
  $("fShapes").replaceChildren(...Object.keys(STICKER_RADIUS).map((sh) => el("button", { type: "button", "aria-label": `${sh} sticker`, "aria-pressed": String(st.shape === sh), onclick: () => ((st.shape = sh), renderStickerControls()) }, [el("span", { style: { width: "18px", height: "18px", background: "#5E5B66", borderRadius: STICKER_RADIUS[sh], display: "block" } })])));
}

function readForm() {
  const s = draft.skill;
  s.name = $("fName").value.trim();
  s.prompt = $("fPrompt").value.trim();
  s.action = $("fAction").value;
  s.sticker.label = $("fLabel").value.trim() || s.name.slice(0, 5) || "New";
  if (!s.accepts.length) s.accepts = ["text"];
  // A rewrite needs something to rewrite.
  if (s.action === "replace" && !s.accepts.includes("editable")) s.accepts.push("editable");
  if (s.action === "comment" && !s.accepts.includes("frame")) s.accepts.push("frame");
  return s;
}

$("fLabel").addEventListener("input", () => {
  draft.skill.sticker.label = $("fLabel").value.trim() || "New";
  renderStickerControls();
});
$("fName").addEventListener("input", () => {
  if (draft.isNew && !$("fLabel").value) {
    draft.skill.sticker.label = $("fName").value.trim().split(/\s+/)[0]?.slice(0, 5) || "New";
    renderStickerControls();
  }
});
$("edForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const s = readForm();
  if (!s.name || !s.prompt) return toast("A skill needs a name and an instruction");
  const i = lib.skills.findIndex((x) => x.id === s.id);
  if (i === -1) lib.skills.unshift(s);
  else lib.skills[i] = s;
  for (const p of lib.pets) {
    const has = p.skillIds.includes(s.id);
    if (draft.petIds.has(p.id) && !has) p.skillIds.push(s.id);
    if (!draft.petIds.has(p.id) && has) p.skillIds = p.skillIds.filter((x) => x !== s.id);
  }
  $("editor").close();
  save(draft.isNew ? `Made “${s.name}”` : "Saved");
});
$("edCancel").addEventListener("click", () => $("editor").close());
$("edDelete").addEventListener("click", () => {
  const s = draft.skill;
  if (!confirm(`Delete “${s.name}”? Pets lose it too.`)) return;
  lib.skills = lib.skills.filter((x) => x.id !== s.id);
  $("editor").close();
  save("Deleted");
});
$("edDup").addEventListener("click", () => {
  const s = readForm();
  const copy = { ...structuredClone(s), id: uid("skill"), name: `${s.name} copy`, template: false };
  lib.skills.unshift(copy);
  $("editor").close();
  save("Duplicated").then(() => openEditor(copy.id));
});
$("edReset").addEventListener("click", () => {
  const t = TEMPLATES.find((x) => x.id === draft.skill.id);
  if (!t) return;
  const i = lib.skills.findIndex((x) => x.id === t.id);
  lib.skills[i] = structuredClone(t);
  $("editor").close();
  save("Reset to template").then(() => openEditor(t.id));
});

// try it
$("tImg").addEventListener("change", () => {
  const f = $("tImg").files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    tryImage = r.result;
    $("tImgName").textContent = f.name;
  };
  r.readAsDataURL(f);
});
let tryPort = null;
function tryLoading(on) {
  $("tRun").disabled = on;
  $("tRun").textContent = on ? "Running…" : "Run";
  $("tStop").hidden = !on;
}
$("tStop").addEventListener("click", () => tryPort?.postMessage({ type: "stop" }));
$("tRun").addEventListener("click", () => {
  const skill = readForm();
  const text = $("tText").value.trim();
  if (!skill.prompt) return toast("Write the instruction first");
  if (!text && !tryImage) return toast("Paste some text or add an image to try it on");
  let request = "";
  if (/\{\{request\}\}/.test(skill.prompt)) request = prompt("How should it change?") || "";
  const out = $("tOut");
  out.classList.remove("err");
  out.classList.add("loading");
  const t0 = Date.now();
  const label = el("span", { text: "Generating… 0s" });
  out.replaceChildren(el("div", { style: { display: "flex", flexDirection: "column", gap: "10px", width: "100%" } }, [
    el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, [el("span", { class: "spin", "aria-hidden": "true" }), label]),
    el("div", { class: "skel", "aria-hidden": "true" }, [el("i"), el("i"), el("i")]),
  ]));
  const timer = setInterval(() => (label.textContent = `Generating… ${Math.round((Date.now() - t0) / 1000)}s`), 500);
  let got = "";
  const stopLoading = () => {
    clearInterval(timer);
    out.classList.remove("loading");
    tryLoading(false);
  };
  tryLoading(true);
  tryPort?.disconnect();
  tryPort = chrome.runtime.connect({ name: "run-skill" });
  tryPort.onMessage.addListener((m) => {
    if (m.type === "delta") {
      if (!got) out.replaceChildren();
      out.classList.remove("loading");
      got += m.text;
      renderAnswer(out, got, false);
    }
    if (m.type === "done") {
      stopLoading();
      renderAnswer(out, got, true);
      out.append(el("div", { class: "muted", style: { fontSize: "11px", marginTop: "8px" }, text: "Saved to History" }));
    }
    if (m.type === "stopped") {
      stopLoading();
      if (!got) out.textContent = "Stopped.";
    }
    if (m.type === "error") {
      stopLoading();
      out.classList.add("err");
      out.textContent = m.message;
    }
  });
  const kinds = [...(text ? ["text", "editable"] : []), ...(tryImage ? ["image", "frame"] : [])];
  tryPort.postMessage({
    source: "studio",
    skill,
    request,
    context: { host: "skill-studio", url: "", title: "Skill Studio test", app: "web", kinds, text, images: tryImage ? [tryImage] : [], figma: null, label: "Test input" },
  });
});

// ---------------------------------------------------------------- history
let hSource = "";
let historyCache = [];
async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get("history");
  historyCache = history;
  renderHistory();
}
function renderHistory() {
  $("histCount").textContent = historyCache.length ? String(historyCache.length) : "";
  if ($("viewHistory").hidden) return;
  $("hSource").replaceChildren(
    ...[["", "All"], ["page", "From pages"], ["studio", "Studio tests"]].map(([k, l]) =>
      el("button", { class: "chip", type: "button", "aria-pressed": String(hSource === k), text: l, onclick: () => ((hSource = k), renderHistory()) }),
    ),
  );
  const hosts = [...new Set(historyCache.filter((e) => e.source === "page").map((e) => e.host))].sort();
  const cur = $("hSite").value;
  $("hSite").replaceChildren(el("option", { value: "", text: "All sites" }), ...hosts.map((h) => el("option", { value: h, text: h, selected: h === cur })));
  const items = filterHistory(historyCache, { source: hSource, host: $("hSite").value, query: $("hq").value });
  $("hList").replaceChildren(
    ...(items.length ? items.map(historyCard) : [el("p", { class: "empty-h", text: historyCache.length ? "Nothing matches." : "Nothing generated yet. Drag a pet onto something on a page, or use Try it on a skill." })]),
  );
}
function historyCard(e) {
  const skill = e.skillId ? lib.skills.find((s) => s.id === e.skillId) : null;
  const st = e.sticker || skill?.sticker;
  const result = e.final || e.output;
  const when = new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return el("article", { class: "hitem" }, [
    el("div", { class: "hrow" }, [
      st ? sticker(st, 34) : el("span", { html: petSvg(e.petColor || "#FFB86B", 34) }),
      el("div", { class: "hmeta" }, [
        el("div", { class: "hname", text: e.skillName + (e.request ? ` — “${e.request}”` : "") }),
        el("div", { class: "hsub" }, [
          [e.petName, when, e.ms ? `${(e.ms / 1000).toFixed(1)}s` : ""].filter(Boolean).join(" · "),
          e.source === "studio" ? " · Studio test" : " · ",
          e.source === "page" && e.url ? el("a", { href: e.url, target: "_blank", rel: "noopener", text: e.title || e.host }) : null,
        ]),
      ]),
      el("span", { class: `hstat s-${e.status}` }, [e.status === "running" ? el("span", { class: "spin", "aria-hidden": "true" }) : null, STATUS_LABEL[e.status] || e.status]),
    ]),
    el("div", { class: "hcols" }, [
      el("div", {}, [
        el("div", { class: "hlbl", text: `What it read${e.picked ? " · " + e.picked : ""}` }),
        el("div", { class: "hbox", text: e.input || (e.images ? `(${e.images} image${e.images > 1 ? "s" : ""})` : "(nothing)") }),
      ]),
      el("div", {}, [
        el("div", { class: "hlbl", text: e.final && e.final !== e.output ? "Applied (edited before approving)" : e.status === "posted" ? "Posted comment" : e.status === "approved" ? "Applied" : "Generated" }),
        e.status === "running" && !result
          ? el("div", { class: "hbox" }, [el("div", { class: "skel" }, [el("i"), el("i"), el("i")])])
          : (() => {
              const box = el("div", { class: "hbox out-box" + (e.status === "error" ? " err" : "") });
              if (result && e.status !== "error") renderAnswer(box, result, true);
              else box.textContent = result || e.error || "(no text)";
              return box;
            })(),
      ]),
    ]),
    el("div", { class: "hact" }, [
      el("button", { class: "btn small", type: "button", text: "Expand", "aria-pressed": "false", onclick: (ev) => { const big = ev.target.closest(".hitem").classList.toggle("big"); ev.target.textContent = big ? "Shrink" : "Expand"; ev.target.setAttribute("aria-pressed", String(big)); } }),
      result ? el("button", { class: "btn small", type: "button", text: "Copy", onclick: async (ev) => { await navigator.clipboard.writeText(result); ev.target.textContent = "Copied"; } }) : null,
      el("button", { class: "btn small danger", type: "button", text: "Delete", onclick: () => mutateHistory((h) => h.filter((x) => x.id !== e.id)) }),
    ]),
  ]);
}
$("hq").addEventListener("input", renderHistory);
$("hSite").addEventListener("change", renderHistory);
$("hClear").addEventListener("click", () => confirm("Clear all history?") && mutateHistory(() => []));
chrome.storage.onChanged.addListener((ch) => {
  if (ch.history) {
    historyCache = ch.history.newValue || [];
    renderHistory();
  }
});

function showTab(which) {
  const hist = which === "history";
  $("viewBuild").hidden = hist;
  $("viewHistory").hidden = !hist;
  $("tabBuild").setAttribute("aria-selected", String(!hist));
  $("tabHistory").setAttribute("aria-selected", String(hist));
  if (location.hash !== (hist ? "#history" : "")) history.replaceState(null, "", hist ? "#history" : location.pathname);
  renderHistory();
}
$("tabBuild").addEventListener("click", () => showTab("build"));
$("tabHistory").addEventListener("click", () => showTab("history"));
window.addEventListener("hashchange", () => showTab(location.hash === "#history" ? "history" : "build"));

// ---------------------------------------------------------------- import / export
$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(lib, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "skill-pet-library.json" });
  a.click();
  URL.revokeObjectURL(a.href);
});
$("importFile").addEventListener("change", async () => {
  const f = $("importFile").files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.skills) || !Array.isArray(data.pets)) throw new Error("not a library");
    if (!confirm(`Replace your library with ${data.skills.length} skills and ${data.pets.length} pets from ${f.name}?`)) return;
    lib = normalizeLibrary(data);
    save("Imported");
  } catch {
    toast("That file isn't a Skill Pet library");
  } finally {
    $("importFile").value = "";
  }
});

$("q").addEventListener("input", renderLibrary);
$("newSkill").addEventListener("click", () => openEditor(null));
$("logo").innerHTML = petSvg("#FFB86B", 30);
load();
loadHistory().then(() => showTab(location.hash === "#history" ? "history" : "build"));
