import test from "node:test";
import assert from "node:assert/strict";
import { streamChat, DEFAULTS } from "../src/anthropic.js";

// A fake fetch that answers like the Messages API: SSE events split into awkward chunks.
function sse(events, status = 200) {
  const enc = new TextEncoder();
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return async (url, init) => {
    sse.last = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
    const body = new ReadableStream({
      start(c) {
        for (let i = 0; i < text.length; i += 37) c.enqueue(enc.encode(text.slice(i, i + 37)));
        c.close();
      },
    });
    return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
  };
}
export function reply(text, { stop = "end_turn", model = "claude-opus-5-5" } = {}) {
  return [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...(text ? [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(0, 3) } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(3) } }] : []),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ];
}
const base = { apiKey: "sk-ant-test", model: "claude-opus-5-5", effort: "low", system: "S", user: "U" };

test("streams text deltas and returns the stop reason and usage", async () => {
  const deltas = [];
  const r = await streamChat({ ...base, onText: (d) => deltas.push(d), fetchImpl: sse(reply("Hello")) });
  assert.equal(r.text, "Hello");
  assert.deepEqual(deltas, ["Hel", "lo"]);
  assert.equal(r.finishReason, "end_turn");
  assert.equal(r.usage.output_tokens, 7);
});

test("sends a Messages API request with the key, effort and refusal fallback", async () => {
  await streamChat({ ...base, fetchImpl: sse(reply("ok")) });
  assert.match(sse.last.url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.equal(sse.last.headers.get("authorization"), "Bearer sk-ant-test");
  assert.match(sse.last.headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
  const b = sse.last.body;
  assert.equal(b.model, "claude-opus-5-5");
  assert.equal(b.stream, true);
  assert.equal(b.system, "S");
  assert.deepEqual(b.messages, [{ role: "user", content: "U" }]);
  assert.deepEqual(b.output_config, { effort: "low" });
  assert.equal(b.fallbacks, "default");
  assert.equal(b.thinking, undefined, "Opus 5.5 always thinks adaptively; effort is the control");
});

test("Haiku gets no fallback parameter", async () => {
  await streamChat({ ...base, model: "claude-haiku-5-5", fetchImpl: sse(reply("ok")) });
  assert.equal(sse.last.body.fallbacks, undefined);
  assert.equal(sse.last.headers.get("anthropic-beta"), null);
  assert.equal(DEFAULTS.model, "claude-opus-5-5");
});

test("maps API errors to friendly messages", async () => {
  const fail = (status, message = "x") => async () => new Response(JSON.stringify({ type: "error", error: { type: "error", message } }), { status, headers: { "content-type": "application/json" } });
  await assert.rejects(streamChat({ ...base, fetchImpl: fail(401) }), { code: "bad-key", message: /key was rejected/ });
  await assert.rejects(streamChat({ ...base, fetchImpl: fail(404) }), { code: "bad-model" });
  await assert.rejects(streamChat({ ...base, fetchImpl: fail(400, "Your credit balance is too low") }), { code: "billing", message: /credit balance/ });
});

test("a refusal becomes an error", async () => {
  await assert.rejects(streamChat({ ...base, fetchImpl: sse(reply("", { stop: "refusal" })) }), { code: "refusal" });
});

test("stopping raises an AbortError", async () => {
  const ac = new AbortController();
  const slow = async (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const p = streamChat({ ...base, signal: ac.signal, fetchImpl: slow });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, { name: "AbortError" });
});
