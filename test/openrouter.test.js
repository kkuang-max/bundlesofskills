import test from "node:test";
import assert from "node:assert/strict";
import { streamChat, OPENROUTER_URL } from "../src/openrouter.js";

// Fake fetch returning an SSE body split into awkward chunks.
function sse(parts, status = 200) {
  const enc = new TextEncoder();
  return async (url, init) => {
    sse.last = { url, init, body: JSON.parse(init.body) };
    const body = new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p));
        c.close();
      },
    });
    return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
  };
}
const ev = (o) => `data: ${JSON.stringify(o)}\n\n`;
const base = { apiKey: "sk-or-v1-x", model: "anthropic/claude-opus-5.5", effort: "low", system: "S", user: "U" };

test("streams deltas across split chunks and ignores keep-alives", async () => {
  const full =
    ": OPENROUTER PROCESSING\n\n" +
    ev({ choices: [{ delta: { content: "Hel" } }] }) +
    ev({ choices: [{ delta: { content: "lo" }, finish_reason: "stop" }], usage: { total_tokens: 5 } }) +
    "data: [DONE]\n\n";
  const deltas = [];
  const r = await streamChat({ ...base, onText: (d) => deltas.push(d), fetchImpl: sse([full.slice(0, 30), full.slice(30, 61), full.slice(61)]) });
  assert.equal(r.text, "Hello");
  assert.deepEqual(deltas, ["Hel", "lo"]);
  assert.equal(r.finishReason, "stop");
  assert.equal(r.usage.total_tokens, 5);
});

test("sends an OpenAI-style request with bearer auth", async () => {
  await streamChat({ ...base, fetchImpl: sse(["data: [DONE]\n\n"]) });
  assert.equal(sse.last.url, OPENROUTER_URL);
  assert.equal(sse.last.init.headers.Authorization, "Bearer sk-or-v1-x");
  assert.equal(sse.last.body.model, "anthropic/claude-opus-5.5");
  assert.equal(sse.last.body.stream, true);
  assert.deepEqual(sse.last.body.messages.map((m) => m.role), ["system", "user"]);
  assert.equal(sse.last.body.reasoning.effort, "low");
});

test("maps HTTP errors to friendly messages", async () => {
  const fail = (status) => async () => new Response(JSON.stringify({ error: { code: status, message: "x" } }), { status });
  await assert.rejects(streamChat({ ...base, fetchImpl: fail(401) }), { code: "bad-key", message: /key was rejected/ });
  await assert.rejects(streamChat({ ...base, fetchImpl: fail(402) }), /out of credits/);
  await assert.rejects(streamChat({ ...base, fetchImpl: fail(404) }), { code: "bad-model" });
});

test("surfaces errors sent mid-stream", async () => {
  const parts = [ev({ choices: [{ delta: { content: "par" } }] }), ev({ error: { code: 502, message: "provider died" } })];
  await assert.rejects(streamChat({ ...base, fetchImpl: sse(parts) }), /provider is down/);
});
