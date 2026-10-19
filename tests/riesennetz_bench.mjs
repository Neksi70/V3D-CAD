// Messaufbau Riesen-Netze: Import einer Scan-STL (ohne Reduktion), dann die
// typischen Schritte einzeln mit Zeit + JS-Heap. Kein Pass/Fail — liefert Zahlen.
// Aufruf: node tests/riesennetz_bench.mjs /tmp/bigstl/scan2m.stl [json-ausgabe]
// Testmodell erzeugen: node /tmp/bigstl/gen.mjs /tmp/bigstl/scan2m.stl 2000000
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const STL = process.argv[2] || '/tmp/bigstl/scan2m.stl', OUT = process.argv[3];
const PORT = 8961;
const srv = spawn('python3', ['/home/v3da/volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
const br = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc --max-old-space-size=8192'] });
const pg = await br.newPage({ viewport: { width: 1400, height: 900 } });
const fehler = []; pg.on('pageerror', e => fehler.push(String(e).slice(0, 200)));
const R = {};
const heap = () => pg.evaluate(() => { if (window.gc) gc(); return Math.round(performance.memory.usedJSHeapSize / 1e6); });
const schritt = async (name, fn) => {
  const t0 = Date.now(); let info = null;
  try { info = await fn(); } catch (e) { info = 'FEHLER: ' + String(e).slice(0, 160); }
  R[name] = { ms: Date.now() - t0, heapMB: await heap(), info };
  console.log(name.padEnd(22), String(R[name].ms).padStart(7), 'ms', String(R[name].heapMB).padStart(6), 'MB', info == null ? '' : JSON.stringify(info));
};
try {
  await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await pg.waitForFunction(() => typeof hideStarter === 'function' && typeof objects !== 'undefined', null, { timeout: 30000 });
  await pg.evaluate(() => { hideStarter(); _newCreate(false); clearInterval(window._autoSaveTimer); });
  await new Promise(r => setTimeout(r, 1500));
  await schritt('start', async () => null);
  await schritt('import', async () => {
    await pg.setInputFiles('#fimport', STL);
    await pg.waitForFunction(() => objects.length >= 1 && document.getElementById('sz-decim-row') && document.getElementById('sz-decim-row').style.display !== 'none', null, { timeout: 600000 });
    return pg.evaluate(() => { const g = objects[0].geometry; return { tris: (g.index ? g.index.count : g.attributes.position.count) / 3, indiziert: !!g.index }; });
  });
  await schritt('groesse_ok', () => pg.evaluate(async () => {
    document.getElementById('sz-decim-chk').checked = false; _confirmSize();
    await new Promise(r => setTimeout(r, 200));
    const g = objects[0].geometry; return { tris: (g.index ? g.index.count : g.attributes.position.count) / 3, kanten: !!objects[0].children.find(c => c.userData && c.userData.isEdgeLines) };
  }));
  await schritt('erster_klick', () => pg.evaluate(() => {
    const o = objects[0], b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
    const rc = new THREE.Raycaster(c.clone().add(new THREE.Vector3(0, 0, 50)), new THREE.Vector3(0, 0, -1));
    const t = performance.now(); const h = rc.intersectObject(o, false); return { treffer: h.length, ms: Math.round(performance.now() - t) };
  }));
  await schritt('klick_2', () => pg.evaluate(() => {
    const o = objects[0], c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    const rc = new THREE.Raycaster(c.clone().add(new THREE.Vector3(0.3, 0, 50)), new THREE.Vector3(0, 0, -1));
    const t = performance.now(); rc.intersectObject(o, false); return { ms: +(performance.now() - t).toFixed(2) };
  }));
  await schritt('auswahl', () => pg.evaluate(() => { selectObjs([objects[0]]); return null; }));
  await schritt('drehen_box', () => pg.evaluate(() => {
    const o = objects[0]; o.rotation.y = 0.5; o.updateMatrixWorld(true);
    const t = performance.now(); getMeshBox(o); const t1 = performance.now() - t;
    o.rotation.y = 0.6; o.updateMatrixWorld(true); const t2s = performance.now(); getMeshBox(o);
    return { erstes_ms: Math.round(t1), zweites_ms: +(performance.now() - t2s).toFixed(2) };
  }));
  await schritt('saveUndo', () => pg.evaluate(() => { saveUndo(); return null; }));
  await schritt('undo', () => pg.evaluate(() => { undo(); const g = objects[0].geometry; return { tris: (g.index ? g.index.count : g.attributes.position.count) / 3 }; }));
  await schritt('duplizieren', () => pg.evaluate(() => {
    selectObjs([objects[0]]); const n0 = objects.length; smartDuplicate();
    const d = objects[objects.length - 1], g = d.geometry; const r = { neu: objects.length - n0, tris: (g.index ? g.index.count : g.attributes.position.count) / 3 };
    return r;
  }));
  await schritt('dup_weg', () => pg.evaluate(() => { const d = objects[objects.length - 1]; scene.remove(d); objects.pop(); return null; }));
  await schritt('snapshot', () => pg.evaluate(() => { const s = _sceneSnapshot(); const j = JSON.stringify(s); window._benchJ = j;
    const g = s.objects && s.objects[0] && s.objects[0].geometry; return { zeichen: j.length, tris_gespeichert: g && g.data && g.data.attributes ? g.data.attributes.position.array.length / 9 : null }; }));
  await schritt('autosave', () => pg.evaluate(async () => { objects[0].position.x += 0.01; objects[0].updateMatrixWorld(true); _doAutoSave(); await new Promise(r => setTimeout(r, 500)); return null; }));
  await schritt('datei_json', () => pg.evaluate(() => ({ zeichen: _sceneJson().length })));
  await schritt('laden_snapshot', () => pg.evaluate(() => { const d = JSON.parse(window._benchJ); const o = buildObjectFromData(d.objects[0]); const g = o.geometry; return { tris: (g.index ? g.index.count : g.attributes.position.count) / 3 }; }));
} catch (e) { console.error(e); }
if (fehler.length) console.log('Seitenfehler:', fehler.slice(0, 3));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
await br.close(); srv.kill();
