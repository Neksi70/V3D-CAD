// Node-Test 🎄 Weihnachts-Kern: jedes Teil jeder Kombination wasserdicht + kaum Überhang in Drucklage
// Aufruf: node test_weihnachts_kern.mjs
import { createRequire } from 'node:module';
const W = createRequire(import.meta.url)('./weihnachts-kern.js');
let fehler = 0, faelle = 0, teileN = 0;
const ERLAUBT = { oese: 25, stern: 60, kloeppel: 30, bommel: 40 };          // kleine Bögen/Spitzen, druckbar
// Drucklage: Teil so, wie es gedruckt wird (Stern liegt, Deckel/Bommel stehen auf ihrem Fuß)
function drucklage(t) {
  const m = { positions: new Float32Array(t.mesh.positions), indices: t.mesh.indices };
  if (t.flach) W.drehX(m, 90);
  const b = W.box(m); W.bewege(m, 0, 0, -b[2]);
  return m;
}
const kombis = [];
for (const [objekt, stile] of [['baum', W.BAUMSTILE], ['muetze', W.MUETZENSTILE], ['glocke', W.GLOCKENSTILE]])
  for (const stil of Object.keys(stile)) {
    if (stile[stil].extern) continue;
    for (const variante of ['massiv', 'licht', 'dose', 'anhaenger']) {
      if (variante === 'dose' && objekt !== 'baum') continue;
      for (const muster of ['keine', 'rippen', 'rauten']) for (const inschrift of ['', 'Emma 2026']) {
        if (inschrift && muster !== 'keine') continue;
        kombis.push({ objekt, stil, variante, muster, inschrift });
      }
    }
  }
// Ränder: klein/groß, viele Etagen, Sockelformen
kombis.push({ hoehe: 30, durchmesser: 20 }, { hoehe: 300, durchmesser: 220, etagen: 9 }, { sockelForm: 'eckig', inschrift: 'Familie Isken' },
  { sockelForm: 'sechseck' }, { stil: 'stern', stilTiefe: 0.45, zahl: 24, drehung: 360 }, { objekt: 'muetze', stil: 'zipfel', hoehe: 300, durchmesser: 40 },
  { variante: 'licht', lichtMuster: 'schlitze' }, { variante: 'licht', lichtMuster: 'punkte', objekt: 'glocke' }, ...Object.values(W.VORLAGEN));
for (const p of kombis) {
  faelle++;
  let r; try { r = W.generate(p); } catch (e) { console.log('✗ Ausnahme', JSON.stringify(p), e.message); fehler++; continue; }
  for (const t of r.teile) {
    if (!t.mesh) continue;
    teileN++;
    const c = W.pruefe(t.mesh);
    if (c.offen || c.mehr || !(c.volumen > 0)) { fehler++; console.log('✗ undicht', t.name, JSON.stringify(p), c); continue; }
    const u = W.ueberhang(drucklage(t), 45, 0), grenze = t.ueberhangOk || ERLAUBT[t.rolle] || 15;   // ≤ 15 mm²: Rasterrauschen der Abtastung
    if (u > grenze) { fehler++; console.log('✗ Überhang', t.name, u.toFixed(1), 'mm² >', grenze, JSON.stringify(p)); }
    for (const l of t.loecher || []) { const cl = W.pruefe(l); if (cl.offen || cl.mehr || !(cl.volumen > 0)) { fehler++; console.log('✗ Lochkörper undicht', JSON.stringify(p)); break; } }
  }
}
console.log(`${faelle} Kombinationen, ${teileN} Teile geprüft – ${fehler ? fehler + ' Fehler' : 'alles dicht, kein unerlaubter Überhang'}`);
process.exit(fehler ? 1 : 0);
