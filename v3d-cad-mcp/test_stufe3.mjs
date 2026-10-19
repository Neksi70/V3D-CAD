// Stufe 3: Generatoren mit eigenem Fenster (starter.*) und Claude live im Tab.
// Teil B braucht den laufenden Hub (v3d-cad-agent-hub, 127.0.0.1:8830).
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';

let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const srv = spawn('node', [new URL('./server.mjs', import.meta.url).pathname, '--no-monitor'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: srv.stdout });
const waiting = new Map(); let nid = 1;
rl.on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
const rpc = (method, params) => new Promise(res => { const id = nid++; waiting.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const tool = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); const t = r.result.content.find(c => c.type === 'text').text; return t.startsWith('Fehler') ? { ok: false, error: t } : JSON.parse(t); };
const ex = (command, params) => tool('execute', { command, params });
const mass = r => { const c = r.result.created; const mn = [0, 1, 2].map(k => Math.min(...c.map(o => o.bbox.min[k]))), mx = [0, 1, 2].map(k => Math.max(...c.map(o => o.bbox.max[k]))); return mx.map((v, k) => +(v - mn[k]).toFixed(2)); };

const dev = spawn('python3', ['volme3d_server.py', '8980', '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
const b = await chromium.launch();
try {
  await rpc('initialize', { protocolVersion: '2025-06-18' });
  await ex('scene.new', {});
  // ── Teil A: Generatoren mit eigenem Fenster ──
  const l = await ex('starter.list', {});
  ok(l.ok && l.result.starters.length > 40, `starter.list: ${l.result.starters.length} Generatoren`);
  const ins = await ex('starter.inspect', { name: 'Zahnrad' });
  ok(ins.ok && ins.result.params.some(p => p.key === 'gp-teeth' && p.max === 80), 'starter.inspect Zahnrad: ' + ins.result.params.map(p => p.key).join(', '));
  let r = await ex('starter.run', { name: 'Zahnrad', params: { 'gp-module': 2, 'gp-teeth': 30, 'gp-width': 8, 'gp-bore': 6 } });
  let m = r.ok ? mass(r) : [];
  ok(r.ok && Math.abs(m[0] - 64) < 1 && Math.abs(m[2] - 8) < 0.01, `Zahnrad m=2, z=30: Kopfkreis ${m[0]} ≈ 64 mm (d = (z+2)·m), Breite ${m[2]}` + (r.ok ? '' : ' ' + r.error));
  r = await ex('starter.run', { name: 'Gehäuse / Box', params: { 'ep-w': 80, 'ep-d': 50, 'ep-h': 30, 'ep-wall': 2, 'ebg-boss': 'Ohne' }, center: [0, 80] });
  m = r.ok ? mass(r) : [];
  ok(r.ok && String(m) === '80,50,30' && Math.abs(r.result.created[0].center[1] - 80) < 0.01, `Gehäuse 80×50×30 bei y=80: ${m}` + (r.ok ? '' : ' ' + r.error));
  r = await ex('starter.run', { name: 'Schraube / Mutter', params: { 'sbg-type': 'Mutter', 'sbg-size': 'M8' }, center: [80, 0] });
  m = r.ok ? mass(r) : [];
  ok(r.ok && m[0] > 12 && m[0] < 16, `Mutter M8: Schlüsselweite/Eckmaß ${m[0]} mm (SW 13)` + (r.ok ? '' : ' ' + r.error));
  r = await ex('starter.run', { name: 'Vase', params: { 'vbg-cross': 'Welle', 'vp-h': 120, 'vp-w': 70 }, center: [-90, 0] });
  m = r.ok ? mass(r) : [];
  ok(r.ok && Math.abs(m[2] - 120) < 1, `Vase Welle, 120 hoch: ${m}` + (r.ok ? '' : ' ' + r.error));
  const vorher = (await ex('scene.inspect', {})).result.bodies.length;
  r = await ex('starter.run', { name: 'Zahnrad', params: { 'gp-teeth': 500 } });
  ok(!r.ok && /zwischen 6 und 80/.test(r.error), 'Bereichsprüfung: ' + r.error);
  r = await ex('starter.run', { name: 'Zahnrad', params: { zaehnchen: 3 } });
  ok(!r.ok && /keinen Regler/.test(r.error), 'unbekannter Regler: ' + (r.error || '').slice(0, 70));
  r = await ex('starter.run', { name: 'Gibtsnicht' });
  ok(!r.ok && /nicht eindeutig/.test(r.error), 'unbekannter Generator → Meldung');
  ok((await ex('scene.inspect', {})).result.bodies.length === vorher, 'Fehlversuche ändern die Szene nicht');
  await tool('screenshot', { view: 'iso', width: 640, height: 400, path: 'stufe3-generatoren.png' });

  // ── Teil B: Claude live im Tab ──
  await new Promise(r => setTimeout(r, 1000));
  const p = await b.newPage({ viewport: { width: 1300, height: 800 } });
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8980/volme3d.html');
  await p.waitForFunction(() => window.v3dLive && window.v3dApi && v3dApi.ready());
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); addShape('box'); });   // eigener Stand des Nutzers
  ok(await p.evaluate(() => !!document.getElementById('bm-claude-live')), 'Menüeintrag „🤖 Claude live“ vorhanden');
  await p.evaluate(() => document.getElementById('bm-claude-live').click());
  await p.waitForFunction(() => v3dLive.state().code, null, { timeout: 10000 });
  const code = await p.evaluate(() => v3dLive.state().code);
  ok(/^\d{6}$/.test(code), 'Tab zeigt Code ' + code);
  r = await tool('live_connect', { code: '000000' === code ? '111111' : '000000' });
  ok(!r.ok && /Kein Tab/.test(r.error), 'falscher Code → abgelehnt');
  r = await tool('live_connect', { code });
  ok(r.verbunden && r.koerper_im_tab === 1, `live_connect: verbunden, sieht ${r.koerper_im_tab} Körper im Tab`);
  await p.waitForFunction(() => v3dLive.state().status === 'verbunden', null, { timeout: 5000 });
  ok(true, 'Tab zeigt „verbunden“');
  r = await ex('shape.add', { type: 'cylinder', size: [20, 20, 30], center: [40, 0, 15], name: 'Von Claude' });
  const imTab = await p.evaluate(() => objects.map(o => o.userData.name));
  ok(r.ok && imTab.includes('Von Claude') && imTab.length === 2, 'Befehl läuft im Tab: ' + imTab.join(', '));
  r = await ex('starter.run', { name: 'Zahnrad', params: { 'gp-teeth': 12 }, center: [-40, 0] });
  ok(r.ok && (await p.evaluate(() => objects.length)) > 2, 'Generator läuft im Tab');
  await p.screenshot({ path: '/home/v3da/v3d-cad-mcp/ausgabe/stufe3-live-tab.png' });
  const st = await tool('live_status', {});
  ok(st.live && st.verbunden, 'live_status: verbunden');
  await p.evaluate(() => v3dLive.stop());
  await new Promise(r => setTimeout(r, 500));
  r = await ex('scene.inspect', {});
  ok(!r.ok && /Live-Tab/.test(r.error || ''), 'Tab beendet → klare Meldung: ' + (r.error || '').slice(0, 80));
  r = await tool('live_disconnect', {});
  r = await ex('scene.inspect', {});
  ok(r.ok && r.result.bodies.length === 4, 'nach live_disconnect wieder der unsichtbare Browser (' + r.result?.bodies?.length + ' Körper)');
} catch (e) { console.error(e); fail++; }
srv.stdin.end(); await b.close(); dev.kill();
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
setTimeout(() => process.exit(fail ? 1 : 0), 800);
