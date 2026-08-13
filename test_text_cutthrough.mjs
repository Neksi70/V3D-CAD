// E2E: Text als Bohrung im Modus "Durchbruch" muss ein echtes Loch durch den
// Körper schneiden (bisher lief Text immer über die Gravur-Pipeline und
// hinterließ bei eingetauchtem Text nur einen unsichtbaren Innenhohlraum).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import https from 'node:https';

const PORT = 8797;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

// _OCCT_BASE ist '' (gleicher Origin über nginx). Der Test-Server kennt die
// Route nicht → an das echte occt-server.js auf :3001 durchreichen.
await page.route('**/api/occt-*', async route => {
  const req = route.request();
  const body = req.postData() || '';
  const url = new URL(req.url());
  try {
    const res = await new Promise((res_, rej) => {
      const r = https.request({ host: '127.0.0.1', port: 3001, path: url.pathname,
        method: req.method(), rejectUnauthorized: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        resp => { const c = []; resp.on('data', d => c.push(d)); resp.on('end', () => res_(Buffer.concat(c))); });
      r.on('error', rej); r.end(body);
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: res });
  } catch (e) { await route.abort(); }
});

// ── Szene aufbauen: Box + Text als Bohrung, mitten in die Box geschoben ─────
const BUILD = async (sink = true) => {
  // Seite frisch laden statt newScene(): ein kaputtes Ergebnis-Mesh in der Szene
  // reißt sonst saveUndo/objectToData mit (siehe Befund Gravur-Modus).
  await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.evaluate(s => { window.__sink = s; }, sink);
  return page.evaluate(async () => {
  // Autosave stellt beim Neuladen die vorige Szene wieder her → hart leeren
  objects.slice().forEach(o => scene.remove(o));
  objects.length = 0;
  deselect(); updateTree();
  setShapeMode('solid');
  addShape('box');
  const box = objects[objects.length - 1];
  const bbBox = new THREE.Box3().setFromObject(box);

  // Text als Bohrung anlegen (läuft über die SVG-Pipeline)
  setShapeMode('hole');
  addTextShape();
  _text3dSetMode('free');
  document.getElementById('text3d-input').value = 'AB';
  document.getElementById('text3d-size').value = '8';
  _confirmText3d();
  // Font kommt vom CDN → warten bis das SVG-Objekt in der Szene ist
  for (let i = 0; i < 120 && objects.length < 2; i++) await new Promise(r => setTimeout(r, 250));
  const txt = objects.find(o => o !== box && o.userData.isHole);
  if (!txt) return { err: 'Text-Objekt nicht entstanden' };

  // sink=true: genau das, was der Tester gemacht hat — Text KOMPLETT in den
  // Körper schieben. sink=false: Text bündig auf der Oberseite (normale Gravur).
  const ctr = bbBox.getCenter(new THREE.Vector3());
  txt.position.copy(ctr);
  if (!window.__sink) txt.position.y = bbBox.max.y;
  txt.updateWorldMatrix(true, true);

  selectObjs([box, txt]);
  return { ok: true, type: txt.userData.type, boxSize: bbBox.getSize(new THREE.Vector3()).toArray() };
  });
};

const setup = await BUILD();
if (setup.err) { console.log('SETUP FEHLER:', setup.err); await browser.close(); srv.kill(); process.exit(1); }
console.log('Text-Objekttyp:', setup.type, '| Box-Größe:', setup.boxSize.map(v => v.toFixed(2)).join(' × '));

// ── Durchbruch-Nachweis: entlang der Extrusionsachse (Welt-Y) durch den Körper
// schießen. Ein Strahl, der KEINE Fläche trifft, ist durchgehend frei = Loch.
const PROBE = `(() => {
  const o = objects[0];
  if (!o) return { err: 'kein Objekt übrig' };
  if (!o.userData.isSubtract) return { err: 'Subtraktion nicht durchgelaufen (objects=' + objects.length + ')' };
  const bb = new THREE.Box3().setFromObject(o);
  const size = bb.getSize(new THREE.Vector3());
  const c = bb.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster();
  let open = 0, solid = 0, probes = 0;
  for (let ix = -20; ix <= 20; ix++) for (let iz = -20; iz <= 20; iz++) {
    const p = new THREE.Vector3(c.x + size.x*0.45*(ix/20), bb.max.y + size.y, c.z + size.z*0.45*(iz/20));
    ray.set(p, new THREE.Vector3(0, -1, 0));
    probes++;
    const n = ray.intersectObject(o, false).length;
    if (n === 0) open++; else if (n >= 2) solid++;
  }
  return { tris: (o.geometry?.attributes?.position?.count || 0) / 3, probes, open, solid };
})()`;

async function runSubtract(page, through) {
  await page.evaluate(() => { subtractHoles(); });
  await page.waitForSelector('._em-mode[data-through="1"]', { timeout: 8000 });
  if (through) await page.click('._em-mode[data-through="1"]');
  const lbl = await page.textContent('._em-lbl');
  await page.click('._em-ok');
  return page.evaluate(async (probeSrc) => {
    for (let i = 0; i < 240; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (objects.length === 1 && objects[0].userData.isSubtract) break;
    }
    return eval(probeSrc);
  }, PROBE).then(r => ({ ...r, lbl }));
}

// 1) Eingetauchter Text + Gravur-Modus → muss sauber abbrechen, Originale bleiben
const grv = await runSubtract(page, false);
console.log('A) eingetaucht + Gravur   :', JSON.stringify(grv));

// 2) Eingetauchter Text + Durchbruch → echtes Loch, Körper intakt
await BUILD(true);
const thr = await runSubtract(page, true);
console.log('B) eingetaucht + Durchbruch:', JSON.stringify(thr));

// 3) Text bündig auf der Oberfläche + Gravur → Gravur-Pfad wie bisher.
// Hinweis: Ohne Magnet-Snap läuft dieser Fall headless auch im unveränderten
// Stand (git HEAD) nicht durch — gemessen: {objs:2, isSub:false}. Die Prüfung
// sichert daher nur ab, dass sich der Gravur-Pfad NICHT verändert hat; sie ist
// kein Nachweis, dass die Oberflächen-Gravur im Browser funktioniert.
await BUILD(false);
const srf = await runSubtract(page, false);
console.log('C) Oberfläche + Gravur    :', JSON.stringify(srf));

await browser.close(); srv.kill();

const checks = [
  ['A leerer Körper wird abgefangen (nichts geht verloren)', !!grv.err && grv.err.includes('objects=2')],
  ['B Durchbruch: Loch durchgehend + Körper intakt',          !thr.err && thr.tris > 12 && thr.open > 0 && thr.solid > 0],
  ['C Gravur-Pfad unverändert (Originale bleiben, wie HEAD)', !!srf.err && srf.err.includes('objects=2')],
];
console.log('');
for (const [name, ok] of checks) console.log((ok ? '✓ ' : '❌ ') + name);
const allOk = checks.every(c => c[1]);
if (!allOk) for (const e of errs.slice(0, 6)) console.log('   •', e.slice(0, 200));
process.exit(allOk ? 0 : 1);
