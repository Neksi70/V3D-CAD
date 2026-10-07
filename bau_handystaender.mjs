// Handyständer mit TPU-Füßen für Station 2 (Grundkurs 09.10.2026, Snapmaker U1, Multimaterial).
// Wird in V3D CAD selbst konstruiert (ausgelieferte App, Port 8765) und als zweifarbige 3MF gespeichert:
// Ständer = Farbe/Filament 1 (PLA), Füße = Farbe/Filament 2 (TPU). Alles ohne Stützen druckbar.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';

const URL = process.env.V3D_URL || 'http://localhost:8765/volme3d.html';
const ZIEL = process.env.ZIEL || '/home/v3da/kurs-grundkurs';
fs.mkdirSync(ZIEL, { recursive: true });
const cookie = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('handystaender','test@lokal'))"], { cwd: '/home/v3da' }).toString().trim();
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addCookies([{ name: 'v3dsess', value: cookie, domain: 'localhost', path: '/' }]);
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const log = (...a) => console.log(...a);
const warte = async (pruef, arg, s = 180) => { for (let i = 0; i < s; i++) { if (await pg.evaluate(pruef, arg)) return true; await pg.waitForTimeout(1000); } return false; };

try {
  await pg.goto(URL);
  await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => {
    hideStarter(); _newCreate(false);
    window._h = {
      form(typ, w, d, h, loch) { setShapeMode(loch ? 'hole' : 'solid'); addShape(typ); const o = objects[objects.length - 1]; selectObjs([o]); numChanged('sw', w); numChanged('sd', d); numChanged('sh', h); setShapeMode('solid'); return o; },
      bb(o) { o.updateMatrixWorld(true); const x = new THREE.Box3().setFromObject(o); return [x.min.x, x.min.y, x.min.z, x.max.x, x.max.y, x.max.z].map(v => +(v * 10).toFixed(2)); },
      setMin(o, x, y, z) { selectObjs([o]); o.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(o); o.position.x += x / 10 - bx.min.x; o.position.y += y / 10 - bx.min.y; o.position.z += z / 10 - bx.min.z; o.updateMatrixWorld(true); },
      drehX(o, grad) { selectObjs([o]); updateTFInputs(); document.getElementById('rx').value = grad; applyTF(); },
      farbe(o, c) { selectObjs([o]); setColor(c); },
      name(o, n) { o.userData.name = n; },
    };
  });

  // ---- Ständer (PLA): Platte + Lehne + vordere Kante, Kabelschlitz, Fußtaschen
  const teile = await pg.evaluate(() => {
    const platte = _h.form('box', 80, 90, 5);
    const lehne = _h.form('box', 80, 6, 100);
    const kante = _h.form('box', 80, 8, 15);
    // Lehne um 20° nach hinten kippen (Oberkante wandert nach hinten = +Z, „Vorne“ ist −Z)
    _h.drehX(lehne, 20); let lb = _h.bb(lehne);
    if ((lb[5] + lb[2]) / 2 < 0 && false) {}   // Richtung wird unten geprüft
    _h.setMin(platte, -40, 0, -45);
    _h.setMin(kante, -40, 0, -45);              // vorne: z −45 … −37
    lb = _h.bb(lehne);
    _h.setMin(lehne, -40, 0, -22 - 0);          // Unterkante der Lehne beginnt 15 mm hinter der Kante (Handy + Hülle)
    return { platte: _h.bb(platte), lehne: _h.bb(lehne), kante: _h.bb(kante), lehneRot: lehne.rotation.x };
  });
  log('Teile:', JSON.stringify(teile));
  // Prüfen, ob die Lehne nach hinten kippt: oberster Punkt muss weiter hinten (größeres Z) liegen als der unterste
  const kipp = await pg.evaluate(() => { const l = objects[1]; l.updateMatrixWorld(true); const p = l.geometry.attributes.position, v = new THREE.Vector3(); let oben = null, unten = null;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(l.matrixWorld); if (!oben || v.y > oben.y) oben = v.clone(); if (!unten || v.y < unten.y) unten = v.clone(); } return { obenZ: +(oben.z * 10).toFixed(1), untenZ: +(unten.z * 10).toFixed(1) }; });
  log('Kipprichtung:', JSON.stringify(kipp));
  if (kipp.obenZ < kipp.untenZ) { await pg.evaluate(() => { const l = objects[1]; _h.drehX(l, -20); _h.setMin(l, -40, 0, -22); }); log('→ Lehne andersherum gekippt'); }

  await pg.evaluate(() => { selectObjs(objects.slice(0, 3)); return unionSelected(); });
  log('Ständer vereint:', await warte(() => objects.length === 1), JSON.stringify(await pg.evaluate(() => _h.bb(objects[0]))));

  // Kabelschlitz in der vorderen Kante (18 mm breit, bis auf die Platte) + 4 Fußtaschen Ø 15 × 1,2 unten
  await pg.evaluate(() => {
    const st = objects[0];
    const schlitz = _h.form('box', 18, 14, 14, true); _h.setMin(schlitz, -9, 5, -47);
    const pos = [[-28, -33], [28, -33], [-28, 33], [28, 33]];
    for (const [x, z] of pos) { const t = _h.form('cylinder', 15, 15, 1.2, true); _h.setMin(t, x - 7.5, 0, z - 7.5); }
    selectObjs(objects.slice()); subtractHoles();
  });
  log('Schlitz + Taschen abgezogen:', await warte(() => objects.length === 1 && !objects[0].userData.isHole));

  // ---- Füße (TPU): exakt die Taschen ausfüllen, eigene Farbe
  const fuesse = await pg.evaluate(() => {
    const st = objects[0]; _h.name(st, 'Ständer (PLA)'); _h.farbe(st, '#f97316');
    const pos = [[-28, -33], [28, -33], [-28, 33], [28, 33]]; const r = [];
    for (const [x, z] of pos) { const f = _h.form('cylinder', 15, 15, 1.2, true); selectObjs([f]); setObjMode('solid'); _h.setMin(f, x - 7.5, 0, z - 7.5); _h.farbe(f, '#222222'); _h.name(f, 'Fuß (TPU)'); r.push(_h.bb(f)); }   // im Bohrungs-Modus anlegen = nichts rückt zur Seite
    return { staender: _h.bb(st), fuesse: r };
  });
  log('Füße:', JSON.stringify(fuesse));

  // ---- Prüfen: Wasserdichtheit, Druck-Check
  const check = await pg.evaluate(async () => { _printCheckOpen(); await new Promise(r => setTimeout(r, 1800)); const t = document.getElementById('printcheck-modal').innerText.replace(/\s+/g, ' '); _printCheckClose(); return t.slice(0, 700); });
  log('Druck-Check:', check);

  // ---- 3MF speichern (Ständer = Filament 1, Füße = Filament 2) + Szene als V3D-Design
  const exp = await pg.evaluate(async () => { const r = _build3mfBlob(objects); const buf = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { b64: btoa(s), teile: r.parts, farben: r.colors, legende: r.legend }; });
  fs.writeFileSync(ZIEL + '/Handystaender_TPU-Fuesse.3mf', Buffer.from(exp.b64, 'base64'));
  log('3MF:', JSON.stringify({ teile: exp.teile, farben: exp.farben, legende: exp.legende }), '→', ZIEL + '/Handystaender_TPU-Fuesse.3mf');

  // Ansicht für ein Vorschaubild: Füße kurz versetzt danebenlegen, echte Mausaktion für sauberes Rendern
  await pg.evaluate((v) => { selectObjs([]); try { setView(v); } catch (e) {} }, process.env.ANSICHT || 'iso');
  await pg.mouse.click(700, 900);
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: ZIEL + '/vorschau.png' });
  log('Seitenfehler:', errs);
} finally { await b.close(); }
