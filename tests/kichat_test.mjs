// 💬 Claude-Chat: Ende-zu-Ende gegen einen nachgebauten Claude-Server (kein echter Schlüssel, keine Kosten).
// Prüft: Admin-Sperre, Werkzeugschleife im Tab (batch → screenshot → Text), Verlauf an Claude
// (tool_use samt input, tool_result mit Bild, Denkblock mit Signatur unverändert zurück),
// Kostenbuchung, Tageslimit. Start: node tests/kichat_test.mjs
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';

const CAD = 8871, FAKE = 8872;
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const tmp = fs.mkdtempSync('/tmp/kichat-');
const anfragen = [];
const sse = (res, evs) => { res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of evs) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); res.end(); };
const usage = { input_tokens: 1000, output_tokens: 0, cache_creation_input_tokens: 5000, cache_read_input_tokens: 0 };
const zug = (blocks, stop) => [
  { type: 'message_start', message: { id: 'm', role: 'assistant', content: [], usage } },
  ...blocks.flatMap((b, i) => [
    { type: 'content_block_start', index: i, content_block: b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: {} } : b.type === 'thinking' ? { type: 'thinking', thinking: '', signature: '' } : { type: 'text', text: '' } },
    b.type === 'tool_use' ? { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }
      : b.type === 'thinking' ? { type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'SIG123' } }
      : { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } },
    { type: 'content_block_stop', index: i }]),
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 500 } },
  { type: 'message_stop' }];
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const j = JSON.parse(b); anfragen.push({ headers: req.headers, body: j });
    const n = j.messages.length;
    if (n === 1) sse(res, zug([{ type: 'thinking' }, { type: 'text', text: 'Ich baue eine Box.' },
      { type: 'tool_use', id: 't1', name: 'batch', input: { commands: [{ command: 'shape.add', params: { type: 'box', size: [60, 40, 25], name: 'Chat-Box' } }] } }], 'tool_use'));
    else if (n === 3) sse(res, zug([{ type: 'tool_use', id: 't2', name: 'screenshot', input: { view: 'iso', width: 320, height: 200 } }], 'tool_use'));
    else sse(res, zug([{ type: 'text', text: 'Fertig: **Box 60 × 40 × 25 mm**.' }], 'end_turn'));
  });
}).listen(FAKE);

const srv = spawn('python3', ['volme3d_server.py', String(CAD), '--dev'], { cwd: '/home/v3da', stdio: 'ignore',
  env: { ...process.env, ANTHROPIC_API_KEY: 'test-key', V3D_KICHAT_API: `http://127.0.0.1:${FAKE}`, V3D_KICHAT_DIR: tmp } });
const b = await chromium.launch();
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${CAD}/ki-chat/status`); break; } catch (_) { await new Promise(r => setTimeout(r, 250)); } }
  const st = await (await fetch(`http://127.0.0.1:${CAD}/ki-chat/status`)).json();
  ok(st.bereit && st.tageslimit_usd === 5 && st.verbrauch_usd === 0, 'Status: Schlüssel da, Limit 5 $, nichts verbraucht');

  const p = await b.newPage({ viewport: { width: 1300, height: 850 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${CAD}/volme3d.html`);
  await p.waitForFunction(() => window.v3dApi && v3dApi.ready() && window.v3dKiChat);
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.waitForFunction(() => document.getElementById('bm-ki-chat'));
  ok(true, 'Menüeintrag „💬 Claude-Chat“ für Admin (Dev) vorhanden');
  await p.evaluate(() => document.getElementById('bm-ki-chat').click());
  await p.waitForSelector('#ki-chat textarea');
  await p.fill('#ki-chat textarea', 'Bau eine Box 60x40x25');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => !v3dKiChat.state().busy && v3dKiChat.state().n >= 6, null, { timeout: 30000 });
  const box = await p.evaluate(async () => (await v3dApi.execute('scene.inspect', {})).result.bodies.map(o => o.name));
  ok(box.includes('Chat-Box'), 'Claude hat im Tab gebaut: ' + box.join(', '));
  const txt = await p.textContent('#ki-chat .kc-log');
  ok(/Fertig: Box 60 × 40 × 25 mm/.test(txt) && /batch · 1 Befehle ✓/.test(txt) && /screenshot ✓/.test(txt), 'Chat zeigt Antwort und Werkzeugzeilen');
  ok(anfragen.length === 3, '3 Züge an Claude: ' + anfragen.length);
  const a0 = anfragen[0];
  ok(a0.headers['x-api-key'] === 'test-key' && a0.body.model === 'claude-opus-5-5' && a0.body.stream && a0.body.fallbacks === 'default'
     && /server-side-fallback-2026-07-01/.test(a0.headers['anthropic-beta']), 'Anfrage: Schlüssel, Modell, Stream, Fallback');
  ok(a0.body.tools.length === 9 && /Box mit Deckel|Rezept/.test(a0.body.system[0].text), 'Werkzeuge + Anleitung vom Server angehängt');
  const m = anfragen[1].body.messages;
  ok(m[1].content[0].type === 'thinking' && m[1].content[0].signature === 'SIG123', 'Denkblock unverändert zurück');
  ok(m[1].content[2].type === 'tool_use' && m[1].content[2].input.commands[0].params.size[0] === 60, 'tool_use samt input zurück');
  ok(m[2].content[0].type === 'tool_result' && m[2].content[0].tool_use_id === 't1' && !m[2].content[0].is_error, 'tool_result für batch');
  const m2 = anfragen[2].body.messages;
  ok(m2[4].content[0].content[0].type === 'image' && m2[4].content[0].content[0].source.data.length > 1000, 'Bildschirmfoto als Bild an Claude');
  ok(JSON.stringify(m2.slice(0, 3)) === JSON.stringify(m), 'Verlauf wächst nur hinten an');
  // je Zug 1000×4 + 5000×5 + 500×20 = 39 000 µ$ = 0,039 $
  const v = JSON.parse(fs.readFileSync(tmp + '/kichat-verbrauch.json', 'utf8'));
  const usd = Object.values(v)[0]['dev@lokal'];
  ok(Math.abs(usd - 3 * 0.039) < 1e-6, 'Kosten gebucht: ' + usd + ' $');
  ok(/heute 0\.12 \/ 5 \$/.test(await p.textContent('#ki-chat .kc-kosten')), 'Kopfzeile zeigt Tageskosten');
  // Undo nimmt Claudes Bau zurück
  await p.evaluate(() => v3dApi.execute('edit.undo'));
  ok((await p.evaluate(() => objects.length)) === 0, 'Rückgängig entfernt die Box');
  // Tageslimit
  fs.writeFileSync(tmp + '/kichat.json', JSON.stringify({ tageslimit_usd: 0.1 }));
  const r = await fetch(`http://127.0.0.1:${CAD}/ki-chat/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }) });
  ok(r.status === 429 && anfragen.length === 3, 'Tageslimit erreicht → 429, nichts an Claude');
  const kaputt = await fetch(`http://127.0.0.1:${CAD}/ki-chat/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'assistant', content: 'x' }] }) });
  ok(kaputt.status === 400, 'Ungültiger Verlauf → 400');
  ok(!errs.length, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.error(e); fail++; }
await b.close(); srv.kill(); fake.close();
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
setTimeout(() => process.exit(fail ? 1 : 0), 300);
