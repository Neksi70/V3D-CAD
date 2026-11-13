// Node-Test Weihnachtsmann-Aufsatz (tools/kamin-adventskalender/kak_santa.js): dicht, Farben überschneiden sich nicht,
// Stopfen passt in den Schacht (0,4 mm Spiel), Saum liegt auf dem Rand auf, Überhänge (flache Unterseiten) klein.
import Module from '/home/v3da/node_modules/manifold-3d/manifold.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { kakSanta } = require('../tools/kamin-adventskalender/kak_santa.js');
const w = await Module(); w.setup(); const M = w.Manifold;
let fail = 0; const ok = (c, t) => { console.log((c ? 'OK   ' : 'FAIL ') + t); if (!c) fail++; };
const S = { in_w: 96, in_d: 96, out_w: 104, out_d: 104, steck: 10 };
const t0 = Date.now(), R = kakSanta(w, S); console.log(`Bauzeit ${Date.now() - t0} ms`, JSON.stringify(R.masse));
const dicht = mf => { const me = mf.getMesh(), T = me.triVerts, E = new Map();
  for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3], kk = a < b ? a + ',' + b : b + ',' + a; E.set(kk, (E.get(kk) || 0) + 1); }
  return mf.status() === 'NoError' && [...E.values()].every(c => c === 2); };
const soll = { 'Weihnachtsmann Hose': 1, 'Weihnachtsmann Pelz': 3, 'Weihnachtsmann Gürtel + Stiefel': 3, 'Weihnachtsmann Schnalle': 1 };
for (const t of R.teile) ok(dicht(t.mf) && t.mf.decompose().length === soll[t.name] && t.mf.volume() > 50, `${t.name}: dicht, ${t.mf.decompose().length} Stück(e) (Soll ${soll[t.name]}), ${(t.mf.volume() / 1000).toFixed(1)} cm³`);
let ov = 0; for (let i = 0; i < R.teile.length; i++) for (let j = i + 1; j < R.teile.length; j++) ov = Math.max(ov, M.intersection(R.teile[i].mf, R.teile[j].mf).volume());
ok(ov < 1e-3, `Farben überschneiden sich nicht (max ${ov.toExponential(1)} mm³)`);
// Einbaulage gegen Turm-Rand (Turm bis z = 0, Schacht offen)
const turm = M.cube([S.out_w, S.out_d, 60], true).translate([0, 0, -30]).subtract(M.cube([S.in_w, S.in_d, 70], true).translate([0, 0, -30]));
const ein = R.teile.map(t => R.lage(t.mf)), alles = M.union(ein);
ok(M.intersection(turm, alles).volume() < 1e-3, 'Einbaulage: kollisionsfrei mit dem Turm');
ok(M.intersection(turm, alles.translate([0, 0, -0.1])).volume() > 1, 'Saum liegt auf dem Rand auf (0,1 mm tiefer stößt an)');
const st = M.intersection(alles, M.cube([S.out_w * 2, S.out_d * 2, 30], true).translate([0, 0, -15])), sb = st.boundingBox();
ok(Math.abs(sb.max[0] - sb.min[0] - (S.in_w - 0.8)) < 0.05 && Math.abs(sb.min[2] + S.steck) < 0.05, `Stopfen ${(sb.max[0] - sb.min[0]).toFixed(1)} × ${(sb.max[1] - sb.min[1]).toFixed(1)} mm (Schacht ${S.in_w} − 2 × 0,4), ${S.steck} mm tief`);
const hb = alles.boundingBox(); ok(Math.abs(hb.max[2] - 1.2 * S.out_w) < 0.12 * S.out_w, `Höhe über dem Rand ${hb.max[2].toFixed(0)} mm (≈ 1,2 × ${S.out_w})`);
// Überhänge in Drucklage: nach unten zeigende Flächen (Normal-z < −0,75, also flacher als ~41°), nicht auf dem Bett, flacher als 45°
let flach = 0, flachMax = { f: 0, z: 0 };
for (const t of R.teile) { const me = t.mf.getMesh(), V = me.vertProperties, np = me.numProp, T = me.triVerts;
  for (let i = 0; i < T.length; i += 3) { const P = [0, 1, 2].map(j => [V[T[i + j] * np], V[T[i + j] * np + 1], V[T[i + j] * np + 2]]);
    const u = P[1].map((v, q) => v - P[0][q]), v = P[2].map((x, q) => x - P[0][q]), n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], L = Math.hypot(...n), A = L / 2;
    const zmin = Math.min(P[0][2], P[1][2], P[2][2]); if (L < 1e-12 || zmin < 0.05) continue;
    // Unterseiten, die auf einer anderen Farbe aufliegen (Grenzflächen), zählen nicht: nur Außenhaut der Gesamtfigur
    if (n[2] / L < -0.7) { flach += A; if (A > flachMax.f) flachMax = { f: A, z: zmin }; } } }
// Unterseiten, die auf einer Oberseite eines anderen Farbteils liegen (Stiefel auf Stulpe), sind gestützt:
// Oberseiten aller Teile in ein 0,5-mm-Raster (je Zelle Liste der z-Werte), dann jede Unterseite abtasten.
const G = 0.5, oberseiten = new Map(), tris = t => { const me = t.mf.getMesh(), V = me.vertProperties, np = me.numProp, T = me.triVerts, out = [];
  for (let i = 0; i < T.length; i += 3) { const P = [0, 1, 2].map(j => [V[T[i + j] * np], V[T[i + j] * np + 1], V[T[i + j] * np + 2]]);
    const u = P[1].map((v, q) => v - P[0][q]), v = P[2].map((x, q) => x - P[0][q]), n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], L = Math.hypot(...n);
    if (L > 1e-12) out.push({ P, nz: n[2] / L, A: L / 2 }); } return out; };
const abtast = (P, f) => { const n = Math.max(2, Math.ceil(Math.max(...[0, 1, 2].map(i => Math.hypot(P[(i + 1) % 3][0] - P[i][0], P[(i + 1) % 3][1] - P[i][1]))) / G));
  for (let a = 0; a <= n; a++) for (let b = 0; a + b <= n; b++) { const c = n - a - b; f([0, 1, 2].map(q => (P[0][q] * a + P[1][q] * b + P[2][q] * c) / n)); } };
const alleTris = R.teile.map(t => tris(t));
alleTris.forEach((ts, ti) => { for (const t of ts) if (t.nz > 0.5) abtast(t.P, p => { const key = Math.round(p[0] / G) + ',' + Math.round(p[1] / G); if (!oberseiten.has(key)) oberseiten.set(key, []); oberseiten.get(key).push([p[2], ti]); }); });
let flachAussen = 0;
alleTris.forEach((ts, ti) => { for (const t of ts) { if (!(t.nz < -0.75) || Math.min(...t.P.map(p => p[2])) < 0.05) continue;
  let n = 0, frei = 0; abtast(t.P, p => { n++; const L = oberseiten.get(Math.round(p[0] / G) + ',' + Math.round(p[1] / G)) || []; if (!L.some(([z, j]) => j !== ti && Math.abs(z - p[2]) < 0.6)) frei++; });
  flachAussen += t.A * frei / Math.max(1, n); } });
const saumRing = (S.out_w - 2) * (S.out_d - 2) - (S.in_w - 0.8) * (S.in_d - 0.8);
console.log(`   flache Unterseiten (steiler als 45° überhängend) außen: ${flachAussen.toFixed(0)} mm², davon Saum über dem Stopfen ≈ ${saumRing.toFixed(0)} mm² (≈ 4 mm Überstand ringsum)`);
ok(flachAussen - saumRing < 400, `Überhänge klein: außer dem 4-mm-Saumrand ≤ ${(flachAussen - saumRing).toFixed(0)} mm²`);
console.log(fail ? `\n${fail} FEHLER` : '\nalles grün'); process.exit(fail ? 1 : 0);
