// 3MF-Import großer Scans im Worker (lib/p3mf.js): Seite bleibt bedienbar, Geometrie stimmt.
// Anlass 21.10.: 50-MB-„Mesh_….3mf" → „Diese Seite antwortet nicht" (Bibliothek + Öffnen).
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
import { createRequire } from 'module';
const fflate = createRequire(import.meta.url)('fflate');
const PORT = 8920;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };

// Scan-artiges Netz: Gitter auf einer welligen Fläche, nV ≈ nT/2 (wie echte Scans)
const W = Number(process.env.P3MF_W || 1100), H = W;
const p = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model" name="Scan &amp; Co"><mesh><vertices>\n'];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
  p.push(`<vertex x="${(x * 0.1).toFixed(6)}" y="${(y * 0.1).toFixed(6)}" z="${(Math.sin(x * 0.05) * Math.cos(y * 0.05) * 5).toFixed(6)}"/>\n`);
p.push('</vertices><triangles>\n'); let nT = 0;
for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
  const a = y * W + x; p.push(`<triangle v1="${a}" v2="${a + 1}" v3="${a + W}"/>\n<triangle v1="${a + 1}" v2="${a + W + 1}" v3="${a + W}"/>\n`); nT += 2;
}
p.push('</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 0"/></build></model>');
const xml = fflate.strToU8(p.join(''));
const zip = Buffer.from(fflate.zipSync({ '3D/3dmodel.model': xml, '[Content_Types].xml': fflate.strToU8('<Types/>') }));
console.log(`Testdatei: ${nT} Dreiecke, XML ${(xml.length / 1e6).toFixed(0)} MB, Zip ${(zip.length / 1e6).toFixed(1)} MB`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/__scan.3mf', r => r.fulfill({ body: zip }));
  await page.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await page.waitForFunction(() => typeof _importThreeMF === 'function' && typeof P3MF !== 'undefined' && typeof hideStarter === 'function');
  await page.waitForTimeout(8000);   // App-Start (Engines, Schriften …) blockiert selbst bis zu 1 s am Stück
  const r = await page.evaluate(async () => {
    try { hideStarter(); } catch (e) {}
    const buf = await (await fetch('/__scan.3mf')).arrayBuffer();
    // Herzschlag: misst die längste Lücke im Haupt-Thread während des Worker-Parsens
    let last = performance.now(), maxGap = 0, beats = 0, run = true;
    const gaps = []; const tick = () => { const n = performance.now(); if (n - last > 100) gaps.push([Math.round(last - t0), Math.round(n - last)]); maxGap = Math.max(maxGap, n - last); last = n; beats++; if (run) setTimeout(tick, 10); };
    var t0 = performance.now(); tick();
    t0 = performance.now();
    const parts = await _p3mfParseAsync(buf);
    const tParse = performance.now() - t0; run = false;
    const gapParse = maxGap;
    const before = objects.length;
    maxGap = 0; last = performance.now(); run = true; tick();
    const t1 = performance.now();
    const okImp = await _importThreeMF(buf, 'Mesh_scan.3mf');
    const tAll = performance.now() - t1; run = false;
    const gapAll = maxGap;
    const o = objects[objects.length - 1];
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o);
    return { gaps, gapAll: Math.round(gapAll), tParse: Math.round(tParse), gapParse: Math.round(gapParse), beats, tAll: Math.round(tAll), okImp, added: objects.length - before,
      parts: parts.length, name: parts[0] && parts[0].name, tris: parts[0] && parts[0].pos.length / 9,
      first: parts[0] && Array.from(parts[0].pos.slice(0, 3)), size: bb.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)) };
  });
  console.log(JSON.stringify(r));
  ok(r.parts === 1 && r.tris === nT, `Worker liest alle ${nT} Dreiecke`);
  ok(r.name === 'Scan & Co', 'Objektname inkl. &amp; dekodiert');
  ok(Math.abs(r.first[0] - 10) < 1e-4 && Math.abs(r.first[1] - 20) < 1e-4, 'Item-Transform (Versatz 10/20) angewandt');
  ok(r.gapParse < 300, `Seite bleibt beim Lesen bedienbar (längste Lücke ${r.gapParse} ms bei ${r.tParse} ms Lesezeit)`);
  ok(r.okImp && r.added === 1, 'Import legt einen Körper an');
  console.log(`INFO kompletter Import ${r.tAll} ms, längste Blockade inkl. Körper anlegen ${r.gapAll} ms`);
  const s = r.size.slice().sort((a, b) => a - b);
  ok(Math.abs(s[2] - (W - 1) * 0.01) < 0.01 && Math.abs(s[1] - (H - 1) * 0.01) < 0.01, 'Körpergröße stimmt (cm) ' + r.size.join(' × '));
  ok(!errs.length, 'keine Seitenfehler ' + errs.join(' | '));
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
