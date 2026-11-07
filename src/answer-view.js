// Shared answer view (pages + Studio). Plain DOM, no framework.
import { splitReveal } from "./library.js";
import { renderMarkdown } from "./markdown.js";

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) if (c != null && c !== false) n.append(c);
  return n;
}

/**
 * Render an answer. If the skill printed "=== ANSWERS ===", everything after it
 * stays hidden: each answer is a blurred card you click to reveal (quizzes,
 * flashcards). While streaming, answers aren't shown at all.
 */
export function renderAnswer(box, text, done) {
  const { shown, answers, hasReveal } = splitReveal(text);
  box.classList.toggle("streaming", !done && !hasReveal);
  box.classList.add("md");
  if (!hasReveal) {
    box.replaceChildren(renderMarkdown(text));
    return;
  }
  const n = answers.length;
  const list = el("div", { class: "spoilers" }, answers.map((a, i) => {
    const txt = el("span", { class: "sp-txt md" });
    txt.append(renderMarkdown(a));
    const b = el("button", { class: "spoiler", "aria-expanded": "false", "aria-label": `Reveal answer ${i + 1}` }, [txt]);
    b.addEventListener("click", () => {
      b.classList.add("shown");
      b.setAttribute("aria-expanded", "true");
      b.removeAttribute("aria-label");
    });
    return b;
  }));
  const all = el("button", { class: "link", text: "Reveal all", onclick: () => list.querySelectorAll(".spoiler").forEach((b) => b.click()) });
  const shownBox = el("div");
  shownBox.append(renderMarkdown(shown));
  box.replaceChildren(
    shownBox,
    el("div", { class: "reveal" }, [
      el("div", { class: "rv-head" }, [
        el("span", { text: done ? `${n} answer${n === 1 ? "" : "s"} hidden. Click one to reveal it.` : "Answers are hidden until you're ready…" }),
        done && n ? all : null,
      ]),
      done ? list : null,
    ]),
  );
}

