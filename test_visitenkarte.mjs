// 3D-Visitenkarte: Foto-Basrelief + Text in EINER Höhenkarte, daraus ein
// wasserdichtes Solid (kein CSG). Prüft: Maße, Dicke, geschlossene Hülle,
// Wicklung, erhaben vs. eingelassen, runde Ecken, Erstellen.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8811;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

const res = await page.evaluate(async () => {
  if (typeof hideStarter === 'function') hideStarter();
  const out = {};

  // Testporträt: heller Kopf auf dunklem Grund + feine Struktur
  const foto = await new Promise((r, j) => {
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 500;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#202020'; cx.fillRect(0, 0, 400, 500);
    const g = cx.createRadialGradient(200, 220, 20, 200, 220, 170);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#303030');
    cx.fillStyle = g; cx.beginPath(); cx.ellipse(200, 230, 130, 165, 0, 0, 7); cx.fill();
    cx.fillStyle = '#101010';
    cx.beginPath(); cx.ellipse(155, 200, 22, 12, 0, 0, 7); cx.fill();
    cx.beginPath(); cx.ellipse(245, 200, 22, 12, 0, 0, 7); cx.fill();
    const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = cv.toDataURL();
  });

  // Hülle geschlossen? Jede ungerichtete Kante muss genau zweimal vorkommen.
  const huelle = (geo) => {
    const idx = geo.index.array, m = new Map();
    for (let i = 0; i < idx.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = idx[i + k], b = idx[i + (k + 1) % 3];
        const key = a < b ? a + '_' + b : b + '_' + a;
        m.set(key, (m.get(key) || 0) + 1);
      }
    }
    let offen = 0, mehrfach = 0;
    for (const v of m.values()) { if (v === 1) offen++; else if (v !== 2) mehrfach++; }
    return { offen, mehrfach };
  };
  const oben = (geo) => {                      // Höhenbereich der Oberseite (mm)
    const p = geo.attributes.position.array;
    let mn = 1e9, mx = -1e9;
    for (let i = 1; i < p.length; i += 3) { if (p[i] > 1e-6) { if (p[i] < mn) mn = p[i]; if (p[i] > mx) mx = p[i]; } }
    return { min: +(mn * 10).toFixed(3), max: +(mx * 10).toFixed(3) };
  };
  const masse = (geo) => {
    geo.computeBoundingBox(); const b = geo.boundingBox;
    return { x: +((b.max.x - b.min.x) * 10).toFixed(2), y: +((b.max.y - b.min.y) * 10).toFixed(3),
             z: +((b.max.z - b.min.z) * 10).toFixed(2) };
  };

  // --- 1) Nur Text, erhaben
  _vk.img = null; _vk.p.photo = 'kein'; _vk.p.tmode = 'raised';
  _vk.p.base = 1.2; _vk.p.traise = 0.4; _vk.p.res = 300;
  let g = _buildVkGeo(false);
  out.nurText = { ...masse(g), ...huelle(g), vol: +_geoSignedVolume(g).toFixed(4), hoehe: oben(g) };
  g.dispose();

  // --- 2) Text eingelassen: Oberseite muss UNTER die Basis gehen
  _vk.p.tmode = 'engraved';
  g = _buildVkGeo(false);
  out.eingelassen = { ...huelle(g), hoehe: oben(g) };
  g.dispose();

  // --- 3) Foto links + erhabener Text
  _vk.img = foto; _vk.p.photo = 'links'; _vk.p.tmode = 'raised'; _vk.p.relief = 0.6;
  g = _buildVkGeo(false);
  out.fotoLinks = { ...masse(g), ...huelle(g), vol: +_geoSignedVolume(g).toFixed(4), hoehe: oben(g),
                    dreiecke: Math.round(g.index.count / 3) };
  g.dispose();

  // --- 3b) Foto über die ganze Karte: Text muss auf dem Relief aufsetzen
  _vk.p.photo = 'voll';
  g = _buildVkGeo(false);
  out.fotoVoll = { ...huelle(g), hoehe: oben(g), vol: +_geoSignedVolume(g).toFixed(4) };
  g.dispose();
  _vk.p.photo = 'links';

  // --- 3c) Nackte Platte: Volumen muss exakt rechnerisch stimmen
  {
    const sichern = { n: _vk.p.name, a: _vk.p.l2, b: _vk.p.l3, c: _vk.p.l4, r: _vk.p.r, i: _vk.img, p: _vk.p.photo };
    _vk.p.name = _vk.p.l2 = _vk.p.l3 = _vk.p.l4 = ''; _vk.p.r = 0; _vk.img = null; _vk.p.photo = 'kein';
    const gp2 = _buildVkGeo(false);
    out.platte = { vol: +_geoSignedVolume(gp2).toFixed(4), soll: +(8.5 * 5.5 * 0.12).toFixed(4) };
    gp2.dispose();
    _vk.p.name = sichern.n; _vk.p.l2 = sichern.a; _vk.p.l3 = sichern.b; _vk.p.l4 = sichern.c;
    _vk.p.r = sichern.r; _vk.img = sichern.i; _vk.p.photo = sichern.p;
  }

  // --- 4) Runde Ecken: Eckpunkt der Karte muss eingezogen sein
  const eckTest = (radius) => {
    _vk.p.r = radius;
    const gg = _buildVkGeo(false);
    const p = gg.attributes.position.array;
    // kleinster Abstand irgendeines Punktes zur Ecke (-w/2,-h/2)
    const x0 = -_vk.p.w / 20, z0 = -_vk.p.h / 20;
    let d = 1e9;
    for (let i = 0; i < p.length; i += 3) {
      const dd = Math.hypot(p[i] - x0, p[i + 2] - z0); if (dd < d) d = dd;
    }
    gg.dispose();
    return +(d * 10).toFixed(2);
  };
  out.eckAbstandR0 = eckTest(0);
  out.eckAbstandR5 = eckTest(5);
  _vk.p.r = 3.2;

  // --- 5) Vorschau muss flott bleiben
  const t = performance.now(); const gp = _buildVkGeo(true);
  out.vorschau = { ms: Math.round(performance.now() - t), dreiecke: Math.round(gp.index.count / 3) };
  gp.dispose();

  // --- 6) Erstellen legt genau ein Objekt an
  const n0 = objects.length;
  _vkCreate();
  await new Promise(r => setTimeout(r, 600));
  const o = objects[objects.length - 1];
  out.erstellt = { added: objects.length - n0, name: o && o.userData ? o.userData.name : '?',
                   typ: o && o.userData ? o.userData.type : '?' };

  // --- 7) Dialog öffnen/schließen ohne Fehler
  _vkOpen(); await new Promise(r => setTimeout(r, 400));
  out.dialogOffen = document.getElementById('vk-modal').classList.contains('show');
  _vkClose();
  out.dialogZu = !document.getElementById('vk-modal').classList.contains('show');
  return out;
});

console.log(JSON.stringify(res, null, 2));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const dicht = o => o.offen === 0 && o.mehrfach === 0;
const nah = (a, b, tol) => Math.abs(a - b) <= tol;
const pruef = [
  ['Kartenmaß 85×55 mm', nah(res.nurText.x, 85, 0.05) && nah(res.nurText.z, 55, 0.05)],
  ['Textkarte geschlossen', dicht(res.nurText)],
  ['Wicklung außen (Volumen > 0)', res.nurText.vol > 0],
  ['erhabener Text steht 0,4 mm über der Basis', nah(res.nurText.hoehe.max, 1.6, 0.05)],
  ['eingelassener Text geht unter die Basis', res.eingelassen.hoehe.min < 1.15 && nah(res.eingelassen.hoehe.min, 0.8, 0.08)],
  ['eingelassene Karte geschlossen', dicht(res.eingelassen)],
  ['Foto-Karte geschlossen', dicht(res.fotoLinks)],
  ['Relief nutzt die volle Tiefe (1,2 + 0,6)', nah(res.fotoLinks.hoehe.max, 1.8, 0.06)],
  ['Foto-Karte Wicklung außen', res.fotoLinks.vol > 0],
  ['ganzflächiges Foto: Text sitzt auf dem Relief (1,2+0,6+0,4)', nah(res.fotoVoll.hoehe.max, 2.2, 0.06)],
  ['ganzflächige Karte geschlossen', dicht(res.fotoVoll)],
  ['Plattenvolumen exakt', nah(res.platte.vol, res.platte.soll, 0.002)],
  ['ohne Radius sitzt ein Punkt in der Ecke', res.eckAbstandR0 < 0.4],
  ['Radius 5 zieht die Ecke ein', res.eckAbstandR5 > 1.2],
  ['Vorschau unter 250 ms', res.vorschau.ms < 250],
  ['Erstellen legt 1 Objekt an', res.erstellt.added === 1 && res.erstellt.typ === 'vcard'],
  ['Dialog auf/zu', res.dialogOffen && res.dialogZu],
];
let ok = true;
for (const [t, b] of pruef) { console.log((b ? '  ✓ ' : '  ✗ ') + t); if (!b) ok = false; }
if (errs.length) ok = false;
console.log(ok ? '\n✅ 3D-Visitenkarte in Ordnung' : '\n❌ 3D-Visitenkarte: Prüfung fehlgeschlagen');
await browser.close(); srv.kill();
process.exit(ok ? 0 : 1);
