// Bibliothek: riesige 3MF ohne eingebautes PNG dürfen die Seite nicht einfrieren (21.10.,
// 50-MB-Scan „Mesh_….3mf" → „Diese Seite antwortet nicht"). Kleine 3MF weiter mit Vorschau.
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
const PORT = 8918;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await page.waitForFunction(() => typeof _stlThumbOne === 'function' && typeof fflate !== 'undefined');
  const r = await page.evaluate(async () => {
    const mk3mf = (nV, nT) => {
      const p = ['<model unit="millimeter"><resources><object id="1"><mesh><vertices>'];
      for (let i = 0; i < nV; i++) p.push(`<vertex x="${(i % 97) * 0.37}" y="${(i % 89) * 0.41}" z="${(i % 83) * 0.29}"/>`);
      p.push('</vertices><triangles>');
      for (let i = 0; i < nT; i++) p.push(`<triangle v1="${i % nV}" v2="${(i + 1) % nV}" v3="${(i + 2) % nV}"/>`);
      p.push('</triangles></mesh></object></resources><build><item objectid="1"/></build></model>');
      return fflate.zipSync({ '3D/3dmodel.model': fflate.strToU8(p.join('')) }).buffer;
    };
    const big = mk3mf(700000, 1000000), small = mk3mf(300, 400);
    _stlReadBytes = async f => f.name.startsWith('Mesh') ? big : small;
    const t = Date.now();
    const fs = [{ name: 'Mesh_scan.3mf', path: 'Mesh_scan.3mf', size: big.byteLength, mtime: t },
                { name: 'Klein.3mf', path: 'Klein.3mf', size: small.byteLength, mtime: t }];
    const out = {};
    for (const f of fs) {
      f._thumbEl = document.createElement('div');
      const t0 = performance.now(); await _stlThumbOne(f);
      out[f.name] = { ms: Math.round(performance.now() - t0), url: !!f._thumbUrl, html: f._thumbEl.textContent };
    }
    out.cache = await _stlIdbGet('thumbs', 'v2|Mesh_scan.3mf|' + fs[0].size + '|' + t);
    out.zipMB = (big.byteLength / 1e6).toFixed(1);
    return out;
  });
  console.log(JSON.stringify(r));
  const b = r['Mesh_scan.3mf'], s = r['Klein.3mf'];
  ok(!b.url && /Vorschau zu groß/.test(b.html), 'großes Scan-3MF: Platzhalter „Vorschau zu groß"');
  ok(b.ms < 1500, `großes Scan-3MF blockiert nicht (${b.ms} ms, Zip ${r.zipMB} MB)`);
  ok(r.cache === '-big', 'Überspringen wird gecacht → kein Neuversuch beim nächsten Öffnen');
  ok(s.url, 'kleines 3MF ohne PNG bekommt weiter eine gerenderte Vorschau');
  ok(!errs.length, 'keine Seitenfehler ' + errs.join(' | '));
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
