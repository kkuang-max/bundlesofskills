import test from "node:test";
import assert from "node:assert/strict";
import { crop, findTemplate, packTemplate, resize, scaleRange, unpackTemplate } from "../src/track.js";

// A "canvas" with distinct shapes: a few rectangles and a gradient, like a design file.
function scene(w, h, ox = 0, oy = 0, zoom = 1) {
  const data = new Uint8Array(w * h).fill(235);
  const rect = (x, y, rw, rh, v) => {
    for (let j = Math.round(oy + y * zoom); j < Math.round(oy + (y + rh) * zoom); j++)
      for (let i = Math.round(ox + x * zoom); i < Math.round(ox + (x + rw) * zoom); i++) if (i >= 0 && j >= 0 && i < w && j < h) data[j * w + i] = v;
  };
  rect(20, 20, 60, 40, 40); rect(90, 30, 30, 70, 120); rect(40, 80, 50, 20, 180); rect(130, 15, 25, 25, 80); rect(150, 70, 40, 30, 10);
  return { w, h, data };
}

test("finds a selection after the canvas pans", () => {
  const before = scene(240, 160);
  const tpl = crop(before, 15, 15, 110, 90);
  const after = scene(240, 160, 23, 17); // panned right 23, down 17
  const hit = findTemplate(after, tpl, { scales: [1] });
  assert.ok(hit.score > 0.95, `score ${hit.score}`);
  assert.equal(hit.x, 15 + 23);
  assert.equal(hit.y, 15 + 17);
});

test("finds it after a zoom, at the new scale", () => {
  const before = scene(400, 300);
  const tpl = resize(crop(before, 15, 15, 110, 90), 55, 45); // stored as a small thumbnail (half size)
  const after = scene(400, 300, 10, 5, 1.5); // zoomed 150%
  const hit = findTemplate(after, tpl, { scales: scaleRange(2, 0.5, 2, 13) });
  assert.ok(hit.score > 0.85, `score ${hit.score}`);
  assert.ok(Math.abs(hit.s - 3) < 0.35, `scale ${hit.s}`); // 2 (thumbnail) × 1.5 (zoom)
  assert.ok(Math.abs(hit.x - (10 + 15 * 1.5)) <= 3 && Math.abs(hit.y - (5 + 15 * 1.5)) <= 3, `pos ${hit.x},${hit.y}`);
});

test("reports a poor match when the thing is gone", () => {
  const tpl = crop(scene(240, 160), 15, 15, 110, 90);
  const blank = { w: 240, h: 160, data: new Uint8Array(240 * 160).map((_, i) => (i * 7919) % 255) };
  const hit = findTemplate(blank, tpl, { scales: [1] });
  assert.ok(!hit || hit.score < 0.5);
});

test("search windows limit where it looks", () => {
  const img = scene(240, 160);
  const tpl = crop(img, 15, 15, 110, 90);
  const hit = findTemplate(img, tpl, { scales: [1], window: { x0: 100, y0: 0, x1: 130, y1: 70 } });
  assert.ok(hit.x >= 100);
});

test("templates survive storage", () => {
  const t = crop(scene(240, 160), 15, 15, 50, 40);
  assert.deepEqual(unpackTemplate(packTemplate(t)), t);
});
