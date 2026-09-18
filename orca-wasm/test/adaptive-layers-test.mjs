// Rechenkern „Adaptive Schichthöhe automatisch" gegen synthetische Körper prüfen.
// Kernfrage: reproduziert Orcas generate_object_layers aus dem Profil EXAKT
// unsere Schichtfolge? (Nachbau von Slicing.cpp, Stand OrcaSlicer 2.x)
import { computeLayerPlan, REASON_NAMES } from '../web/adaptive-layers.js';

function box(x0, y0, z0, x1, y1, z1, out) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  for (const t of f) for (const i of t) out.push(...v[i]);
}
function lathe(prof /* [[r,z],…] unten→oben */, seg, out) {
  for (let i = 0; i + 1 < prof.length; i++) for (let s = 0; s < seg; s++) {
    const a0 = s / seg * 2 * Math.PI, a1 = (s + 1) / seg * 2 * Math.PI;
    const [r0, z0] = prof[i], [r1, z1] = prof[i + 1];
    const p = (r, z, a) => [r * Math.cos(a), r * Math.sin(a), z];
    const A = p(r0, z0, a0), B = p(r0, z0, a1), C = p(r1, z1, a1), D = p(r1, z1, a0);
    out.push(...A, ...B, ...C, ...A, ...C, ...D);
  }
}
// Nachbau Orca generate_object_layers (first_object_layer_height_fixed)
function orcaLayers(profile, hFirst, hMin, H) {
  const out = [0, hFirst]; let print_z = hFirst, idx = 0;
  let slice_z = print_z + 0.5 * hMin;
  while (slice_z < H) {
    let height = hMin;
    let next = idx + 2;
    for (;;) { if (next >= profile.length || slice_z < profile[next]) break; idx = next; next += 2; }
    const z1 = profile[idx], h1 = profile[idx + 1]; height = h1;
    if (next < profile.length) { const t = (slice_z - z1) / (profile[next] - z1); height = (1 - t) * h1 + t * profile[next + 1]; }
    slice_z = print_z + 0.5 * height;
    if (slice_z >= H) break;
    out.push(print_z); print_z += height; slice_z = print_z + 0.5 * hMin; out.push(print_z);
  }
  return out;
}

const opts = { hBase: 0.2, hFirst: 0.2, hMin: 0.08, hMax: 0.28, nozzle: 0.4, quality: 0.5 };
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

function check(name, pos, expect) {
  const t0 = performance.now();
  const p = computeLayerPlan(new Float32Array(pos), null, opts);
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`\n${name}: H=${p.height.toFixed(3)} → ${p.nLayers} Schichten (fest 0,2: ${p.nUniform}), ${ms} ms, Einrasten bei [${p.snaps.join(', ')}]`);
  const seg = []; for (const L of p.layers) { const s = seg[seg.length - 1]; const k = `${REASON_NAMES[L.r]} ${L.h.toFixed(3)}`;
    if (s && s.k === k) { s.n++; s.z1 = L.z0 + L.h; } else seg.push({ k, n: 1, z0: L.z0, z1: L.z0 + L.h }); }
  console.log('   ' + seg.map(s => `${s.z0.toFixed(2)}–${s.z1.toFixed(2)}: ${s.n}× ${s.k}`).join('\n   '));
  const pr = p.profile;
  ok(pr.length % 2 === 0 && pr[0] === 0 && pr[1] === opts.hFirst && Math.abs(pr[pr.length - 2] - p.height) < 1e-9, 'Profil formal gültig (gerade Länge, h0=Erstschicht, Ende=Höhe)');
  ok(p.layers.every(L => L.h >= opts.hMin - 1e-9 && L.h <= opts.hMax + 1e-9), 'alle Höhen in [min,max]');
  const sum = p.layers.reduce((s, L) => s + L.h, 0);
  ok(Math.abs(sum - p.height) < 1e-6, `Summe der Schichten = Höhe (${sum.toFixed(6)})`);
  const o = orcaLayers(pr, opts.hFirst, opts.hMin, p.height);
  const tops = []; for (let i = 1; i < o.length; i += 2) tops.push(o[i]);
  const mine = p.layers.map(L => L.z0 + L.h);
  const maxd = Math.max(...mine.map((z, i) => Math.abs(z - (tops[i] ?? -1))));
  ok(tops.length === mine.length && maxd < 1e-6, `Orca reproduziert die Folge exakt (${tops.length}/${mine.length}, max Δ ${maxd.toExponential(1)})`);
  expect && expect(p);
}

let pos = []; box(0, 0, 0, 20, 20, 20, pos);
check('Würfel 20 mm', pos, p => ok(p.nLayers < p.nUniform, 'senkrechte Wände → weniger Schichten als fest'));

pos = []; box(0, 0, 0, 40, 40, 3, pos); box(5, 5, 3, 30, 10, 3.8, pos); box(5, 20, 3, 12, 30, 3.6, pos);
check('Platte 3 mm + Schrift 0,6/0,8 mm', pos, p => {
  ok(p.snaps.includes(3) && p.snaps.includes(3.6), 'Schichtgrenzen exakt auf 3,0 und 3,6 mm');
  ok(p.layers.filter(L => L.z0 >= 3 - 1e-9).every(L => L.h < 0.2), 'Schriftbereich feiner als 0,2');
});

pos = []; const sph = []; for (let i = 0; i <= 40; i++) { const a = -Math.PI / 2 + i / 40 * Math.PI; sph.push([10 * Math.cos(a) + 1e-9, 10 + 10 * Math.sin(a)]); }
lathe(sph, 64, pos);
check('Kugel Ø20', pos, p => {
  const top = p.layers.filter(L => L.z0 > 18.5), mid = p.layers.filter(L => L.z0 > 9 && L.z0 < 11);
  ok(Math.max(...top.map(L => L.h)) < Math.min(...mid.map(L => L.h)), 'Kuppe feiner als Äquator');
});

pos = []; lathe([[0.001, 0], [12, 15], [12, 16]], 64, pos); box(-13, -13, 16, 13, 13, 17, pos);
check('Trichter (39°-Überhang)', pos, p => ok(p.layers.some(L => REASON_NAMES[L.r] === 'Überhang'), 'Überhang erkannt'));

console.log(fails ? `\n❌ ${fails} Prüfung(en) fehlgeschlagen` : '\n✅ alle Prüfungen bestanden');
process.exit(fails ? 1 : 0);
