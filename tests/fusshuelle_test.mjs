// Fußhülle aus Scan (🧦 _fhl*): schräger Stuhlfuß als verrauschter STL-Import →
// Panel → Hülle. Geprüft: ein Teil, steht auf z = 0 neben dem Scan, Höhe = Höhe + Boden,
// Wand- und Bodendicke an Messpunkten, Innenraum frei, Undo.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8871, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _fhlOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  // Schräger Fuß: Grundfläche 40×25 auf z=0, Deckel 20 mm in x versetzt auf z=35, fein unterteilt + Rauschen
  await p.evaluate(() => {
    const N = 24, B = 40, T = 25, H = 35, S = 20, tris = [];
    const P = (u, v, z) => [u * B + S * z / H, v * T, z];        // u,v ∈ [0,1]
    const quad = (a, b, c, d) => tris.push(...a, ...b, ...c, ...a, ...c, ...d);
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const g = (i, n) => i / n;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const u0 = g(i, N), u1 = g(i + 1, N), v0 = g(j, N), v1 = g(j + 1, N), z0 = H * u0, z1 = H * u1;
      quad(P(u0, v0, 0), P(u0, v1, 0), P(u1, v1, 0), P(u1, v0, 0));                 // Boden (nach unten)
      quad(P(u0, v0, H), P(u1, v0, H), P(u1, v1, H), P(u0, v1, H));                 // Deckel
      quad(P(0, v0, z0), P(0, v0, z1), P(0, v1, z1), P(0, v1, z0));                 // x-Seite
      quad(P(1, v0, z0), P(1, v1, z0), P(1, v1, z1), P(1, v0, z1));                 // x+Seite
      quad(P(v0, 0, z0), P(v1, 0, z0), P(v1, 0, z1), P(v0, 0, z1));                 // y-Seite
      quad(P(v0, 1, z0), P(v0, 1, z1), P(v1, 1, z1), P(v1, 1, z0));                 // y+Seite
    }
    // Rauschen je Ecke (gleiche Ecke → gleicher Versatz, sonst reißt das Netz)
    const off = new Map();
    for (let i = 0; i < tris.length; i += 3) {
      const k = tris[i].toFixed(4) + ',' + tris[i + 1].toFixed(4) + ',' + tris[i + 2].toFixed(4);
      if (!off.has(k)) off.set(k, [rnd() * 0.08, rnd() * 0.08, tris[i + 2] < 1e-6 ? 0 : rnd() * 0.08]);
      const d = off.get(k); tris[i] += d[0]; tris[i + 1] += d[1]; tris[i + 2] += d[2];
    }
    const n = tris.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf); dv.setUint32(80, n, true);
    for (let t = 0; t < n; t++) { const o = 84 + t * 50; for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, tris[t * 9 + k], true); }
    _addImportedStl(buf, 'stuhlfuss-scan.stl', false);
  });
  await p.waitForFunction(() => objects.length === 1);
  const scan = await p.evaluate(() => { const o = objects[0]; selectObjs([o]); const bb = getMeshBox(o); return { x1: bb.max.x * 10 }; });
  ok(await p.evaluate(() => document.getElementById('ctx-fhl').style.display !== 'none'), '🧦 erscheint bei gewähltem Scan');
  await p.evaluate(() => _fhlOpen());
  ok(await p.evaluate(() => document.getElementById('fhl-pop').style.display === 'block' && !!_fhlPrev), 'Panel offen, rote Ebene steht');
  await p.screenshot({ path: SHOTS + '/fhl-panel.png' });
  const lauf = (hoehe, wand, boden, passung, profil = 'glatt') => p.evaluate(async ([hoehe, wand, boden, passung, profil]) => {
    selectObjs([objects[0]]); _fhlOpen(); _fhlStr('profil', profil); _fhlSet('hoehe', hoehe); _fhlSet('wand', wand); _fhlSet('boden', boden); _fhlSet('passung', passung);
    const n0 = objects.length; await _fhlApply();
    const neu = objects[objects.length - 1]; if (objects.length !== n0 + 1) return { fehlt: true };
    const w = await _mfInit(), mf = _mfUnionObjs(w, [neu]), bb = mf.boundingBox();
    // Messstrahlen: senkrecht durch die Mitte des Bodens, waagerecht in halber Höhe durch die x−Wand
    const geo = neu.geometry, pos = geo.attributes.position, m = neu.matrixWorld, v = new THREE.Vector3(), tr = [];
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); tr.push(v.x * 10, -v.z * 10, v.y * 10); }
    const hits = (o, d) => { const r = []; for (let i = 0; i < tr.length; i += 9) {
      const a = tr.slice(i, i + 3), e1 = [tr[i + 3] - a[0], tr[i + 4] - a[1], tr[i + 5] - a[2]], e2 = [tr[i + 6] - a[0], tr[i + 7] - a[1], tr[i + 8] - a[2]];
      const cr = (x, y) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]], dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
      const pv = cr(d, e2), det = dot(e1, pv); if (Math.abs(det) < 1e-12) continue;
      const tv = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = dot(tv, pv) / det; if (u < 0 || u > 1) continue;
      const q = cr(tv, e1), vv = dot(d, q) / det; if (vv < 0 || u + vv > 1) continue; r.push(dot(e2, q) / det); } return r.sort((x, y) => x - y); };
    const bmx = (bb.min[0] + bb.max[0]) / 2, bmy = (bb.min[1] + bb.max[1]) / 2;
    const senk = hits([bmx, bmy, -5], [0, 0, 1]);
    const zh = (bb.max[2] + boden) / 2, waag = hits([bb.min[0] - 5, bmy, zh], [1, 0, 0]);
    const fl = z => { const c = mf.slice(z), a = c.area(); c.delete(); return a; };
    const res = { vol: mf.volume(), teile: mf.decompose().length, bb: [bb.min, bb.max], senk, waag, name: neu.userData.name, a02: fl(0.05), a025: fl(0.25), a10: fl(1.0) };
    mf.delete(); return res;
  }, [hoehe, wand, boden, passung, profil]);
  const r = await lauf(15, 1, 1.6, -0.2);
  ok(!r.fehlt && r.teile === 1, `Hülle: 1 Teil (${r.teile}), ${r.vol.toFixed(0)} mm³`);
  ok(Math.abs(r.bb[0][2]) < 0.01 && Math.abs(r.bb[1][2] - 16.4) < 0.25, `steht auf z=0, hoch ${r.bb[1][2].toFixed(2)} mm (Soll 15 + 1,6 − 0,2 Passung = 16,4)`);
  ok(r.bb[0][0] > scan.x1 + 5, `liegt neben dem Scan (x ab ${r.bb[0][0].toFixed(1)}, Scan bis ${scan.x1.toFixed(1)})`);
  ok(r.senk.length === 2 && Math.abs(r.senk[0] - 5) < 0.05 && Math.abs(r.senk[1] - r.senk[0] - 1.6) < 0.15, `Boden ${r.senk.length === 2 ? (r.senk[1] - r.senk[0]).toFixed(2) : '?'} mm (Soll 1,6), oben offen`);
  const waende = r.waag.length === 4 ? [r.waag[1] - r.waag[0], r.waag[3] - r.waag[2]] : [], wSoll = 1.2 / Math.cos(Math.atan(20 / 35));   // schräge Wand, waagerecht gemessen
  ok(waende.length === 2 && waende.every(x => Math.abs(x - wSoll) < 0.15), `Wände ${waende.map(x => x.toFixed(2)).join(' / ')} mm waagerecht (Soll ${wSoll.toFixed(2)} = 1 mm + 0,2 Passung, schräg)`);
  // Innenweite in Messhöhe: Scan 25 mm tief in y, Breite in x = 40 mm waagerecht (schräg versetzt) → innen ≈ 40 − 0,4
  ok(r.waag.length === 4 && Math.abs((r.waag[2] - r.waag[1]) - (40 - 0.4 / Math.cos(Math.atan(20 / 35)))) < 0.3, `Innenmaß x ${r.waag.length === 4 ? (r.waag[2] - r.waag[1]).toFixed(2) : '?'} mm (Scan 40, Passung −0,2 je Seite)`);
  ok(r.a02 > r.a10 * 0.85, `Sohle glatt + eben: Fläche knapp über dem Boden ${r.a02.toFixed(0)} mm² ≈ voll ${r.a10.toFixed(0)} mm² (nur Fase)`);
  const rR = await lauf(15, 1, 1.6, -0.2, 'riffel'), rQ = await lauf(15, 1, 1.6, -0.2, 'raute');
  ok(rR.teile === 1 && rR.a025 < rR.a10 * 0.8 && rR.a025 > rR.a10 * 0.35 && Math.abs(rR.bb[0][2]) < 0.01, `Riffel: in 0,25 mm ${(rR.a025 / rR.a10 * 100).toFixed(0)} % Fläche (Rillen), 1 Teil`);
  ok(rQ.teile === 1 && rQ.a025 < rR.a025 * 0.95, `Raute: in 0,25 mm ${(rQ.a025 / rQ.a10 * 100).toFixed(0)} % Fläche (weniger als Riffel)`);
  ok(Math.abs(rR.vol - r.vol) < r.vol * 0.12, `Profil nimmt nur wenig Material (${rR.vol.toFixed(0)} statt ${r.vol.toFixed(0)} mm³)`);
  await p.evaluate(() => { objects.splice(1).forEach(o => scene.remove(o)); });
  const r2 = await lauf(40, 1.4, 1.4, 0.2);
  ok(r2.teile === 1 && Math.abs(r2.bb[1][2] - (35 - 0.5 + 1.4 + 0.2)) < 0.3, `Höhe über Scan wird begrenzt: ${r2.bb[1][2].toFixed(2)} mm`);
  await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(400);
  await p.screenshot({ path: SHOTS + '/fhl-ergebnis.png' });
  const nVor = await p.evaluate(() => objects.length);
  await p.evaluate(() => undo());
  ok(await p.evaluate(n => objects.length === n - 1, nVor), 'Rückgängig entfernt die letzte Hülle');
  ok(r2.senk.length === 2 && Math.abs(r2.senk[1] - r2.senk[0] - 1.4) < 0.15, `Lauf 2 (Boden = Wand 1,4, Passung +0,2): Boden ${r2.senk.length === 2 ? (r2.senk[1] - r2.senk[0]).toFixed(2) : '?'} mm (Soll 1,4)`);
  ok(await p.evaluate(() => { const o = objects[0]; o.userData.type = o.userData.shapeType = 'custom'; o.userData.name = 'Teil A'; selectObjs([o]); updateCtxPopup(); return document.getElementById('ctx-fhl').style.display !== 'none' && _fhlPasst(o); }), '🧦 auch für geschnittenen Scan („Teil A“, kein Import)');
  // Verrauschter Scan (±0,15 mm, wie ein echter Scan): Außen glätten „stark“ → senkrechtes Außenprofil ruhiger, Innenmaß bleibt
  const gl = await p.evaluate(async () => {
    _newCreate(false); const tris = [], n = 96, m = 60, H = 30;
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const R = []; for (let j = 0; j <= m; j++) { R.push([]); for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI, rr = (j === 0 || j === m) ? 0 : rnd() * 0.3;
      R[j].push([(18 + rr) * Math.cos(a), (12 + rr) * Math.sin(a), H * j / m]); } }
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const k = (i + 1) % n; tris.push(...R[j][i], ...R[j][k], ...R[j + 1][k], ...R[j][i], ...R[j + 1][k], ...R[j + 1][i]); }
    for (let i = 0; i < n; i++) { const k = (i + 1) % n; tris.push(...R[0][k], ...R[0][i], 0, 0, 0); tris.push(...R[m][i], ...R[m][k], 0, 0, H); }
    const nt = tris.length / 9, buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf); dv.setUint32(80, nt, true);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, tris[t * 9 + k], true);
    _addImportedStl(buf, 'rauschen.stl', false); await new Promise(r => setTimeout(r, 300));
    const w = await _mfInit(), out = {};
    // Profil: größtes x bei |y| < 1 je Höhe (Außenseite), Rauheit = Abweichung vom gleitenden Mittel (±0,6 mm)
    const prof = (g, innen) => { const o = []; for (let z = 4; z <= 17; z += 0.2) { const cs = g.slice(z); let mx = -1e9, mi = 1e9;
      for (const q of cs.toPolygons()) for (const pt of q) if (Math.abs(pt[1]) < 1) { if (pt[0] > mx) mx = pt[0]; if (pt[0] < mi && pt[0] > 0) mi = pt[0]; } cs.delete(); o.push(innen ? mi : mx); }
      let r = 0, k = 0; for (let i = 3; i < o.length - 3; i++) { let s = 0; for (let d = -3; d <= 3; d++) s += o[i + d]; r += Math.abs(o[i] - s / 7); k++; } return r / k; };
    for (const g of [0, 3]) {
      selectObjs([objects[0]]); _fhlOpen(); _fhlSet('hoehe', 20); _fhlSet('glatt', g); _fhlStr('profil', 'glatt'); await _fhlApply();
      const mf = _mfUnionObjs(w, [objects[objects.length - 1]]), bb = mf.boundingBox(), mx = (bb.min[0] + bb.max[0]) / 2, my = (bb.min[1] + bb.max[1]) / 2;
      const zen = mf.translate([-mx, -my, 0]), cs = zen.slice(10), pl = cs.toPolygons().map(q => { let a = 0; for (let i = 0; i < q.length; i++) { const A = q[i], B = q[(i + 1) % q.length]; a += A[0] * B[1] - B[0] * A[1]; } return Math.abs(a / 2); }).sort((x, y) => y - x);
      out[g] = { rau: prof(zen, false), innenFl: pl[1] || 0, teile: mf.decompose().length }; cs.delete(); zen.delete(); mf.delete();
    }
    return out;
  });
  ok(gl[3].teile === 1 && gl[3].rau < gl[0].rau * 0.75, `Außen glätten „stark“: Rauheit außen ${gl[0].rau.toFixed(3)} → ${gl[3].rau.toFixed(3)} mm`);
  ok(Math.abs(gl[3].innenFl - gl[0].innenFl) < gl[0].innenFl * 0.04, `Innenmaß bleibt: Innenfläche ${gl[0].innenFl.toFixed(0)} / ${gl[3].innenFl.toFixed(0)} mm²`);
  // Scan aus zwei dicht aneinanderliegenden Schalen (Spalt 0,4 mm): früher stand im Spalt eine Zwischenwand in der Hülle
  const zw = await p.evaluate(async () => {
    _newCreate(false); const tris = [];
    const box = (x0, y0, z0, x1, y1, z1) => { const q = (a, b, c, d) => tris.push(...a, ...b, ...c, ...a, ...c, ...d), P = (x, y, z) => [x, y, z];
      q(P(x0,y0,z0),P(x0,y1,z0),P(x1,y1,z0),P(x1,y0,z0)); q(P(x0,y0,z1),P(x1,y0,z1),P(x1,y1,z1),P(x0,y1,z1));
      q(P(x0,y0,z0),P(x1,y0,z0),P(x1,y0,z1),P(x0,y0,z1)); q(P(x0,y1,z0),P(x0,y1,z1),P(x1,y1,z1),P(x1,y1,z0));
      q(P(x0,y0,z0),P(x0,y0,z1),P(x0,y1,z1),P(x0,y1,z0)); q(P(x1,y0,z0),P(x1,y1,z0),P(x1,y1,z1),P(x1,y0,z1)); };
    box(0, 0, 0, 19.8, 25, 35); box(20.2, 0, 0, 40, 25, 35); box(0, 0, 0, 40, 25, 0.5);
    const n = tris.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf); dv.setUint32(80, n, true);
    for (let t = 0; t < n; t++) { const o = 84 + t * 50; for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, tris[t * 9 + k], true); }
    _addImportedStl(buf, 'zwei-schalen.stl', false); await new Promise(r => setTimeout(r, 300));
    selectObjs([objects[0]]); _fhlOpen(); _fhlSet('hoehe', 15); _fhlSet('wand', 1); _fhlSet('boden', 1.6); _fhlSet('passung', -0.2); await _fhlApply();
    const w = await _mfInit(), mf = _mfUnionObjs(w, [objects[objects.length - 1]]), bb = mf.boundingBox(), cs = mf.slice((bb.min[2] + bb.max[2]) / 2);
    const r = { konturen: cs.toPolygons().length, innenX: 0 }; cs.delete(); mf.delete(); return r;
  });
  ok(zw.konturen === 2, `Zwei Scan-Schalen mit Spalt: Hülle innen frei (${zw.konturen} Konturen, Soll 2 — keine Zwischenwand)`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
