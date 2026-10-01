// Text: Buchstabenabstand + „Buchstaben verschweißen". Überlappende Buchstaben
// werden EIN Umriss/Körper (dicht, Volumen < Summe), getrennte bleiben getrennt.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
const PORT = 8945;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', null, { timeout: 60000 });
await pg.waitForTimeout(1500);
await pg.evaluate(() => hideStarter());
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

async function text(str, gap, weld, modus = 'free') {
  await pg.evaluate(() => { _newCreate(false); addTextShape(); });
  await pg.evaluate(m => _text3dSetMode(m), modus);
  await pg.fill('#text3d-input', str);
  if (modus !== 'arc') await pg.evaluate(g => { const s = document.getElementById('text3d-gap'); s.value = g; s.dispatchEvent(new Event('input')); }, gap);
  if ((await pg.isChecked('#text3d-weld')) !== weld) await pg.click('#text3d-weld');
  await pg.waitForTimeout(150);
  await pg.click('#text3d-ok');
  await pg.waitForFunction(() => objects.some(o => o.userData.textEdit), null, { timeout: 30000 });
  await pg.waitForTimeout(150);
  return mess();
}
const mess = () => pg.evaluate(() => {
  const o = objects.find(o => o.userData.textEdit); o.updateMatrixWorld(true);
  const p = o.geometry.attributes.position, ix = o.geometry.index?.array, n = ix ? ix.length : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let v = 0;
  const kanten = new Map(), key = q => Math.round(q.x*1e4) + ',' + Math.round(q.y*1e4) + ',' + Math.round(q.z*1e4);
  // Zusammenhang über gemeinsame Eckpunkte
  const par = new Map(), find = x => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (let t = 0; t < n; t += 3) {
    a.fromBufferAttribute(p, ix ? ix[t] : t).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, ix ? ix[t+1] : t+1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(p, ix ? ix[t+2] : t+2).applyMatrix4(o.matrixWorld);
    v += a.dot(b.clone().cross(c)) / 6;
    const k = [key(a), key(b), key(c)];
    k.forEach(x => { if (!par.has(x)) par.set(x, x); });
    par.set(find(k[0]), find(k[1])); par.set(find(k[1]), find(k[2]));
    for (let e = 0; e < 3; e++) { const u = k[e], w = k[(e+1)%3]; if (u === w) continue; const kk = u < w ? u + '|' + w : w + '|' + u; kanten.set(kk, (kanten.get(kk) || 0) + 1); }
  }
  let offen = 0; kanten.forEach(z => { if (z !== 2) offen++; });
  const teile = new Set([...par.keys()].map(find)).size;
  const bb = new THREE.Box3().setFromObject(o), s = bb.getSize(new THREE.Vector3());
  return { konturen: o.userData._svgPathData.length, teile, offen, vol: Math.round(Math.abs(v) * 1000),
           breite: +(s.x*10).toFixed(1), hoehe: +(s.z*10).toFixed(1), meta: o.userData.textEdit };
});
const lose  = await text('MM', 0, false);
const eng0  = await text('MM', -25, false);
const eng1  = await text('MM', -25, true);
const weit1 = await text('MM', 0, true);
console.log(JSON.stringify({ lose, eng0, eng1, weit1 }, null, 0).replace(/"meta":\{[^}]*\},?/g, ''));
ok('ohne Abstand: 2 Buchstaben = 2 Teile', lose.teile === 2 && lose.konturen === 2, lose.teile);
ok('Abstand −25 % von 8 mm rückt die Buchstaben 2 mm zusammen, Höhe bleibt', Math.abs(lose.breite - eng0.breite - 2) < 0.15 && Math.abs(eng0.hoehe - lose.hoehe) < 0.05, [lose.breite, eng0.breite, lose.hoehe, eng0.hoehe]);
ok('eng + verschweißt: EIN Umriss, EIN Teil, dicht', eng1.konturen === 1 && eng1.teile === 1 && eng1.offen === 0, eng1);
ok('verschweißt hat weniger Volumen als die überlappenden Einzelteile', eng1.vol < eng0.vol - 2 && eng1.vol > eng0.vol * 0.7, [eng0.vol, eng1.vol]);
ok('verschweißen ohne Berührung ändert nichts (2 Teile, gleiches Volumen)', weit1.teile === 2 && Math.abs(weit1.vol - lose.vol) <= 1 && weit1.offen === 0, [lose.vol, weit1.vol]);
ok('Einstellungen stehen am Text', eng1.meta.weld === true && eng1.meta.gap === -25, eng1.meta);
// Text ändern: Abstand + Verschweißen bleiben, neuer Wortlaut wird wieder ein Teil
await pg.evaluate(() => { const o = objects.find(o => o.userData.textEdit); selectObjs([o]); editTextObj(o); });
// (eng1 ist nicht mehr in der Szene – letzter Text ist weit1; daher hier setzen)
const dlg = await pg.evaluate(() => ({ gap: document.getElementById('text3d-gap').value, weld: document.getElementById('text3d-weld').checked }));
ok('„Text ändern" zeigt die gespeicherten Werte', dlg.gap === '0' && dlg.weld === true, dlg);
await pg.fill('#text3d-input', 'WM');
await pg.evaluate(() => { const s = document.getElementById('text3d-gap'); s.value = -25; s.dispatchEvent(new Event('input')); });
await pg.click('#text3d-ok'); await pg.waitForTimeout(500);
const ge = await mess();
ok('geänderter Text mit engem Abstand ist verschweißt (1 Teil, dicht)', ge.teile === 1 && ge.offen === 0 && ge.meta.str === 'WM' && ge.meta.gap === -25, { teile: ge.teile, offen: ge.offen });
// Bogen-Text: Verschweißen läuft ohne Fehler, Abstand-Regler ist ausgeblendet
const bogen = await text('MMMM', 0, true, 'arc');
ok('Bogen-Text entsteht (dicht)', bogen.offen === 0 && bogen.vol > 0, { teile: bogen.teile, offen: bogen.offen });
ok('keine Seitenfehler', errs.length === 0, errs);
await pg.evaluate(() => { _newCreate(false); addTextShape(); _text3dSetMode('free'); });
await pg.fill('#text3d-input', 'Emma');
await pg.evaluate(() => { const s = document.getElementById('text3d-gap'); s.value = -22; s.dispatchEvent(new Event('input')); });
await pg.waitForTimeout(500);
await pg.screenshot({ path: '/tmp/weld_dialog.png', clip: { x: 500, y: 230, width: 400, height: 460 } });
console.log(fails.length ? 'FEHLER: ' + fails.join(' | ') : 'ALLES OK');
await b.close(); srv.kill();
process.exitCode = fails.length ? 1 : 0;
