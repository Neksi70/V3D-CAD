// „Beschriftung anbringen": Text-Dialog „Auf Bauteil" → Stelle anklicken → Feld
// Vertieft/Erhaben → ✓ Anbringen. Geprüft an Quader (eben) und Zylinder (Rundung),
// jeweils vertieft und erhaben, über echte Klicks; dazu der alte Weg über
// „Abziehen" + Regler am Quader (endete vorher mit „leerer Körper").
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
import https from 'node:https';
const PORT = 8941;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
const log = []; pg.on('console', m => log.push(m.text()));
await pg.route('**/api/occt-*', async route => {
  const req = route.request(); const body = req.postData() || ''; const url = new URL(req.url());
  try { const res = await new Promise((res_, rej) => { const r = https.request({ host: '127.0.0.1', port: 3001, path: url.pathname, method: req.method(), rejectUnauthorized: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, resp => { const c = []; resp.on('data', d => c.push(d)); resp.on('end', () => res_(Buffer.concat(c))); });
      r.on('error', rej); r.end(body); });
    await route.fulfill({ status: 200, contentType: 'application/json', body: res });
  } catch (e) { await route.abort(); } });
await pg.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', null, { timeout: 60000 });
await pg.waitForTimeout(1500);
await pg.evaluate(() => hideStarter());
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// Volumen (mm³) + Hülle (mm) aller Körper, offene Kanten des ersten
const stand = () => pg.evaluate(() => objects.map(o => {
  o.updateMatrixWorld(true);
  const p = o.geometry.attributes.position, ix = o.geometry.index?.array, n = ix ? ix.length : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let v = 0;
  const kanten = new Map(), key = q => Math.round(q.x*1e5) + ',' + Math.round(q.y*1e5) + ',' + Math.round(q.z*1e5);
  for (let t = 0; t < n; t += 3) {
    a.fromBufferAttribute(p, ix ? ix[t] : t).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, ix ? ix[t+1] : t+1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(p, ix ? ix[t+2] : t+2).applyMatrix4(o.matrixWorld);
    v += a.dot(b.clone().cross(c)) / 6;
    const k = [key(a), key(b), key(c)];
    for (let e = 0; e < 3; e++) { const u = k[e], w = k[(e+1)%3]; if (u === w) continue; const kk = u < w ? u + '|' + w : w + '|' + u; kanten.set(kk, (kanten.get(kk) || 0) + 1); }
  }
  let offen = 0; kanten.forEach(z => { if (z !== 2) offen++; });
  const bb = new THREE.Box3().setFromObject(o);
  return { name: o.userData.name, hole: !!o.userData.isHole, st: o.userData.shapeType, vol: Math.round(Math.abs(v) * 1000),
           min: bb.min.toArray().map(x => +(x*10).toFixed(2)), max: bb.max.toArray().map(x => +(x*10).toFixed(2)), offen };
}));
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);

async function fall(shape, art, mm, dialogWeg) {
  await pg.evaluate(shape => { _newCreate(false); addShape(shape); const o = objects[0]; o.userData.name = 'K';
    window.__p = o.position.clone();
    orbitTarget.set(0, 1, 0); sph.theta = 0.5; sph.phi = 1.2; sph.r = 9; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]); }, shape);
  const vor = (await stand())[0];
  // Dialog: „Auf Bauteil" ist vorgewählt, sobald ein Bauteil da ist
  await pg.evaluate(() => addTextShape());
  const modus = await pg.evaluate(() => [...document.querySelectorAll('#text3d-mode-bg .vtb')].find(x => x.classList.contains('on')).textContent);
  await pg.fill('#text3d-input', 'AB');
  await pg.evaluate(() => { const s = document.getElementById('text3d-size'); s.value = 6; s.dispatchEvent(new Event('input')); });
  await pg.click('#text3d-ok');
  await pg.waitForFunction(() => objects.some(o => o.userData.textEdit), null, { timeout: 30000 });
  await pg.waitForTimeout(200);
  await pg.evaluate(() => { const k = objects.find(o => o.userData.name === 'K'); k.position.copy(window.__p); k.updateMatrixWorld(true); });
  const pick = await pg.evaluate(() => ({ pick: !!_lblPick, hint: document.getElementById('hint').textContent.slice(0, 22) }));
  // Stelle auf der Vorderseite (+Z) anklicken: 3 mm rechts, 2 mm über der Mitte
  const ziel = [0.3, 1.2, 1];
  const pt = await scr(ziel);
  await pg.mouse.move(pt.x - 5, pt.y - 5); await pg.mouse.move(pt.x, pt.y); await pg.waitForTimeout(80);
  await pg.mouse.click(pt.x, pt.y); await pg.waitForTimeout(300);
  const nachKlick = await pg.evaluate(() => { const m = objects.find(o => o.userData.textEdit); const c = _svgCenterWorld(m);
    return { pick: !!_lblPick, pop: document.getElementById('lbl-pop').style.display, c: c.toArray().map(x => +(x*10).toFixed(1)),
             wrap: !!m.userData._svgWrap, flat: !!m.userData._snapNormal, ctx: document.getElementById('ctx-label').style.display }; });
  const tag = `${shape}/${art}${dialogWeg ? '/alt' : ''}`;
  ok(`${tag}: „Auf Bauteil" vorgewählt, Klick-Modus aktiv`, /Bauteil/.test(modus) && pick.pick, { modus, ...pick });
  ok(`${tag}: Text sitzt am Klickpunkt, Feld offen`, !nachKlick.pick && nachKlick.pop === 'block' && Math.abs(nachKlick.c[0] - 3) < 1.2 && Math.abs(nachKlick.c[1] - 12) < 0.6 && nachKlick.ctx !== 'none', nachKlick);
  if (dialogWeg) {
    // alter Weg: als Bohrung markieren, beide wählen, Abziehen, Regler
    await pg.evaluate(() => { _lblClose(); const m = objects.find(o => o.userData.textEdit), k = objects.find(o => o.userData.name === 'K');
      selectObjs([m]); setObjMode('hole'); selectObjs([k, m]); subtractHoles(); });
    await pg.waitForSelector('._em-rng', { timeout: 5000 });
    await pg.evaluate(d => { const r = document.querySelector('._em-rng'); r.value = d; r.dispatchEvent(new Event('input')); }, art === 'tief' ? mm : -mm);
    await pg.click('._em-ok');
    if (art === 'hoch') { await pg.waitForTimeout(500); await pg.evaluate(() => { selectObjs(objects.slice()); return unionSelected(); }); }
  } else {
    await pg.click(art === 'hoch' ? '#lbl-hoch' : '#lbl-tief');
    await pg.fill('#lbl-mm', String(mm).replace('.', ','));
    await pg.click('#lbl-pop .btn.pri');
  }
  await pg.waitForFunction(() => objects.length === 1 && !objects[0].userData.textEdit, null, { timeout: 60000 }).catch(() => {});
  await pg.waitForTimeout(400);
  const nach = await stand();
  const d = nach.length === 1 ? nach[0].vol - vor.vol : null;
  const raus = nach.length === 1 ? +(nach[0].max[2] - vor.max[2]).toFixed(2) : null;
  if (art === 'tief') ok(`${tag}: ein Körper, Volumen kleiner, nichts steht vor`, nach.length === 1 && d < -3 && Math.abs(raus) < 0.02 && (shape !== 'box' || nach[0].offen === 0), { d, raus, offen: nach[0]?.offen, n: nach.length });
  else ok(`${tag}: ein Körper, Volumen größer, steht ${mm} mm vor`, nach.length === 1 && d > 3 && Math.abs(raus - mm) < 0.06 && (shape !== 'box' || nach[0].offen === 0), { d, raus, offen: nach[0]?.offen, n: nach.length });
  return { d, raus };
}
const a1 = await fall('box', 'tief', 0.8);
const a2 = await fall('box', 'tief', 1.6);
ok('doppelte Tiefe = doppeltes Volumen', Math.abs(a2.d / a1.d - 2) < 0.1, [a1.d, a2.d]);
await fall('box', 'hoch', 0.8);
await fall('cylinder', 'tief', 0.8);
await fall('cylinder', 'hoch', 0.8);
await fall('box', 'tief', 1, true);
await fall('box', 'hoch', 1, true);
// Rückgängig stellt Körper + Text wieder her
await pg.evaluate(() => { undo(); undo(); });
ok('Rückgängig bringt Text und Körper zurück', (await stand()).length === 2);
// Esc im Klick-Modus: Text bleibt frei
await pg.evaluate(() => { _newCreate(false); addShape('box'); addTextShape(); });
await pg.fill('#text3d-input', 'X'); await pg.click('#text3d-ok');
await pg.waitForFunction(() => !!_lblPick, null, { timeout: 30000 });
await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
ok('Esc beendet den Klick-Modus', await pg.evaluate(() => !_lblPick && objects.length === 2 && !document.getElementById('hint').classList.contains('show')));
// Ohne Bauteil: Modus „Frei"
await pg.evaluate(() => { _newCreate(false); addTextShape(); });
ok('ohne Bauteil ist „Frei" vorgewählt', await pg.evaluate(() => [...document.querySelectorAll('#text3d-mode-bg .vtb')].find(x => x.classList.contains('on')).textContent === 'Frei'));
ok('keine Seitenfehler', errs.length === 0, errs);
if (fails.length) console.log(log.filter(t => /fehl|error|warn/i.test(t)).slice(-12).join('\n'));
console.log(fails.length ? 'FEHLER: ' + fails.join(' | ') : 'ALLES OK');
await b.close(); srv.kill();
process.exitCode = fails.length ? 1 : 0;
