// Händigkeit ALLER Gewinde der App — gemessen, nicht aus der Formel abgelesen.
//
// Bis v1.18.11 kam jedes Gewinde als LINKSgewinde heraus (DIN-Schrauben, Muttern,
// Gewinde-Werkzeug, Gardena-G-Gewinde, Schraubdose, Pilz), und die Option
// „Linksgewinde" lieferte ein Rechtsgewinde. Die Teile passten untereinander,
// aber nie auf eine gekaufte Mutter oder einen Wasserhahn. Aufgefallen ist es
// erst Ralf am gedruckten Pilz („sieht wie Linksgewinde aus").
//
// Messung: Netz wie beim STL-Export nach mm/Z-up drehen (rotateX +90°, Drehung
// ändert die Händigkeit nicht), die Gewindespitzen (bzw. beim Innengewinde den
// Rillengrund) einsammeln und prüfen, ob 2π·z/P − φ (rechts) oder 2π·z/P + φ
// (links) über alle Punkte konstant ist. Eine bekannte Rechts-Helix eicht das
// Verfahren — ohne diese Kontrolle wäre der Test selbst nicht belegt.
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage();
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });

const res = await pg.evaluate(() => {
  // geo: Y-up in App-Units. Pmm: Steigung. yMin/yMax: Gewindezone (Units).
  // rMin/rMax: Radiusfenster (Units), damit Kopf/Sechskant/Außenwand nicht mitzählen.
  const hand = (geo, Pmm, yMin, yMax, rMin = 0, rMax = 1e9) => {
    const g = geo.clone(); g.scale(10, 10, 10); g.rotateX(Math.PI / 2);
    const p = g.attributes.position, pts = [];
    let top = 0;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i); if (z < yMin * 10 || z > yMax * 10) continue;
      const r = Math.hypot(p.getX(i), p.getY(i)); if (r < rMin * 10 || r > rMax * 10) continue;
      pts.push([r, Math.atan2(p.getY(i), p.getX(i)), z]); top = Math.max(top, r);
    }
    const crest = pts.filter(q => q[0] > top - 0.03);
    const conc = s => { let cx = 0, cy = 0;
      for (const [, f, z] of crest) { const psi = 2 * Math.PI * z / Pmm - s * f; cx += Math.cos(psi); cy += Math.sin(psi); }
      return crest.length ? Math.hypot(cx, cy) / crest.length : 0; };
    const R = conc(+1), L = conc(-1);
    g.dispose();
    return { n: crest.length, rechts: +R.toFixed(3), links: +L.toFixed(3),
             ist: Math.max(R, L) < 0.3 ? 'unklar' : (R > L ? 'rechts' : 'links') };
  };
  const out = [];
  const add = (name, soll, m) => out.push({ name, soll, ...m });

  // Eichung: bekannte Rechts-Helix in Z-up, für die Messung nach Y-up zurückgedreht
  { const v = []; for (let i = 0; i < 3000; i++) { const t = i / 100; v.push(Math.cos(t) * 0.5, Math.sin(t) * 0.5, t * 0.2 / (2 * Math.PI)); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.rotateX(-Math.PI / 2);
    add('Eichung: Rechts-Helix', 'rechts', hand(g, 2, -2, 2)); }

  // Gewinde-Werkzeug (Grundkörper „Gewinde") — rechts und mit Option links
  for (const lh of [false, true]) {
    const g = _buildThreadGeo(12, 1.75, 5, 48, lh);
    add('Gewinde-Werkzeug' + (lh ? ' (Linksgewinde)' : ''), lh ? 'links' : 'rechts', hand(g, 1.75, -0.3, 0.3));
  }
  // Gewindestab und Mutter aus dem Schrauben-Generator (M8, P = 1,25)
  for (const lh of [0, 1]) {
    const sp = { ..._screwP, type: 'aussen', size: 'M8', leftHand: lh };
    const P = SCREW_SPECS.M8.pitch;
    const g = _buildScrewGeometry(sp); g.computeBoundingBox(); const bb = g.boundingBox, h = bb.max.y - bb.min.y;
    add('Gewindestab M8' + (lh ? ' (Linksgewinde)' : ''), lh ? 'links' : 'rechts', hand(g, P, bb.min.y + h * 0.25, bb.min.y + h * 0.75));
    const s = SCREW_SPECS.M8, n = _buildNutGeometry(s, 0.4, !!lh); n.computeBoundingBox();
    const nb = n.boundingBox, nh = nb.max.y - nb.min.y;
    add('Mutter M8' + (lh ? ' (Linksgewinde)' : ''), lh ? 'links' : 'rechts',
        hand(n, P, nb.min.y + nh * 0.2, nb.min.y + nh * 0.8, 0, (s.d / 2 + 1) / 10));
  }
  // Gardena: G¾"-Außengewinde (Hahnanschluss) und Innengewinde
  { const th = G_THREAD['G3/4'];
    const a = _gardenaThreadTail(th, 'aussen', 12, 0.3);
    add('Gardena G¾" außen', 'rechts', hand(a.geo, th.pitch, a.h * 0.25, a.h * 0.75, th.major / 20 - 0.3));
    const i = _gardenaThreadTail(th, 'innen', 12, 0.3);
    add('Gardena G¾" innen', 'rechts', hand(i.geo, th.pitch, i.h * 0.25, i.h * 0.75, 0, (th.major / 2 + 1) / 10)); }
  // Schraubdose: Dose (außen) und Deckel (innen, in Drucklage kopfüber — Drehung ändert nichts)
  { const p = { ..._jarP }, d = _jarDims(p), H = p.height / 10, Ht = p.threadH / 10;
    add('Schraubdose Dose', 'rechts', hand(_buildJarBodyGeo(p), p.pitch, H - Ht * 0.75, H - Ht * 0.25, d.rCore - 0.01, d.rThreadOut + 0.01));
    const W = p.wall / 10, lidH = W + Ht + 0.04;
    add('Schraubdose Deckel', 'rechts', hand(_buildJarLidGeo(p), p.pitch, W + Ht * 0.3, lidH - Ht * 0.3, 0, d.rThreadOut + d.clr + 0.01)); }
  // Pilz: Stiel (außen) und Hut (innen)
  { const d = _pilzDims(_pilzP);
    add('Pilz-Stiel', 'rechts', hand(_pilzStemGeo(_pilzP, 180), _pilzP.pitch, d.SH + d.P * 0.6, d.SH + d.Ht - d.P * 0.6, d.rCore - 0.01, d.rThreadOut + 0.01));
    add('Pilz-Hut', 'rechts', hand(_pilzCapGeo(_pilzP, 180), _pilzP.pitch, d.yb + d.P * 0.7, d.holeTop - d.P * 0.7, 0, d.rThreadOut + d.clr + 0.01)); }
  // Pilzlampe: Fuß (außen) und Schirm-Kragen (innen), glatt damit das Relief nicht mitzählt
  { const bak = { ..._plpP }; Object.assign(_plpP, { motif: 'glatt' });
    const d = _plpDims(_plpP);
    add('Pilzlampe-Fuß', 'rechts', hand(_plpStemGeo(_plpP, 'normal'), _plpP.pitch, d.SH + d.P * 0.6, d.yTop - d.P * 0.6, d.rCore - 0.01, d.rThreadOut + 0.01));
    add('Pilzlampe-Schirm', 'rechts', hand(_plpShadeGeo(_plpP, 'normal'), _plpP.pitch, d.P * 0.7, d.fem.holeTop - d.P * 0.7, 0, d.rThreadOut + d.clr + 0.01));
    Object.assign(_plpP, bak); }
  // Schneiden: Doppelgewindebolzen (die Bohrung nutzt dieselbe _buildThreadGeo)
  { const spec = SCREW_SPECS.M8;
    const bolt = _cutThreadBoltGeo(spec, 20, false); bolt.computeBoundingBox(); const bb = bolt.boundingBox, h = bb.max.y - bb.min.y;
    add('Schneiden: Gewindebolzen M8', 'rechts', hand(bolt, spec.pitch, bb.min.y + h * 0.3, bb.min.y + h * 0.7, 0, 0.6)); }
  return out;
});

for (const r of res) ok(`${r.name}: ${r.soll}gängig`, r.ist === r.soll, r);
ok('Keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors);
await b.close();
if (fails.length) { console.log(`\n${fails.length} FEHLER: ${fails.join(', ')}`); process.exit(1); }
console.log('\nAlles grün.');
