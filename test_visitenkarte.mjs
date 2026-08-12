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

  // --- 5b) Ständer + Kartenfach (Stufe 2)
  // Beide sind aus Einzelflächen gebaut, nicht indiziert → Kantenbilanz über
  // die POSITION hashen, nicht über Indizes.
  const dichtPos = (geo) => {
    const p = geo.attributes.position.array, ix = geo.index ? geo.index.array : null;
    const n = ix ? ix.length : p.length / 3;
    const key = i => { const o = (ix ? ix[i] : i) * 3;
      return Math.round(p[o] * 1e4) + '|' + Math.round(p[o + 1] * 1e4) + '|' + Math.round(p[o + 2] * 1e4); };
    const m = new Map();
    for (let i = 0; i < n; i += 3) {
      const a = key(i), b = key(i + 1), c = key(i + 2);
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        if (u === v) continue;                       // entartet
        const k = u + '>' + v; m.set(k, (m.get(k) || 0) + 1);
      }
    }
    let rest = 0;
    for (const [k, v] of m) {
      const [u, w] = k.split('>');
      rest += Math.abs(v - (m.get(w + '>' + u) || 0));
    }
    return rest;
  };

  _vkPreset('aufsteller');
  out.preset = { w: _vk.p.w, h: _vk.p.h, base: _vk.p.base, tsize: _vk.p.tsize,
                 stand: _vk.p.stand, fuss: +_vkFuss().toFixed(2) };

  // Fußleiste: der untere Streifen des Schilds muss glatt bleiben
  {
    const gs = _buildVkGeo(false);
    const p = gs.attributes.position.array;
    const zFuss = (_vk.p.h / 2 - _vkFuss() + 1) / 10;
    let maxY = 0;
    for (let i = 0; i < p.length; i += 3) if (p[i + 2] > zFuss && p[i + 1] > maxY) maxY = p[i + 1];
    out.fussGlatt = { maxDicke: +(maxY * 10).toFixed(3), soll: _vk.p.base };
    gs.dispose();
  }

  const teile = _vkBaseParts();
  out.teile = teile.map(t => t.name);
  const bb = (g) => { g.computeBoundingBox(); const b = g.boundingBox;
    return { x: +((b.max.x - b.min.x) * 10).toFixed(2), y: +((b.max.y - b.min.y) * 10).toFixed(2),
             z: +((b.max.z - b.min.z) * 10).toFixed(2), z0: +(b.min.z * 10).toFixed(2),
             y0: +(b.min.y * 10).toFixed(3) }; };

  const fach = teile.find(t => t.name === 'Kartenfach');
  const stnd = teile.find(t => t.name === 'Ständer');
  const Pp = _vk.p, wall = Pp.wall;
  out.fach = { ...bb(fach.geo), dicht: dichtPos(fach.geo), vol: +(_geoSignedVolume(fach.geo) * 1000).toFixed(1),
    // Außenquader minus Tasche, in mm³
    soll: +((Pp.fachW + 2 * wall) * (Pp.fachD + 2 * wall) * (Pp.fachT + 1.6)
          - Pp.fachW * Pp.fachD * (Pp.fachT + 1.6 - 1.6)).toFixed(1) };
  const sdEff = Math.max(3, Math.min(Pp.slotD,
    (Pp.standH - 1.5 - ((Pp.base + Pp.spiel) / 2) * Math.sin(Pp.tilt * Math.PI / 180)) / Math.cos(Pp.tilt * Math.PI / 180)));
  out.stand = { ...bb(stnd.geo), dicht: dichtPos(stnd.geo), vol: +(_geoSignedVolume(stnd.geo) * 1000).toFixed(1),
    // Klotz minus Nut; die Nutfläche ist exakt Breite × Tiefe (die Schrägen heben sich auf)
    soll: +(Pp.w * (Pp.standD * Pp.standH - (Pp.base + Pp.spiel) * sdEff)).toFixed(1) };
  out.reihenfolge = { schildHinten: +(Pp.h / 2).toFixed(1), fachVorn: out.fach.z0,
                      standVorn: out.stand.z0, fachHinten: +(out.fach.z0 + out.fach.z).toFixed(2) };
  for (const t of teile) t.geo.dispose();

  // Vorschau mit Ständer darf nicht platzen
  const gpv = _vkPreviewGeo();
  out.vorschauAufsteller = { dreiecke: Math.round(gpv.attributes.position.count / 3) };
  gpv.dispose();

  // Erstellen im Aufsteller-Modus → Gruppe mit Schild + Fach + Ständer
  {
    const n0 = objects.length;
    _vkCreate();
    await new Promise(r => setTimeout(r, 700));
    const o = objects[objects.length - 1];
    out.aufstellerErstellt = { added: objects.length - n0, gruppe: !!(o && o.userData && o.userData.isGroup),
      kinder: o && o.children ? o.children.map(c => c.userData.name) : [] };
  }
  _vkPreset('karte');

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
  // Stufe 2: Aufsteller
  ['Preset Aufsteller: größer, dicker, Name 16 mm', res.preset.w === 100 && res.preset.base === 2.5 && res.preset.tsize === 16 && res.preset.stand],
  ['Fußleiste bleibt glatt (kein Relief in der Nut)', nah(res.fussGlatt.maxDicke, res.fussGlatt.soll, 0.02)],
  ['Ständer und Kartenfach erzeugt', res.teile.join(',') === 'Kartenfach,Ständer'],
  ['Kartenfach geschlossen', res.fach.dicht === 0],
  ['Kartenfach-Volumen = Quader minus Tasche', nah(res.fach.vol, res.fach.soll, 1)],
  ['Kartenfach-Außenmaß = Innen + 2× Wand', nah(res.fach.x, 87 + 4, 0.05) && nah(res.fach.z, 57 + 4, 0.05)],
  ['Ständer geschlossen', res.stand.dicht === 0],
  ['Nut hat exakt Schilddicke + Spiel', nah(res.stand.vol, res.stand.soll, 1)],
  ['Ständer-Außenmaß 100×22×16', nah(res.stand.x, 100, 0.05) && nah(res.stand.z, 22, 0.05) && nah(res.stand.y, 16, 0.05)],
  ['alle Teile stehen auf der Druckplatte', nah(res.fach.y0, 0, 0.01) && nah(res.stand.y0, 0, 0.01)],
  ['Teile überlappen nicht: Schild → Fach → Ständer', res.reihenfolge.fachVorn > res.reihenfolge.schildHinten && nah(res.reihenfolge.standVorn, res.reihenfolge.fachHinten, 0.05)],
  ['Aufsteller wird als Gruppe erstellt', res.aufstellerErstellt.added === 1 && res.aufstellerErstellt.gruppe && res.aufstellerErstellt.kinder.join(',') === 'Schild,Kartenfach,Ständer'],
  ['Erstellen legt 1 Objekt an', res.erstellt.added === 1 && res.erstellt.typ === 'vcard'],
  ['Dialog auf/zu', res.dialogOffen && res.dialogZu],
];
let ok = true;
for (const [t, b] of pruef) { console.log((b ? '  ✓ ' : '  ✗ ') + t); if (!b) ok = false; }
if (errs.length) ok = false;
console.log(ok ? '\n✅ 3D-Visitenkarte in Ordnung' : '\n❌ 3D-Visitenkarte: Prüfung fehlgeschlagen');
await browser.close(); srv.kill();
process.exit(ok ? 0 : 1);
