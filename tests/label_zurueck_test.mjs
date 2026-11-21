// 🏷️ Beschriftung zurückholen (21.11.26): eingeprägter Text → im Eigenschaften-Feld
// „✏️ Text / Schrift ändern“ (Text-Dialog vorbefüllt → Übernehmen → Anbringen) und
// „📍 Text auf andere Fläche setzen“ (Text am Zeiger → neue Fläche → Anbringen).
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
import https from 'node:https';
const PORT = 8942;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.route('**/api/occt-*', async route => {
  const req = route.request(); const body = req.postData() || ''; const url = new URL(req.url());
  try { const res = await new Promise((res_, rej) => { const r = https.request({ host: '127.0.0.1', port: 3001, path: url.pathname, method: req.method(), rejectUnauthorized: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, resp => { const c = []; resp.on('data', d => c.push(d)); resp.on('end', () => res_(Buffer.concat(c))); });
      r.on('error', rej); r.end(body); });
    await route.fulfill({ status: 200, contentType: 'application/json', body: res });
  } catch (e) { await route.abort(); } });
await pg.addInitScript(() => { try { localStorage.setItem('v3d_umsteiger_hinweis', '1'); } catch (e) {} });
await pg.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', null, { timeout: 60000 });
await pg.waitForTimeout(1500);
await pg.evaluate(() => { hideStarter(); document.getElementById('umsteiger-hinweis')?.remove(); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const vol = () => pg.evaluate(() => objects.map(o => { o.updateMatrixWorld(true);
  const p = o.geometry.attributes.position, ix = o.geometry.index?.array, n = ix ? ix.length : p.count, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let v = 0;
  for (let t = 0; t < n; t += 3) { a.fromBufferAttribute(p, ix ? ix[t] : t).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, ix ? ix[t+1] : t+1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(p, ix ? ix[t+2] : t+2).applyMatrix4(o.matrixWorld); v += a.dot(b.clone().cross(c)) / 6; }
  return Math.round(Math.abs(v) * 1000); }));
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const klick = async v => { const pt = await scr(v); await pg.mouse.move(pt.x - 5, pt.y - 5); await pg.mouse.move(pt.x, pt.y); await pg.waitForTimeout(80); await pg.mouse.click(pt.x, pt.y); await pg.waitForTimeout(300); };
const anbringen = async () => { await pg.click('#lbl-pop .btn.pri');
  await pg.waitForFunction(() => objects.length === 1 && !objects[0].userData.textEdit, null, { timeout: 60000 }).catch(() => {}); await pg.waitForTimeout(400); };

// Ausgangslage: Quader + Text „AB“ vorne eingeprägt (0,8 mm)
await pg.evaluate(() => { _newCreate(false); addShape('box'); const o = objects[0]; o.userData.name = 'K'; window.__p = o.position.clone();
  orbitTarget.set(0, 1, 0); sph.theta = 0.5; sph.phi = 1.0; sph.r = 9; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]); });
const v0 = (await vol())[0];
await pg.evaluate(() => addTextShape());
await pg.fill('#text3d-input', 'AB');
await pg.evaluate(() => { const s = document.getElementById('text3d-size'); s.value = 6; s.dispatchEvent(new Event('input')); });
await pg.click('#text3d-ok');
await pg.waitForFunction(() => objects.some(o => o.userData.textEdit), null, { timeout: 30000 });
await pg.waitForTimeout(200);
await pg.evaluate(() => { const k = objects.find(o => o.userData.name === 'K'); k.position.copy(window.__p); k.updateMatrixWorld(true); });
await klick([0, 1, 1]);
await pg.click('#lbl-tief'); await pg.fill('#lbl-mm', '0,8');
await anbringen();
const v1 = (await vol())[0];
ok('Ausgangslage: Text eingeprägt', v1 < v0 - 3, { v0, v1 });
const fp = await pg.evaluate(() => ({ btns: [...document.querySelectorAll('#fp-body .fp-btn')].map(b => b.textContent.trim()), lbl: objects[0].userData.opJournal?.lbl }));
ok('Feld zeigt „Text / Schrift ändern“ und „auf andere Fläche setzen“', fp.btns.some(t => /Text \/ Schrift ändern/.test(t)) && fp.btns.some(t => /andere Fläche/.test(t)), fp.btns);
ok('Art + Tiefe am Ergebnis gemerkt', fp.lbl && fp.lbl.art === 'tief' && fp.lbl.mm === 0.8, fp.lbl);

// 1) Schrift ändern
await pg.evaluate(() => [...document.querySelectorAll('#fp-body .fp-btn')].find(b => /Schrift ändern/.test(b.textContent)).click());
await pg.waitForTimeout(400);
const d1 = await pg.evaluate(() => ({ n: objects.length, modal: document.getElementById('text3d-modal').classList.contains('show'), txt: document.getElementById('text3d-input').value,
  font: document.getElementById('text3d-font').value, fonts: [...document.getElementById('text3d-font').options].map(o => o.value).filter(v => !/^user_/.test(v)) }));
ok('Gravur aufgelöst, Text-Dialog vorbefüllt', d1.n === 2 && d1.modal && d1.txt === 'AB', { n: d1.n, modal: d1.modal, txt: d1.txt });
const neueSchrift = d1.fonts.find(f => f !== d1.font);
await pg.fill('#text3d-input', 'CD');
await pg.evaluate(f => { const s = document.getElementById('text3d-font'); s.value = f; s.dispatchEvent(new Event('change')); }, neueSchrift);
await pg.click('#text3d-ok');
await pg.waitForFunction(() => document.getElementById('lbl-pop').style.display === 'block', null, { timeout: 30000 }).catch(() => {});
const p1 = await pg.evaluate(() => { const t = objects.find(o => o.userData.textEdit); return { pop: document.getElementById('lbl-pop').style.display, tief: document.getElementById('lbl-tief').classList.contains('on'),
  mm: document.getElementById('lbl-mm').value, str: t && t.userData.textEdit.str, font: t && t.userData.textEdit.font }; });
ok('nach „Übernehmen“: neue Schrift, Beschriften-Feld mit vertieft 0,8', p1.pop === 'block' && p1.tief && p1.mm === '0.8' && p1.str === 'CD' && p1.font === neueSchrift, p1);
await anbringen();
const v2 = (await vol());
const j2 = await pg.evaluate(() => { const t = objects[0].userData.opJournal?.parts.find(d => d.textEdit); return t && t.textEdit; });
ok('wieder ein Körper, eingeprägt, Journal hat „CD“', v2.length === 1 && v2[0] < v0 - 3 && j2 && j2.str === 'CD' && j2.font === neueSchrift, { v2, j2 });

// 2) Abbrechen im Text-Dialog → zurück ins Beschriften-Feld (Text bleibt nicht lose hängen)
await pg.evaluate(() => [...document.querySelectorAll('#fp-body .fp-btn')].find(b => /Schrift ändern/.test(b.textContent)).click());
await pg.waitForTimeout(300);
await pg.click('#text3d-modal .btn:has-text("Abbrechen")');
await pg.waitForTimeout(200);
ok('Abbrechen → Beschriften-Feld offen', await pg.evaluate(() => document.getElementById('lbl-pop').style.display === 'block' && objects.length === 2));
await anbringen();
ok('… und wieder einprägen geht', (await vol()).length === 1);

// 3) auf andere Fläche (oben) setzen
await pg.evaluate(() => [...document.querySelectorAll('#fp-body .fp-btn')].find(b => /andere Fläche/.test(b.textContent)).click());
await pg.waitForTimeout(300);
ok('Text hängt am Zeiger (Klick-Modus)', await pg.evaluate(() => !!_lblPick && objects.length === 2));
await pg.evaluate(() => { sph.r = 13; sph.phi = 0.9; sph2cam(); camera.updateMatrixWorld(true); });
await klick([0, 2, 0]);
const p3 = await pg.evaluate(() => { const t = objects.find(o => o.userData.textEdit); const c = _svgCenterWorld(t);
  return { pop: document.getElementById('lbl-pop').style.display, c: c.toArray().map(x => +(x * 10).toFixed(1)), tief: document.getElementById('lbl-tief').classList.contains('on') }; });
ok('Text sitzt oben, Feld offen mit vertieft', p3.pop === 'block' && p3.tief && Math.abs(p3.c[1] - 20) < 1.2, p3);
await anbringen();
const top = await pg.evaluate(() => { const o = objects[0]; const bb = new THREE.Box3().setFromObject(o); return { n: objects.length, maxY: +(bb.max.y * 10).toFixed(2), maxZ: +(bb.max.z * 10).toFixed(2) }; });
const v3 = await vol();
ok('oben eingeprägt, nichts steht über', top.n === 1 && v3[0] < v0 - 3 && Math.abs(top.maxY - 20) < 0.05, { top, v3 });

// 4) erhaben: aufgesetzter Text → Schrift ändern → wieder aufgesetzt
await pg.evaluate(() => { _newCreate(false); addShape('box'); const o = objects[0]; o.userData.name = 'K'; window.__p = o.position.clone();
  orbitTarget.set(0, 1, 0); sph.theta = 0.5; sph.phi = 1.0; sph.r = 9; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]); });
await pg.evaluate(() => addTextShape());
await pg.fill('#text3d-input', 'EF');
await pg.evaluate(() => { const s = document.getElementById('text3d-size'); s.value = 6; s.dispatchEvent(new Event('input')); });
await pg.click('#text3d-ok');
await pg.waitForFunction(() => objects.some(o => o.userData.textEdit), null, { timeout: 30000 });
await pg.waitForTimeout(200);
await pg.evaluate(() => { const k = objects.find(o => o.userData.name === 'K'); k.position.copy(window.__p); k.updateMatrixWorld(true); });
await klick([0, 1, 1]);
await pg.click('#lbl-hoch'); await pg.fill('#lbl-mm', '1');
await anbringen();
const h1 = await vol();
const hb = await pg.evaluate(() => [...document.querySelectorAll('#fp-body .fp-btn')].map(b => b.textContent.trim()));
ok('erhaben: ein Körper, größer, Knöpfe da', h1.length === 1 && h1[0] > 8003 && hb.some(t => /Schrift ändern/.test(t)), { h1, hb });
await pg.evaluate(() => [...document.querySelectorAll('#fp-body .fp-btn')].find(b => /Schrift ändern/.test(b.textContent)).click());
await pg.waitForTimeout(300);
await pg.fill('#text3d-input', 'GH');
await pg.click('#text3d-ok');
await pg.waitForFunction(() => document.getElementById('lbl-pop').style.display === 'block', null, { timeout: 30000 }).catch(() => {});
ok('erhaben: Feld steht auf „erhaben“ 1 mm', await pg.evaluate(() => document.getElementById('lbl-hoch').classList.contains('on') && document.getElementById('lbl-mm').value === '1'));
await anbringen();
const h2 = await pg.evaluate(() => { const o = objects[0], bb = new THREE.Box3().setFromObject(o); return { n: objects.length, maxZ: +(bb.max.z * 10).toFixed(2), str: o.userData.opJournal?.parts.find(d => d.textEdit)?.textEdit.str }; });
const h2v = await vol();
ok('erhaben: wieder ein Körper, steht 1 mm vor, „GH“', h2.n === 1 && h2v[0] > 8003 && Math.abs(h2.maxZ - 11) < 0.08 && h2.str === 'GH', { h2, h2v });

ok('keine Seitenfehler', errs.length === 0, errs);
console.log(fails.length ? 'FEHLER: ' + fails.join(' | ') : 'ALLES OK');
await b.close(); srv.kill();
process.exitCode = fails.length ? 1 : 0;
