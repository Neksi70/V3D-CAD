// Bauplan/Parametrik: Teil 1 über MCP (wie ein Agent), Teil 2 direkt im Browser
// (Handänderung im Editor, 𝑥-Panel, Speichern/Laden).
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';

let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;
const PI = Math.PI;
// Platte L×B×T mit 4 Löchern Ø d, Rand r (Zylinder = 32-Eck? → Toleranz 1 %)
const vPlatte = (L, B, T, d) => L * B * T - 4 * PI * (d / 2) ** 2 * T;

const srv = spawn('node', [new URL('./server.mjs', import.meta.url).pathname, '--no-monitor'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: srv.stdout });
const waiting = new Map(); let nid = 1;
rl.on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
const rpc = (method, params) => new Promise(res => { const id = nid++; waiting.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const tool = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); return JSON.parse(r.result.content[0].text); };
const ex = (command, params) => tool('execute', { command, params });
const vol = async () => (await ex('measure', {})).result.total.volume_mm3;

try {
  await rpc('initialize', { protocolVersion: '2025-06-18' });
  await ex('scene.new', {});
  let r = await tool('batch', { commands: [
    { command: 'param.set', params: { name: 'L', value: 120 } },
    { command: 'param.set', params: { name: 'B', value: 60 } },
    { command: 'param.set', params: { name: 'T', value: 5 } },
    { command: 'param.set', params: { name: 'd', value: 6 } },
    { command: 'param.set', params: { name: 'rand', value: 'd + 4' } },
  ] });
  ok(r.ok, 'Parameter angelegt (rand = d + 4)');
  r = await tool('batch', { commands: [
    { command: 'shape.add', params: { type: 'box', size: ['L', 'B', 'T'], center: [0, 0, 'T/2'], name: 'Platte' } },
    { command: 'shape.add', params: { type: 'cylinder', size: ['d', 'd', 'T+2'], center: ['L/2-rand', 'B/2-rand', 'T/2'], hole: true } },
  ] });
  ok(r.ok && String(r.results[0].result.size) === '120,60,5', 'Platte aus Formeln: ' + r.results?.[0]?.result?.size);
  const platte = r.results[0].result.id, loch = r.results[1].result.id;
  r = await ex('body.mirror', { id: loch, plane: 'YZ', at: 0, copy: true });
  const loch2 = r.result.id;
  r = await ex('body.pattern', { id: loch, linear: { count: 2, step: [0, '-(B - 2*rand)', 0] } });
  const loch3 = r.result.created[0].id;
  r = await ex('body.pattern', { id: loch2, linear: { count: 2, step: [0, '-(B - 2*rand)', 0] } });
  const loch4 = r.result.created[0].id;
  r = await ex('bool.subtract', { target: platte, tools: [loch, loch2, loch3, loch4] });
  const teil = r.result.created[0];
  ok(r.ok && near(teil.volume_mm3, vPlatte(120, 60, 5, 6), 0.002), `Platte mit 4 Löchern: ${teil.volume_mm3} ≈ ${vPlatte(120, 60, 5, 6).toFixed(1)}`);
  const tl = await ex('timeline.list', {});
  ok(tl.ok && tl.result.steps.length === 6 && tl.result.steps[0].params.size[0] === 'L', `Bauplan: ${tl.result.steps.length} Schritte, Formeln gespeichert`);

  // Länge ändern → alles neu, ids bleiben, Löcher wandern mit
  r = await ex('param.set', { name: 'L', value: 150 });
  const nach = (await ex('scene.inspect', { measure: true })).result.bodies;
  ok(r.ok && r.result.recomputed === 6 && nach.length === 1 && nach[0].id === teil.id, `L=150: ${r.result?.recomputed} Schritte neu, id bleibt ${nach[0]?.id}`);
  ok(near(nach[0].volume_mm3, vPlatte(150, 60, 5, 6), 0.002) && String(nach[0].size) === '150,60,5', `Volumen ${nach[0].volume_mm3} ≈ ${vPlatte(150, 60, 5, 6).toFixed(1)}, Größe ${nach[0].size}`);
  r = await ex('param.set', { name: 'd', value: 8 });
  ok(r.ok && near(r.result.volume_after, vPlatte(150, 60, 5, 8), 0.002), `d=8 (rand = d+4 zieht mit): ${r.result?.volume_after} ≈ ${vPlatte(150, 60, 5, 8).toFixed(1)}`);

  // Scheitert ein Schritt → alles bleibt
  await ex('param.set', { name: 'R', value: 1 });
  const k = (await ex('shape.add', { type: 'box', size: [20, 20, 10], center: [0, 60, 5] })).result;
  r = await ex('body.fillet', { id: k.id, radius: 'R', edges: 'top' });
  ok(r.ok, 'Runden mit Parameter R');
  const v0 = await vol();
  r = await ex('param.set', { name: 'R', value: 30 });
  const pl = (await ex('param.list', {})).result.params.find(p => p.name === 'R');
  ok(!r.ok && /Schritt 8/.test(r.error) && pl.value === 1 && near(await vol(), v0, 1e-4), 'R=30 scheitert in Schritt 8, R bleibt 1, Szene unverändert: ' + r.error.slice(0, 90));

  // Fehlerhafte Formeln
  r = await ex('shape.add', { type: 'box', size: ['Lx', 10, 10] });
  ok(!r.ok && /kein bekannter Parameter/.test(r.error), 'unbekannter Parameter → Meldung');
  r = await ex('shape.add', { type: 'box', size: ['L*2+q', 10, 10] });
  ok(!r.ok && /nicht auflösbar/.test(r.error), 'kaputte Formel → Meldung');
  r = await ex('param.set', { name: 'Z', value: 'foo + 1' });
  ok(!r.ok, 'param.set mit unbekanntem Namen → Fehler');
  r = await ex('param.delete', { name: 'd' });
  ok(!r.ok && /benutzt/.test(r.error), 'benutzten Parameter löschen → verweigert: ' + r.error);

  // Bauplan bearbeiten
  r = await ex('timeline.edit', { step: 2, params: { size: ['d', 'd', 'T+2'], center: ['L/2-rand', 'B/2-rand', 'T/2'] } });
  ok(r.ok && r.result.recomputed === 8, 'timeline.edit Schritt 2');
  r = await ex('timeline.delete', { step: 2 });
  ok(!r.ok && /Schritt/.test(r.error), 'Schritt löschen, von dem andere abhängen → verweigert: ' + r.error.slice(0, 80));
  r = await ex('timeline.delete', { step: 8 });
  ok(r.ok && (await ex('timeline.list', {})).result.steps.length === 7, 'letzten Schritt (Runden) gelöscht → 7 Schritte');

  // Undo über die API nimmt auch den Bauplan-Schritt zurück
  await ex('shape.add', { type: 'sphere', size: [10, 10, 10], center: [0, -60, 5] });
  const vorUndo = (await ex('timeline.list', {})).result.steps.length;
  await tool('undo', {});
  ok((await ex('timeline.list', {})).result.steps.length === vorUndo - 1, 'Undo nimmt den Bauplan-Schritt mit zurück');
  await tool('save', { path: 'bauplan-test.json' });
} catch (e) { console.error(e); fail++; }
srv.stdin.end();

// ── Teil 2: im Browser ──
const dev = spawn('python3', ['volme3d_server.py', '8978', '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch();
try {
  const p = await b.newPage();
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8978/volme3d.html');
  await p.waitForFunction(() => window.v3dApi && v3dApi.ready());
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  const A = (c, q) => p.evaluate(([c, q]) => v3dApi.execute(c, q), [c, q]);
  await A('param.set', { name: 'w', value: 40 });
  const box = (await A('shape.add', { type: 'box', size: ['w', 20, 10] })).result;
  await A('body.fillet', { id: box.id, radius: 2, edges: 'vertical' });

  // 𝑥-Panel: Nutzer ändert w → Bauplan rechnet neu
  await p.evaluate(() => { toggleVarsPanel(); const i = designVars.findIndex(v => v.name === 'w'); _varsEdit(i, 'expr', '60'); });
  await p.waitForFunction(() => objects.length === 1 && Math.abs(getMeshBox(objects[0]).getSize(new THREE.Vector3()).x * 10 - 60) < 0.01, null, { timeout: 30000 });
  ok(true, '𝑥-Panel: w = 60 → Körper 60 mm breit');

  // Speichern/Laden: Bauplan reist mit
  const snap = await p.evaluate(() => JSON.stringify(_sceneSnapshot()));
  ok(JSON.parse(snap).apiRecipe && JSON.parse(snap).apiRecipe.steps.length === 2, 'Szene enthält den Bauplan (2 Schritte)');
  await p.evaluate(s => { _newCreate(false); _applySnapshot(JSON.parse(s)); }, snap);
  let r = await A('param.set', { name: 'w', value: 30 });
  ok(r.ok && r.result.recomputed === 2 && Math.abs(r.result.bodies[0].size[0] - 30) < 0.01, 'nach dem Laden weiter parametrisch: w = 30');

  // Handänderung im Editor → Bauplan friert ein, Handänderung bleibt
  await p.evaluate(() => { saveUndo(); objects[0].position.x += 2; });   // wie Ziehen mit der Maus
  r = await A('param.set', { name: 'w', value: 50 });
  const x = await p.evaluate(() => getMeshBox(objects[0]).getCenter(new THREE.Vector3()).x * 10);
  ok(r.ok && r.result.recomputed === 0 && (r.messages || []).some(m => /eingefroren/.test(m)) && Math.abs(x - 20) < 0.01, 'Handänderung erkannt: Bauplan eingefroren, Verschiebung bleibt (' + (r.messages || []).join(' ').slice(0, 70) + ')');
  const tl = await A('timeline.list', {});
  ok(tl.result.steps.length === 0, 'neuer Bauplan ab dem jetzigen Stand');
  const z = await A('shape.add', { type: 'cylinder', size: ['w', 'w', 5], center: [0, 50, 2.5] });
  ok(z.ok && Math.abs(z.result.size[0] - 50) < 0.01, 'neue Schritte nutzen die Parameter weiter (w = 50)');
} catch (e) { console.error(e); fail++; }
await b.close(); dev.kill();
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
setTimeout(() => process.exit(fail ? 1 : 0), 500);
