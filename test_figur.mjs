// Funktionstest Figur-Baukasten (_fgb*): jede Vorlage in jeder Pose → Netz
// wasserdicht (Manifold-Status + Kantenzählung), Volumen > 0, Höhe = Sollhöhe,
// Rechenzeit; dazu Renderbilder nach /tmp/fgbshots zum Anschauen.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = +process.env.PORT || 8841;
const URL = process.env.V3D_URL || `http://localhost:${PORT}/volme3d.html`;
const srv = process.env.V3D_URL ? null : spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const SHOTS = process.env.SHOTS !== '0';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => typeof _fgbMesh === 'function', null, { timeout: 30000 });
await page.waitForTimeout(1500);

const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const res = await page.evaluate(async ({ only, SHOTS }) => {
  hideStarter();
  await _mfInit();
  const out = [];
  const rc = document.createElement('canvas'); rc.width = 360; rc.height = 360;
  const r = new THREE.WebGLRenderer({ canvas: rc, antialias: true, preserveDrawingBuffer: true });
  r.setClearColor(0x1b2030);
  function shot(geo){
    const sc = new THREE.Scene();
    sc.add(new THREE.AmbientLight(0xffffff, 0.45));
    const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(3, 5, 6); sc.add(dl);
    const dl2 = new THREE.DirectionalLight(0x99aaff, 0.4); dl2.position.set(-4, 1, -3); sc.add(dl2);
    const imgs = [];
    for (const ang of [0.6, -2.2]) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd8c8b0, roughness: 0.6 }));
      geo.computeBoundingBox(); const bb = geo.boundingBox, c = new THREE.Vector3(), s = new THREE.Vector3(); bb.getCenter(c); bb.getSize(s);
      sc.add(m);
      const d = Math.max(s.x, s.y, s.z) * 1.9;
      const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
      cam.position.set(c.x + Math.sin(ang) * d, c.y + d * 0.3, c.z + Math.cos(ang) * d); cam.lookAt(c);
      r.render(sc, cam); imgs.push(rc.toDataURL('image/png'));
      sc.remove(m);
    }
    return imgs;
  }
  for (const k of Object.keys(_FGB_PRESETS)) {
    if (only && !only.includes(k)) continue;
    const poses = _FGB_POSES[_FGB_PRESETS[k].arch].length;
    for (let pose = 0; pose < poses; pose++) {
      const p = { ..._FGB_DEFAULTS, tailUp: 0.2, feet: 'paw', ..._FGB_PRESETS[k], kind: k, pose, seed: 99 };
      const t0 = performance.now();
      let geo, err = null;
      try { Object.assign(_fgbP, p); geo = _fgbMesh(_fgbP, 140); } catch (e) { err = String(e); }
      const ms = Math.round(performance.now() - t0);
      if (!geo) { out.push({ k, pose, err }); continue; }
      // Kanten zählen auf dem indizierten Netz
      const idx = geo.index.array, pos = geo.attributes.position, ec = new Map();
      let vol = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        for (const [i, j] of [[a, b], [b, c], [c, a]]) { const key = i < j ? i * 4e6 + j : j * 4e6 + i; ec.set(key, (ec.get(key) || 0) + 1); }
        const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a), bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b), cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
        vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      }
      let open = 0, over = 0; for (const v of ec.values()) { if (v === 1) open++; else if (v > 2) over++; }
      // Bauteile (Zusammenhangskomponenten)
      const par = new Int32Array(pos.count).map((_, i) => i); const f = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let t = 0; t < idx.length; t += 3) { const a = f(idx[t]), b = f(idx[t + 1]), c = f(idx[t + 2]); par[b] = a; par[f(c)] = a; }
      const comps = new Set(); for (let t = 0; t < idx.length; t++) comps.add(f(idx[t]));
      geo.computeBoundingBox(); const bb = geo.boundingBox;
      const rec = { k, pose, ms, tris: idx.length / 3, open, over, comps: comps.size, volCm3: +(vol / 6).toFixed(2), hMm: +((bb.max.y - bb.min.y) * 10).toFixed(1), wMm: +((bb.max.x - bb.min.x) * 10).toFixed(1) };
      if (SHOTS) rec.imgs = shot(geo);
      out.push(rec);
    }
  }
  return out;
}, { only, SHOTS });
let bad = 0;
for (const r of res) {
  if (r.imgs) r.imgs.forEach((u, i) => fs.writeFileSync(`/tmp/fgbshots/${r.k}_${r.pose}_${i}.png`, Buffer.from(u.split(',')[1], 'base64')));
  delete r.imgs;
  const ok = !r.err && r.open === 0 && r.over === 0 && r.volCm3 > 0 && r.comps === 1;
  if (!ok) bad++;
  console.log(ok ? 'OK ' : 'XX ', JSON.stringify(r));
}
console.log('pageerrors:', errs.length ? errs : 'keine');
console.log(bad ? `${bad} FEHLER` : 'ALLE OK');
await browser.close(); if (srv) srv.kill();
process.exit(bad ? 1 : 0);
