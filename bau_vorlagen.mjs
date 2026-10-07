// Drei Vorlagen „Eigenes Funktionsteil“ (Grundkurs 09.10.2026, Folie 27) – in V3D CAD gebaut.
// Je Vorlage: <name>.v3d (Bausteine einzeln, zum Anpassen: Meine Designs → Importieren) und <name>.3mf (fertig).
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';

const URL = process.env.V3D_URL || 'http://localhost:8765/volme3d.html';
const ZIEL = process.env.ZIEL || '/home/v3da/kurs-grundkurs/vorlagen';
fs.mkdirSync(ZIEL, { recursive: true });
const cookie = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('vorlagen','test@lokal'))"], { cwd: '/home/v3da' }).toString().trim();
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addCookies([{ name: 'v3dsess', value: cookie, domain: 'localhost', path: '/' }]);
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const log = (...a) => console.log(...a);
const warte = async (pruef, arg, s = 180) => { for (let i = 0; i < s; i++) { if (await pg.evaluate(pruef, arg)) return true; await pg.waitForTimeout(1000); } return false; };

await pg.goto(URL);
await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
await pg.evaluate(() => {
  hideStarter();
  window._v = {
    // Anlegen: Bohrungen im Bohrungs-Modus (nichts rückt zur Seite); Lage wird erst am Ende gesetzt
    form(typ, w, d, h, opt) { opt = opt || {}; setShapeMode(opt.loch ? 'hole' : 'solid'); addShape(typ); const o = objects[objects.length - 1]; selectObjs([o]);
      numChanged('sw', w); numChanged('sd', d); numChanged('sh', h); setShapeMode('solid'); if (opt.name) o.userData.name = opt.name; if (opt.farbe) setColor(opt.farbe); return o; },
    setMin(o, x, y, z) { selectObjs([o]); o.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(o); o.position.x += x / 10 - bx.min.x; o.position.y += y / 10 - bx.min.y; o.position.z += z / 10 - bx.min.z; o.updateMatrixWorld(true); },
    setMitte(o, x, y, z) { selectObjs([o]); o.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(o); const c = bx.getCenter(new THREE.Vector3()); o.position.x += x / 10 - c.x; o.position.z += z / 10 - c.z; o.position.y += y / 10 - bx.min.y; o.updateMatrixWorld(true); },
    dreh(o, ax, grad) { selectObjs([o]); updateTFInputs(); document.getElementById(ax).value = grad; applyTF(); },
    bb(o) { o.updateMatrixWorld(true); const x = new THREE.Box3().setFromObject(o); return [x.min.x, x.min.y, x.min.z, x.max.x, x.max.y, x.max.z].map(v => +(v * 10).toFixed(2)); },
  };
});

async function fertigstellen(name, tpuNamen, danach) {
  // .v3d mit den einzelnen Bausteinen
  const json = await pg.evaluate(() => _sceneJson());
  fs.writeFileSync(`${ZIEL}/${name}.v3d`, json);
  // Fertig machen: alle festen Teile (ohne TPU) vereinen, dann Bohrungen abziehen
  await pg.evaluate(async (tpu) => { const fest = objects.filter(o => !o.userData.isHole && !tpu.includes(o.userData.name)); if (fest.length > 1) { selectObjs(fest); await unionSelected(); } }, tpuNamen);
  await warte(tpu => objects.filter(o => !o.userData.isHole && !tpu.includes(o.userData.name)).length === 1, tpuNamen);
  const loecher = await pg.evaluate(() => objects.filter(o => o.userData.isHole).length);
  if (loecher) {
    await pg.evaluate((tpu) => { const teil = objects.find(o => !o.userData.isHole && !tpu.includes(o.userData.name)); selectObjs([teil, ...objects.filter(o => o.userData.isHole)]); subtractHoles(); }, tpuNamen);
    await warte(() => !objects.some(o => o.userData.isHole));
  }
  if (danach) await pg.evaluate(danach);
  const check = await pg.evaluate(async () => { _printCheckOpen(); await new Promise(r => setTimeout(r, 1800)); const t = document.getElementById('printcheck-modal').innerText.replace(/\s+/g, ' '); _printCheckClose(); return t; });
  const exp = await pg.evaluate(async () => { const r = _build3mfBlob(objects); const buf = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { b64: btoa(s), teile: r.parts, farben: r.colors, masse: objects.map(o => ({ n: o.userData.name, bb: _v.bb(o) })) }; });
  fs.writeFileSync(`${ZIEL}/${name}.3mf`, Buffer.from(exp.b64, 'base64'));
  if (process.env.BILDER) { await pg.evaluate(() => { selectObjs([]); try { setView('iso'); } catch (e) {} }); await pg.mouse.click(700, 900); await pg.waitForTimeout(1200); await pg.screenshot({ path: `${ZIEL}/${name}.png`, clip: { x: 48, y: 205, width: 1130, height: 745 } }); }
  const kurz = check.match(/(Sieht gut aus[^.]*|Druckbar, aber[^.]*)/); const dicht = /✅ Wasserdicht/.test(check); const ueber = (check.match(/(Kaum Überhänge[^.]*|Überhänge \d+%[^.]*)/) || [''])[0];
  log('   Dünnstellen:', JSON.stringify(await pg.evaluate(() => (_pcThinSpots || []).slice(0, 8).map(t => { const p = t.p || t.pos || t.point || t; return [p.x, p.y, p.z].map(v => +(v * 10).toFixed(1)).concat([+(t.d || t.mm || t.dist || 0).toFixed ? +(+(t.d || t.mm || t.dist || 0)).toFixed(2) : '']); }))));
  log('   Hinweise:', (check.match(/⚠️[^✅]*/g) || []).join(' | ').slice(0, 300));
  log(`${name}: ${kurz && kurz[0]} | wasserdicht=${dicht} | ${ueber} | 3MF ${exp.teile} Teile/${exp.farben} Farben | ${JSON.stringify(exp.masse)}`);
}

// ───────────── 1) Kabelclip für die Tischkante (liegend gedruckt: Schichten laufen entlang der Klammer) ─────────────
// Maße: Tischdicke 20 mm (MESSEN!), Klemmung −0,3 mm → Spalt 19,7; Kabel bis Ø 6 → Öse Ø 7; Clip 12 mm breit (= Druckhöhe)
await pg.evaluate(() => {
  _newCreate(false);
  const T = 20, spalt = T - 0.3, wand = 4, arm = 25, breite = 12;
  const ruecken = _v.form('box', wand, spalt + 2 * wand, breite, { name: 'Rücken (Länge = Tischdicke − 0,3 + 8)' });
  const armO = _v.form('box', arm, wand, breite, { name: 'Arm oben' });
  const armU = _v.form('box', arm, wand, breite, { name: 'Arm unten' });
  const oese = _v.form('cylinder', 12, 12, breite, { name: 'Kabelöse außen Ø 12' });
  const loch = _v.form('cylinder', 7, 7, breite + 2, { loch: true, name: 'Kabel-Bohrung Ø 7 (= Kabel + 1)' });
  const schlitz = _v.form('box', 9, 4, breite + 2, { loch: true, name: 'Einführ-Schlitz 4 mm' });
  const steg = _v.form('box', 6.5, 8, breite, { name: 'Steg Öse–Rücken' });
  _v.setMin(ruecken, 0, 0, 0);
  _v.setMin(armO, 0, 0, 0); _v.setMin(armU, 0, 0, spalt + wand);
  const zm = (spalt + 2 * wand) / 2;
  _v.setMitte(oese, -6, 0, zm); _v.setMitte(loch, -6, -1, zm); _v.setMitte(schlitz, -10.5, -1, zm);
  _v.setMin(steg, -6, 0, zm - 4);
});
await fertigstellen('Vorlage1_Kabelclip_Tischkante', []);

// ───────────── 2) Wandhaken (auf der Seite liegend gedruckt → Haken hält quer zu den Schichten nicht, sondern entlang) ─────────────
// Profil liegt flach: Wandplatte 5 × 70, Arm 30 nach vorn, Spitze 15 hoch; Breite 20 = Druckhöhe; 2 Schraublöcher Ø 4,5 waagerecht
await pg.evaluate(() => {
  _newCreate(false);
  const breite = 20;
  const platte = _v.form('box', 5, 70, breite, { name: 'Wandplatte 70 lang, 5 dick' });
  const arm = _v.form('box', 30, 6, breite, { name: 'Arm (Ausladung 30)' });
  const spitze = _v.form('box', 6, 15, breite, { name: 'Hakenspitze (Höhe 15)' });
  const s1 = _v.form('cylinder', 4.5, 4.5, 12, { loch: true, name: 'Schraubloch Ø 4,5' });
  const s2 = _v.form('cylinder', 4.5, 4.5, 12, { loch: true, name: 'Schraubloch Ø 4,5' });
  _v.dreh(s1, 'rz', 90); _v.dreh(s2, 'rz', 90);     // Bohrungen quer durch die Wandplatte
  _v.setMin(platte, 0, 0, 0); _v.setMin(arm, 0, 0, 0); _v.setMin(spitze, 30 - 6, 0, 0);
  _v.setMitte(s1, 2.5, breite / 2 - 2.25, 55); _v.setMitte(s2, 2.5, breite / 2 - 2.25, 25);
});
await fertigstellen('Vorlage2_Wandhaken', []);

// ───────────── 3) Stuhlbein-Kappe mit TPU-Gleiter (Multimaterial) ─────────────
// Bein rund Ø 25 (MESSEN!), Steckpassung +0,2 → Bohrung Ø 25,2; Wand 2,5; Boden 3; Kappe 12 hoch; TPU-Scheibe Ø 25 × 1,2 bündig unten
await pg.evaluate(() => {
  _newCreate(false);
  const D = 25, innen = D + 0.2, aussen = innen + 5, hoehe = 15;
  const koerper = _v.form('cylinder', aussen, aussen, hoehe, { name: 'Kappe außen (Ø = Bohrung + 5)' });
  const bohr = _v.form('cylinder', innen, innen, hoehe, { loch: true, name: 'Bohrung Ø = Beinmaß + 0,2' });
  const tasche = _v.form('cylinder', D, D, 1.2, { loch: true, name: 'Gleiter-Tasche unten' });
  _v.setMitte(koerper, 0, 0, 0); _v.setMitte(bohr, 0, 3, 0); _v.setMitte(tasche, 0, 0, 0);
});
// Gleiter erst nach dem Abziehen der Tasche als eigenes Teil (TPU) einsetzen → in der .v3d steht er schon drin
await pg.evaluate(() => { const g = _v.form('cylinder', 25, 25, 1.2, { loch: true, name: 'Gleiter (TPU)' }); selectObjs([g]); setObjMode('solid'); setColor('#222222'); g.userData.name = 'Gleiter (TPU)'; _v.setMitte(g, 45, 0, 0); });   // in der Vorlage daneben – erst nach dem Abziehen in die Tasche schieben
await fertigstellen('Vorlage3_Stuhlbein-Kappe_TPU', ['Gleiter (TPU)'], () => { const g = objects.find(o => o.userData.name === 'Gleiter (TPU)'); _v.setMitte(g, 0, 0, 0); });

log('Seitenfehler:', errs);
await b.close();
