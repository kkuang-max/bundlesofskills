// Visual tracking for canvas apps (Figma, Miro, …), where panning and zooming
// change pixels but nothing in the DOM. We keep a tiny greyscale thumbnail of
// what was selected and, after the canvas stops moving, find it again in a
// fresh screenshot. Pure functions on {w, h, data: Uint8Array} grey images so
// they run (and are tested) outside the browser.

/** Nearest-neighbour resample of a grey image. */
export function resize(img, w, h) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const out = new Uint8Array(w * h);
  const sx = img.w / w, sy = img.h / h;
  for (let y = 0; y < h; y++) {
    const row = Math.min(img.h - 1, Math.floor((y + 0.5) * sy)) * img.w;
    for (let x = 0; x < w; x++) out[y * w + x] = img.data[row + Math.min(img.w - 1, Math.floor((x + 0.5) * sx))];
  }
  return { w, h, data: out };
}

/** Cut a rectangle out of a grey image. */
export function crop(img, x, y, w, h) {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  w = Math.min(img.w - x, Math.round(w)); h = Math.min(img.h - y, Math.round(h));
  const out = new Uint8Array(Math.max(0, w) * Math.max(0, h));
  for (let r = 0; r < h; r++) out.set(img.data.subarray((y + r) * img.w + x, (y + r) * img.w + x + w), r * w);
  return { w: Math.max(0, w), h: Math.max(0, h), data: out };
}

/** Zero-mean normalised cross-correlation of template t at (x, y) in img. 1 = identical. */
function ncc(img, t, x, y, tMean, tNorm) {
  let sum = 0, sum2 = 0, cross = 0;
  const n = t.w * t.h;
  for (let r = 0; r < t.h; r++) {
    const io = (y + r) * img.w + x, to = r * t.w;
    for (let c = 0; c < t.w; c++) {
      const v = img.data[io + c];
      sum += v; sum2 += v * v; cross += v * t.data[to + c];
    }
  }
  const mean = sum / n;
  const var_ = sum2 - n * mean * mean;
  if (var_ <= 1e-6 || tNorm <= 1e-6) return 0;
  return (cross - n * mean * tMean) / Math.sqrt(var_ * tNorm);
}

function stats(t) {
  let s = 0, s2 = 0;
  for (const v of t.data) { s += v; s2 += v * v; }
  const n = t.data.length, mean = s / n;
  return { mean, norm: s2 - n * mean * mean };
}

/**
 * Find template `tpl` in `img`, trying each scale in `scales` (relative to the
 * template's size) within an optional search window {x0, y0, x1, y1} on the
 * template's top-left corner. Coarse-to-fine: strided pass, then a ±stride
 * refinement around the best hit. Returns {x, y, s, w, h, score} or null.
 */
/** 3×3 box blur: makes matching tolerant to small scale/offset errors. */
export function blur(img) {
  const { w, h, data } = img;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, y - 1); j <= Math.min(h - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(w - 1, x + 1); i++) { s += data[j * w + i]; n++; }
    out[y * w + x] = s / n;
  }
  return { w, h, data: out };
}

export function findTemplate(img, tpl, opts = {}) {
  if (opts.smooth !== false) { img = blur(img); tpl = blur(tpl); }
  const scales = opts.scales || [1];
  const per = search(img, tpl, opts, true); // best hit per scale
  if (!per.length) return null;
  if (scales.length < 2) return per[0];
  // Refine the strongest few candidates with a finer zoom sweep near each spot.
  let best = per[0];
  for (const c of per.slice(0, 3)) {
    const pad = Math.max(c.w, c.h) * 0.15;
    const fine = search(img, tpl, { ...opts, scales: scaleRange(c.s, 0.9, 1.1, 9), window: { x0: c.x - pad, y0: c.y - pad, x1: c.x + pad, y1: c.y + pad } })[0];
    if (fine && fine.score > best.score) best = fine;
  }
  return best;
}

function search(img, tpl, { scales = [1], window = null, minSize = 6 } = {}, all = false) {
  const hits = [];
  let best = null;
  for (const s of scales) {
    const t = resize(tpl, tpl.w * s, tpl.h * s);
    if (t.w < minSize || t.h < minSize || t.w > img.w || t.h > img.h) continue;
    const { mean, norm } = stats(t);
    if (norm <= 1e-6) continue; // flat template: nothing to lock onto
    const x0 = Math.max(0, Math.floor(window?.x0 ?? 0)), y0 = Math.max(0, Math.floor(window?.y0 ?? 0));
    const x1 = Math.min(img.w - t.w, Math.ceil(window?.x1 ?? img.w)), y1 = Math.min(img.h - t.h, Math.ceil(window?.y1 ?? img.h));
    if (x1 < x0 || y1 < y0) continue;
    const step = Math.max(1, Math.floor(Math.min(t.w, t.h) / 14));
    let local = null;
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
      const sc = ncc(img, t, x, y, mean, norm);
      if (!local || sc > local.score) local = { x, y, score: sc };
    }
    if (!local) continue;
    // refine around the coarse hit
    for (let y = Math.max(y0, local.y - step); y <= Math.min(y1, local.y + step); y++) for (let x = Math.max(x0, local.x - step); x <= Math.min(x1, local.x + step); x++) {
      const sc = ncc(img, t, x, y, mean, norm);
      if (sc > local.score) local = { x, y, score: sc };
    }
    hits.push({ ...local, s, w: t.w, h: t.h });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

/** Geometric range of scales around `center`, e.g. zoom levels to try. */
export function scaleRange(center, lo, hi, steps) {
  const out = [];
  for (let i = 0; i < steps; i++) out.push(center * lo * Math.pow(hi / lo, steps === 1 ? 0 : i / (steps - 1)));
  return out;
}

/** Pack/unpack a template for storage (pins survive reloads). */
export function packTemplate(t) {
  let bin = "";
  for (let i = 0; i < t.data.length; i += 0x8000) bin += String.fromCharCode(...t.data.subarray(i, i + 0x8000));
  return { w: t.w, h: t.h, b64: btoa(bin) };
}
export function unpackTemplate(p) {
  const bin = atob(p.b64);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { w: p.w, h: p.h, data };
}
