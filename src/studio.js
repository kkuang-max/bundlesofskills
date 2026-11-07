// Skill Studio: create/edit skills, give them stickers, group them into pets.
// Saves to chrome.storage.local "library"; open tabs pick changes up live.
import {
  KIND_LABEL,
  KINDS,
  STICKER_COLORS,
  STICKER_RADIUS,
  PET_COLORS,
  SPECIES,
  SPECIES_IDS,
  TEMPLATES,
  normalizeLibrary,
  petSvg,
  safeColor,
} from "./library.js";
import { STATUS_LABEL, filterHistory, mutateHistory } from "./history.js";
import { renderAnswer } from "./answer-view.js";
import { MARKDOWN_CSS, copyRich } from "./markdown.js";

document.head.append(Object.assign(document.createElement("style"), { textContent: MARKDOWN_CSS }));

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

// ---------------------------------------------------------------- shared bits
const SHORT_KIND = { text: "Text", editable: "Editable", image: "Images", frame: "Figma" };
const RESULT = { answer: ["Answer", ""], replace: ["Rewrites", "rw"], comment: ["Comments", "rw"] };
const RESULT_LONG = { answer: "Shows an answer you can copy", replace: "Rewrites the original after you approve", comment: "Leaves a Figma comment after you approve" };
const FILTERS = [["all", "All"], ["text", "Text"], ["editable", "Editable"], ["image", "Images"], ["frame", "Figma"]];
const CHEVRON = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 5.5L7 9l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const tint = (c, a) => {
  const n = parseInt(safeColor(c).slice(1, 7), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const tagsFor = (s) => el("span", { class: "tags" }, s.accepts.map((k) => el("span", { class: "tag", text: SHORT_KIND[k] })));
const resultFor = (s) => el("span", { class: `result ${RESULT[s.action][1]}`, text: RESULT[s.action][0] });
const byFilter = (s, f) => f === "all" || s.accepts.includes(f);
const matches = (s, q) => !q || `${s.name} ${s.prompt} ${s.sticker.label}`.toLowerCase().includes(q.toLowerCase());
function chips(box, current, onPick) {
  box.replaceChildren(...FILTERS.map(([k, l]) => el("button", { class: "chip", type: "button", "aria-pressed": String(current === k), text: l, onclick: () => onPick(k) })));
}
function avatar(pet, size, ring = false) {
  return el("span", { class: "av", style: { width: `${size}px`, height: `${size}px`, background: tint(pet.color, 0.32), boxShadow: ring ? `0 0 0 2px ${pet.color}` : "" }, html: petSvg(pet, Math.round(size * 0.82)) });
}

// ---------------------------------------------------------------- render
let view = "pets";
let selPetId = null;
const openRows = new Set();
let layout = "cards";

function render() {
  if (!lib.pets.some((p) => p.id === selPetId)) selPetId = lib.pets[0]?.id || null;
  renderRail();
  renderPetCard();
  renderLibrary();
}

// ---------------------------------------------------------------- Pets view
function renderRail() {
  $("rail").replaceChildren(
    ...lib.pets.map((pet) => {
      const b = el("button", { type: "button", "aria-current": String(pet.id === selPetId), "aria-label": `${pet.name}, ${pet.role}`, style: { "--ring": tint(pet.color, 0.9) }, onclick: () => ((selPetId = pet.id), openRows.clear(), render()) }, [avatar(pet, 58), el("span", { text: pet.name })]);
      // Drop a skill (from All skills) onto a pet in the rail to teach it.
      b.addEventListener("dragover", (e) => [...e.dataTransfer.types].includes("application/x-skill-id") && (e.preventDefault(), b.classList.add("drop-over")));
      b.addEventListener("dragleave", () => b.classList.remove("drop-over"));
      b.addEventListener("drop", (e) => {
        e.preventDefault();
        b.classList.remove("drop-over");
        teach(pet, [e.dataTransfer.getData("application/x-skill-id")]);
      });
      return b;
    }),
    el("button", { type: "button", class: "adopt", onclick: adoptPet, "aria-label": "Adopt a new pet" }, [el("span", { class: "av", text: "+" }), el("span", { text: "Adopt" })]),
  );
}

function teach(pet, ids) {
  const add = ids.filter((id) => id && lib.skills.some((s) => s.id === id) && !pet.skillIds.includes(id));
  if (!add.length) return toast(`${pet.name} already knows that`);
  pet.skillIds.push(...add);
  save(add.length === 1 ? `${pet.name} learned ${lib.skills.find((s) => s.id === add[0]).name}` : `${pet.name} learned ${add.length} skills`);
}

function renderPetCard() {
  const pet = lib.pets.find((p) => p.id === selPetId);
  const card = $("petCard");
  if (!pet) return card.replaceChildren(el("p", { class: "empty-skills", text: "No pets yet. Adopt one." }));
  const skills = pet.skillIds.map((id) => lib.skills.find((s) => s.id === id)).filter(Boolean);
  const reads = [pet.canRead.text && "text", pet.canRead.images && "images & frames"].filter(Boolean).join(" and ") || "nothing";

  const nameIn = el("input", { class: "nm", value: pet.name, "aria-label": "Pet name", maxlength: "24" });
  nameIn.addEventListener("change", () => ((pet.name = nameIn.value.trim() || pet.name), save()));
  const roleIn = el("input", { class: "rl", value: pet.role || "", "aria-label": `${pet.name}'s role`, maxlength: "24", placeholder: "Role" });
  roleIn.addEventListener("change", () => ((pet.role = roleIn.value.trim()), save()));

  const list = skills.length
    ? el("div", { class: "acc" }, skills.map((s) => skillAccordion(pet, s)))
    : el("div", { class: "empty-skills" }, [`${pet.name} doesn't know any skills yet. `, el("button", { class: "link", type: "button", text: "Add skills", onclick: () => openSheet(pet) })]);

  const appSel = el("select", { "aria-label": `${pet.name} comes first in` }, [el("option", { value: "", text: "Anywhere" }), ...Object.entries(APPS).map(([k, v]) => el("option", { value: k, text: v, selected: pet.apps?.[0] === k }))]);
  appSel.addEventListener("change", () => ((pet.apps = appSel.value ? [appSel.value] : []), save()));

  card.style.setProperty("--tint", tint(pet.color, 0.28));
  card.replaceChildren(
    el("div", { class: "hero" }, [
      el("div", { class: "hero-pet", html: petSvg(pet, 112) }),
      el("div", { class: "names" }, [
        nameIn,
        roleIn,
        el("p", { text: `Carries ${skills.length} skill${skills.length === 1 ? "" : "s"} and reads ${reads}. Drag ${pet.name} onto your work and it offers the skills that fit.` }),
      ]),
    ]),
    el("div", { class: "sect" }, [
      el("div", { class: "sect-h" }, [el("h2", { text: `${pet.name}'s skills` }), el("button", { class: "btn primary small", type: "button", text: "+ Add skills", onclick: () => openSheet(pet) })]),
      list,
    ]),
    el("div", { class: "sect" }, [
      el("div", { class: "sect-h" }, [el("h2", { text: "Settings" })]),
      el("div", { class: "settings" }, [
        el("span", { class: "k", text: "Looks" }),
        el("div", { class: "looks", role: "group", "aria-label": `${pet.name}'s character and color` }, [
          ...SPECIES_IDS.map((sp) =>
            el("button", {
              class: "sp",
              type: "button",
              title: SPECIES[sp].label,
              "aria-label": SPECIES[sp].label,
              "aria-pressed": String(pet.species === sp),
              html: petSvg({ species: sp, color: pet.species === sp ? pet.color : SPECIES[sp].color }, 28),
              onclick: () => pet.species !== sp && ((pet.species = sp), (pet.color = SPECIES[sp].color), save(`${pet.name} is now a ${SPECIES[sp].label.toLowerCase()}`)),
            }),
          ),
          el("span", { class: "gap" }),
          ...PET_COLORS.map((c) => el("button", { class: "dot", type: "button", style: { background: c }, "aria-label": `Color ${c}`, "aria-pressed": String(pet.color === c), onclick: () => ((pet.color = c), save()) })),
        ]),
        el("span"),
        el("span", { class: "k", text: "Can read" }),
        el("div", {}, [
          toggle(`${pet.id}-text`, "Text", pet.canRead.text, (v) => ((pet.canRead.text = v), save())),
          toggle(`${pet.id}-img`, "Images & frames", pet.canRead.images, (v) => ((pet.canRead.images = v), save())),
        ]),
        el("span"),
        el("span", { class: "k", text: "First in" }),
        el("div", {}, [appSel]),
        lib.pets.length > 1 ? el("button", { class: "link danger", type: "button", text: `Release ${pet.name}`, onclick: () => confirm(`Release ${pet.name}? Its skills stay in the library.`) && ((lib.pets = lib.pets.filter((p) => p !== pet)), save(`${pet.name} released`)) }) : el("span"),
      ]),
    ]),
  );
}
function toggle(id, label, value, onchange) {
  const c = el("input", { type: "checkbox", id, checked: value, role: "switch" });
  c.addEventListener("change", () => onchange(c.checked));
  return el("label", { class: "switch", for: id }, [label, c]);
}

function skillAccordion(pet, s) {
  const open = openRows.has(s.id);
  const others = lib.pets.filter((p) => p !== pet && p.skillIds.includes(s.id)).map((p) => p.name);
  const bodyId = `acc-${s.id}`;
  return el("div", { class: "acc-item" + (open ? " open" : "") }, [
    el("button", { class: "acc-row", type: "button", "aria-expanded": String(open), "aria-controls": bodyId, onclick: () => (open ? openRows.delete(s.id) : openRows.add(s.id), renderPetCard()) }, [
      sticker(s.sticker, 40),
      el("span", { class: "nm", text: s.name }),
      tagsFor(s),
      resultFor(s),
      el("span", { class: "chev", html: CHEVRON }),
    ]),
    open
      ? el("div", { class: "acc-body", id: bodyId }, [
          el("p", { class: "prompt", text: s.prompt }),
          el("dl", { class: "facts" }, [
            el("dt", { text: "Works on" }), el("dd", { text: s.accepts.map((k) => SHORT_KIND[k]).join(", ") }),
            el("dt", { text: "Result" }), el("dd", { text: RESULT_LONG[s.action] }),
            el("dt", { text: "Also known by" }), el("dd", { text: others.length ? others.join(", ") : "No other pets" }),
          ]),
          el("div", { class: "acc-actions" }, [
            el("button", { class: "btn small ghost", type: "button", text: "Edit skill", onclick: () => openEditor(s.id) }),
            el("button", { class: "link danger", type: "button", text: `Remove from ${pet.name}`, onclick: () => ((pet.skillIds = pet.skillIds.filter((x) => x !== s.id)), openRows.delete(s.id), save(`Removed ${s.name} from ${pet.name}`)) }),
          ]),
        ])
      : null,
  ]);
}

// ---------------------------------------------------------------- Add skills sheet
let sheetPet = null;
let sheetFilter = "all";
const sheetSel = new Set();
function openSheet(pet) {
  sheetPet = pet;
  sheetFilter = "all";
  sheetSel.clear();
  $("sq").value = "";
  $("sheetTitle").textContent = `Add skills to ${pet.name}`;
  $("sheetScrim").hidden = false;
  $("addSheet").hidden = false;
  renderSheet();
  $("sq").focus();
}
function closeSheet() {
  $("sheetScrim").hidden = true;
  $("addSheet").hidden = true;
  sheetPet = null;
}
function renderSheet() {
  if (!sheetPet) return;
  chips($("sFilters"), sheetFilter, (k) => ((sheetFilter = k), renderSheet()));
  const q = $("sq").value.trim();
  const items = lib.skills.filter((s) => !sheetPet.skillIds.includes(s.id) && byFilter(s, sheetFilter) && matches(s, q));
  $("sheetList").replaceChildren(
    ...(items.length
      ? items.map((s) => {
          const id = `pick-${s.id}`;
          const box = el("input", { type: "checkbox", id, checked: sheetSel.has(s.id), "aria-label": `Add ${s.name}` });
          const row = el("label", { class: "srow" + (sheetSel.has(s.id) ? " on" : ""), for: id }, [
            sticker(s.sticker, 40),
            el("span", { class: "txt" }, [el("div", { class: "nm", text: s.name }), el("div", { class: "desc", text: s.prompt })]),
            el("span", { class: "meta" }, [tagsFor(s), resultFor(s)]),
            box,
          ]);
          box.addEventListener("change", () => {
            box.checked ? sheetSel.add(s.id) : sheetSel.delete(s.id);
            row.classList.toggle("on", box.checked);
            sheetFooter();
          });
          return row;
        })
      : [el("p", { class: "sheet-empty", text: sheetPet.skillIds.length === lib.skills.length ? `${sheetPet.name} already knows every skill.` : "Nothing matches." })]),
  );
  sheetFooter();
}
function sheetFooter() {
  const n = sheetSel.size;
  $("sheetCount").textContent = `${n} selected`;
  $("sheetAdd").disabled = !n;
  $("sheetAdd").textContent = n ? `Add ${n} to ${sheetPet.name}` : `Add to ${sheetPet.name}`;
}
$("sq").addEventListener("input", renderSheet);
$("sheetClose").addEventListener("click", closeSheet);
$("sheetCancel").addEventListener("click", closeSheet);
$("sheetScrim").addEventListener("click", closeSheet);
$("sheetAdd").addEventListener("click", () => {
  const pet = sheetPet;
  const ids = [...sheetSel];
  closeSheet();
  teach(pet, ids);
});
document.addEventListener("keydown", (e) => e.key === "Escape" && !$("addSheet").hidden && closeSheet());

// ---------------------------------------------------------------- All skills view
function renderLibrary() {
  chips($("filters"), filter, (k) => ((filter = k), renderLibrary()));
  $("layCards").setAttribute("aria-pressed", String(layout === "cards"));
  $("layStickers").setAttribute("aria-pressed", String(layout === "stickers"));
  const q = $("q").value.trim();
  const shown = lib.skills.filter((s) => byFilter(s, filter) && matches(s, q));
  const mine = shown.filter((s) => !s.template);
  const tmpl = shown.filter((s) => s.template);
  $("libCount").textContent = `${lib.skills.length} skills`;
  const make = el("button", { class: "make", type: "button", onclick: () => openEditor(null) }, [el("span", { class: "plus", text: "+" }), "Make a skill"]);
  const block = (items) => (layout === "cards" ? el("div", { class: "grid" }, items.map(skillCard)) : el("div", { class: "stickers" }, items.map(stickerCard)));
  const yours = layout === "cards" ? el("div", { class: "grid" }, [make, ...mine.map(skillCard)]) : el("div", { class: "stickers" }, [...mine.map(stickerCard), el("button", { class: "stcard make", type: "button", onclick: () => openEditor(null) }, [el("span", { class: "plus", text: "+" }), "Make a skill"])]);
  $("lib").replaceChildren(el("div", { class: "group-h", text: "Yours" }), yours, el("div", { class: "group-h", text: "Templates" }), tmpl.length ? block(tmpl) : el("p", { class: "muted", text: "No templates match." }));
}
function dragSkill(node, s) {
  node.draggable = true;
  node.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/x-skill-id", s.id);
    e.dataTransfer.setData("text/plain", s.name);
    e.dataTransfer.effectAllowed = "copy";
  });
}
function skillCard(s) {
  const card = el("div", { class: "scard", role: "button", tabindex: "0", "aria-label": `${s.name}. Open to edit.`, onclick: () => openEditor(s.id), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && e.target === card && (e.preventDefault(), openEditor(s.id)) }, [
    el("div", { class: "h" }, [sticker(s.sticker, 42), el("span", { text: s.name })]),
    el("p", { class: "desc", text: s.prompt }),
    el("hr"),
    el("dl", { class: "facts" }, [
      el("dt", { class: "muted", text: "Works on" }), el("dd", {}, [tagsFor(s)]),
      el("dt", { class: "muted", text: "Result" }), el("dd", { text: RESULT[s.action][0] }),
      el("dt", { class: "muted", text: "Known by" }),
      el("dd", { class: "knownby" }, lib.pets.map((p) => {
        const has = p.skillIds.includes(s.id);
        return el("button", {
          type: "button",
          title: `${has ? "Take from" : "Give to"} ${p.name}`,
          "aria-label": `${p.name} knows ${s.name}`,
          "aria-pressed": String(has),
          style: { "--pet-bg": tint(p.color, 0.35), "--pet-ring": p.color },
          html: petSvg(p, 22),
          onclick: (e) => {
            e.stopPropagation();
            p.skillIds = has ? p.skillIds.filter((x) => x !== s.id) : [...p.skillIds, s.id];
            save(has ? `${p.name} forgot ${s.name}` : `${p.name} learned ${s.name}`);
          },
        });
      })),
    ]),
  ]);
  dragSkill(card, s);
  return card;
}
function stickerCard(s) {
  const b = el("button", { class: "stcard", type: "button", title: s.prompt, onclick: () => openEditor(s.id) }, [sticker(s.sticker, 76), el("span", { text: s.name })]);
  dragSkill(b, s);
  return b;
}
$("layCards").addEventListener("click", () => ((layout = "cards"), renderLibrary()));
$("layStickers").addEventListener("click", () => ((layout = "stickers"), renderLibrary()));

function check(id, label, value, onchange) {
  const c = el("input", { type: "checkbox", id, checked: value });
  c.addEventListener("change", () => onchange(c.checked));
  return el("label", { for: id }, [c, label]);
}
function nextSpecies() {
  const used = new Set(lib.pets.map((p) => p.species));
  return SPECIES_IDS.find((sp) => !used.has(sp)) || SPECIES_IDS[lib.pets.length % SPECIES_IDS.length];
}
function adoptPet() {
  const species = nextSpecies();
  const pet = { id: uid("pet"), name: SPECIES[species].label, role: "Helper", species, color: SPECIES[species].color, skillIds: [], canRead: { text: true, images: true }, apps: [] };
  lib.pets.push(pet);
  selPetId = pet.id;
  showTab("pets");
  save("Adopted! Name it and add some skills.");
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
      st ? sticker(st, 34) : el("span", { html: petSvg({ species: e.petSpecies, color: e.petColor }, 34) }),
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
      result ? el("button", { class: "btn small", type: "button", text: "Copy", onclick: async (ev) => { await copyRich(result); ev.target.textContent = "Copied"; } }) : null,
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
  view = ["pets", "skills", "history"].includes(which) ? which : "pets";
  for (const [v, tab, pane] of [["pets", "tabPets", "viewPets"], ["skills", "tabSkills", "viewSkills"], ["history", "tabHistory", "viewHistory"]]) {
    $(tab).setAttribute("aria-selected", String(view === v));
    $(pane).hidden = view !== v;
  }
  const hash = view === "pets" ? "" : `#${view}`;
  if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname);
  renderHistory();
}
$("tabPets").addEventListener("click", () => showTab("pets"));
$("tabSkills").addEventListener("click", () => showTab("skills"));
$("tabHistory").addEventListener("click", () => showTab("history"));
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

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
$("logo").innerHTML = petSvg({ species: "cat" }, 30, true);
load();
loadHistory().then(() => showTab(location.hash.slice(1)));
