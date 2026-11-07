// The squad's characters, drawn as SVG strings (no DOM, so it works in the
// content script, the Studio and tests). Seven species, each with an "open"
// face and a "happy" face (closed ^^ eyes). Both faces are in the markup;
// CSS (or the `happy` flag) decides which one shows.

export const SPECIES = {
  cat: { label: "Cat", color: "#F8BE8E" },
  dog: { label: "Dog", color: "#A8DCC1" },
  bird: { label: "Bird", color: "#CBBEF5" },
  frog: { label: "Frog", color: "#F3DE85" },
  bunny: { label: "Bunny", color: "#F6B3C6" },
  bear: { label: "Bear", color: "#ABC4F0" },
  ghost: { label: "Ghost", color: "#F8C3A0" },
};
export const SPECIES_IDS = Object.keys(SPECIES);

const INK = "#2E2A33";
const SW = 2.6;

function mix(hex, to, t) {
  const n = parseInt(hex.slice(1).padEnd(6, "0").slice(0, 6), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  const m = (c) => Math.round(c + (to - c) * t);
  return `#${((1 << 24) | (m(r) << 16) | (m(g) << 8) | m(b)).toString(16).slice(1)}`;
}
const darker = (c) => mix(c, 0, 0.14);
const lighter = (c) => mix(c, 255, 0.45);

const line = `stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"`;
const eyeOpen = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="2.4" ry="3" fill="${INK}"/><circle cx="${x + 0.8}" cy="${y - 1.1}" r="0.85" fill="#fff"/>`;
const eyeHappy = (x, y) => `<path d="M${x - 3} ${y + 1}q3-3.6 6 0" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`;
const cheeks = (y, l = 20, r = 44) => `<ellipse cx="${l}" cy="${y}" rx="3.6" ry="2.3" fill="#F28C9B" opacity=".5"/><ellipse cx="${r}" cy="${y}" rx="3.6" ry="2.3" fill="#F28C9B" opacity=".5"/>`;
const gloss = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="5.5" ry="3" fill="#fff" opacity=".5" transform="rotate(-28 ${x} ${y})"/>`;
const smile = (x, y, w = 6) => `<path d="M${x - w / 2} ${y}q${w / 2} 2.6 ${w} 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
const grin = (x, y, w = 7) => `<path d="M${x - w / 2} ${y}q${w / 2} 4.2 ${w} 0" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`;

/** Faces: [open, happy] groups. */
function faces(eyes, mouthOpen, mouthHappy) {
  return [eyes.map(([x, y]) => eyeOpen(x, y)).join("") + mouthOpen, eyes.map(([x, y]) => eyeHappy(x, y)).join("") + mouthHappy];
}

const HEAD = (top) => `M10 ${top + 22}C10 ${top + 8} 19 ${top} 32 ${top}C45 ${top} 54 ${top + 8} 54 ${top + 22}C54 ${top + 35} 45 ${top + 42} 32 ${top + 42}C19 ${top + 42} 10 ${top + 35} 10 ${top + 22}Z`;

const DRAW = {
  cat: (c) => {
    const body = `<path d="M15 27L13 9l14 8z" fill="${c}" ${line}/><path d="M49 27l2-18-14 8z" fill="${c}" ${line}/><path d="${HEAD(15)}" fill="${c}" ${line}/>${gloss(21, 26)}${cheeks(43)}`;
    return [body, ...faces([[25, 36], [39, 36]], smile(32, 43), grin(32, 42.5))];
  },
  dog: (c) => {
    const ear = darker(c);
    const body = `<path d="${HEAD(15)}" fill="${c}" ${line}/><path d="M15 21C7 21 4 33 7 41c2 6 9 5 10-1 1-7 2-14-2-19z" fill="${ear}" ${line}/><path d="M49 21c8 0 11 12 8 20-2 6-9 5-10-1-1-7-2-14 2-19z" fill="${ear}" ${line}/>${gloss(23, 24)}${cheeks(44, 21, 43)}<ellipse cx="32" cy="41" rx="2.6" ry="1.9" fill="${INK}"/>`;
    return [body, ...faces([[26, 35], [38, 35]], smile(32, 45, 5), grin(32, 44.5, 6))];
  },
  bird: (c) => {
    const body = `<path d="M31 14c-2-6 2-9 5-7-3 1-3 4-3 7" fill="${c}" ${line}/><path d="M32 13c12 0 20 13 20 27 0 11-9 17-20 17S12 51 12 40c0-14 8-27 20-27z" fill="${c}" ${line}/><path d="M51 41c4 1 6 6 3 9" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>${gloss(22, 27)}${cheeks(42, 19, 45)}<path d="M28.6 40.5h6.8L32 46z" fill="${INK}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>`;
    return [body, ...faces([[25.5, 35], [38.5, 35]], "", "")];
  },
  frog: (c) => {
    const body = `<path d="M8 43c0-10 10-15 24-15s24 5 24 15-10 14-24 14S8 53 8 43z" fill="${c}" ${line}/><circle cx="21.5" cy="26" r="8" fill="${c}" ${line}/><circle cx="42.5" cy="26" r="8" fill="${c}" ${line}/>${gloss(17, 23)}${cheeks(45, 16, 48)}`;
    return [body, ...faces([[21.5, 26], [42.5, 26]], `<path d="M24 44q8 5 16 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`, `<path d="M24 43.5q8 7 16 0" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`)];
  },
  bunny: (c) => {
    const inner = lighter("#F28C9B");
    const body = `<path d="M23 23c-5-8-5-19 0-20 5 0 6 10 4 19z" fill="${c}" ${line}/><path d="M41 23c5-8 5-19 0-20-5 0-6 10-4 19z" fill="${c}" ${line}/><path d="M23.6 19c-2-6-2-11 .4-11.5 2 .5 2.4 5.5 1.6 11.5z" fill="${inner}"/><path d="M40.4 19c2-6 2-11-.4-11.5-2 .5-2.4 5.5-1.6 11.5z" fill="${inner}"/><path d="${HEAD(17)}" fill="${c}" ${line}/>${gloss(21, 28)}${cheeks(45)}`;
    return [body, ...faces([[25, 38], [39, 38]], smile(32, 44.5, 4.5), grin(32, 44, 5.5))];
  },
  bear: (c) => {
    const ear = darker(c);
    const body = `<circle cx="17" cy="21" r="7" fill="${c}" ${line}/><circle cx="47" cy="21" r="7" fill="${c}" ${line}/><circle cx="17" cy="21" r="3.4" fill="${ear}"/><circle cx="47" cy="21" r="3.4" fill="${ear}"/><path d="${HEAD(15)}" fill="${c}" ${line}/>${gloss(21, 26)}${cheeks(43, 18, 46)}<ellipse cx="32" cy="44" rx="7" ry="5" fill="${lighter(c)}"/><ellipse cx="32" cy="42" rx="2.5" ry="1.8" fill="${INK}"/>`;
    return [body, ...faces([[24.5, 35], [39.5, 35]], smile(32, 45.5, 4), grin(32, 45, 5))];
  },
  ghost: (c) => {
    const body = `<path d="M12 34c0-13 9-22 20-22s20 9 20 22v21c-2.5-3-5-3-7 0s-4.5 3-6.5 0-4.5-3-6.5 0-4.5 3-6.5 0-4.5-3-6.5 0-4.5 3-7 0z" fill="${c}" ${line}/>${gloss(21, 23)}${cheeks(39, 19, 45)}`;
    return [body, ...faces([[25, 32], [39, 32]], smile(32, 39, 4.5), grin(32, 38.5, 5.5))];
  },
};

const safe = (c, fallback) => (/^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : fallback);

/**
 * A character as SVG markup.
 * @param {string} species  one of SPECIES_IDS (unknown → cat)
 * @param {string} color    fill colour (hex); defaults to the species colour
 * @param {number} size     width in px
 * @param {boolean} happy   show the happy face instead of the open one
 */
export function petArt(species, color, size = 52, happy = false) {
  const sp = DRAW[species] ? species : "cat";
  const fill = safe(color, SPECIES[sp].color);
  size = Number(size) || 52;
  const [body, open, joy] = DRAW[sp](fill);
  return `<svg class="pet-art" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${body}<g class="e-open"${happy ? ' style="display:none"' : ""}>${open}</g><g class="e-happy"${happy ? "" : ' style="display:none"'}>${joy}</g></svg>`;
}
