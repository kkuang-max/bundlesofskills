// End-to-end: loads the unpacked extension in Chromium, fakes the Claude API
// with a canned SSE stream, and walks peek -> no-key error -> command bar ->
// streamed result -> Replace selection. Run: npm run build && npm run e2e
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs');
const path = require('path'); const EXT = path.resolve(__dirname, '../extension');
const SS = path.resolve(__dirname, 'screenshots') + '/'; fs.mkdirSync(SS, { recursive: true });
(async () => {
  const srv = http.createServer((q, r) => { r.setHeader('content-type','text/html'); r.end(fs.readFileSync(__dirname + '/fixture.html')); }).listen(8765);
  const ctx = await chromium.launchPersistentContext('', { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], viewport: { width: 1000, height: 640 } });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  // Fake Claude API: SSE stream
  let seenBody = null;
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    seenBody = JSON.parse(route.request().postData()); const headers = route.request().headers();
    seenBody.__hdr = { beta: headers['anthropic-beta'], browser: headers['anthropic-dangerous-direct-browser-access'] };
    const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
    const text = 'This sentence has some mistakes in it and needs fixing.';
    const body = ev('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: seenBody.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } })
      + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 20) } })
      + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(20) } })
      + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
      + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } })
      + ev('message_stop', { type: 'message_stop' });
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
  });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8765/');
  await page.waitForTimeout(500);

  // 1) No key yet → peek on paragraph, click first suggestion → error message
  await page.locator('#p').selectText(); await page.mouse.move(200,60); await page.mouse.down(); await page.mouse.up();
  await page.locator('#p').evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); });
  await page.dispatchEvent('#p', 'mouseup');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SS + '1-peek.png' });
  console.log('peek root present:', await page.locator('skill-pet-root').count());

  // click first peek suggestion with no key → error shown
  await page.mouse.click(130, 127); await page.waitForTimeout(400);
  console.log('no-key text:', await page.evaluate(() => document.querySelector('skill-pet-root') && 'ok'));
  await page.screenshot({ path: SS + '1b-nokey.png' });
  await page.keyboard.press('Escape');
  // set key via storage from the SW
  await sw.evaluate(() => chrome.storage.local.set({ apiKey: 'sk-ant-test' }));

  // 2) Select inside textarea, summon command bar via the SW (same as the hotkey)
  await page.evaluate(() => { const t = document.getElementById('t'); t.focus(); t.setSelectionRange(0, t.value.length); });
  await sw.evaluate(async () => { for (const t of await chrome.tabs.query({})) { try { await chrome.tabs.sendMessage(t.id, { type: 'summon' }); } catch {} } });
  await page.waitForTimeout(300);
  await page.screenshot({ path: SS + '2-bar.png' });
  await page.keyboard.type('fix');
  await page.waitForTimeout(150);
  await page.screenshot({ path: SS + '3-bar-search.png' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.screenshot({ path: SS + '4-result.png' });
  await page.mouse.click(380, 218); await page.waitForTimeout(200);
  console.log('textarea after replace:', await page.inputValue('#t'));
  console.log('request:', JSON.stringify({ model: seenBody?.model, effort: seenBody?.output_config, fallbacks: seenBody?.fallbacks, hdr: seenBody?.__hdr, user: seenBody?.messages?.[0]?.content?.slice(0, 160) }));
  srv.close(); await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
