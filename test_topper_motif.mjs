// Test für das SVG-Motiv im Tortentopper (_ttMotif*): prüft Konturen-Erkennung,
// Lage (kein Y-Flip), Platzierung links/rechts/oben, dass die Auto-Stege alles zu
// EINEM zusammenhängenden Stück verschweißen, und den Weg Vektorisierer → Topper.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8795;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));

await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

const res = await page.evaluate(async () => {
  const out = {};
  if (typeof _ttSetMotif !== 'function') return { err: '_ttSetMotif fehlt' };

  // Motiv: großes Quadrat + weit rechts daneben ein freistehendes Rechteck.
  // Das Rechteck MUSS von den Auto-Stegen angehängt werden, sonst fällt es ab.
  const svg2 = '<svg xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M0,0 L100,0 L100,100 L0,100 Z"/>'
    + '<path d="M130,30 L170,30 L170,70 L130,70 Z"/></svg>';

  document.getElementById('tt-text').value = 'Ida';
  document.getElementById('tt-font').value = 'helvetiker_bold';
  document.getElementById('tt-dheart').checked = false;
  document.getElementById('tt-motifsize').value = 100;
  document.getElementById('tt-motifgap').value = 10;

  out.setOk = _ttSetMotif(svg2, 'Testmotiv');
  out.polys = _ttMotif ? _ttMotif.polys.length : 0;
  out.motifW = _ttMotif ? +_ttMotif.w.toFixed(3) : null;      // 170 breit / 100 hoch

  // ── Lage: Dreieck mit Spitze oben im SVG muss oben bleiben (Y-Flip korrekt) ──
  _ttSetMotif('<svg xmlns="http://www.w3.org/2000/svg"><path d="M50,0 L100,100 L0,100 Z"/></svg>', 'Dreieck');
  const tri = _ttMotif.polys[0].outer;
  let apex = tri[0];
  for (const p of tri) if (p.y > apex.y) apex = p;            // höchster Punkt
  out.apexCentered = Math.abs(apex.x - 0.5) < 0.05;           // Spitze mittig → oben
  let wideY = tri[0], narrowY = tri[0];
  for (const p of tri) { if (p.y < wideY.y) wideY = p; }
  out.apexTop = apex.y > wideY.y;

  // ── Zusammenhang: exakt die Kette aus _ttGeo nachbauen ──
  _ttSetMotif(svg2, 'Testmotiv');
  const font = await new Promise(r => _npLoadFont('helvetiker_bold', r));
  const build = (pos, gap) => {
    _ttSetMotifPos(pos);
    document.getElementById('tt-motifgap').value = gap;
    const o = _ttOpts();
    const sizeU = o.sizeMM / 10, webU = Math.max(0.08, o.webMM / 10);
    const parts = _ttLayoutParts(font, o.txt, sizeU, Math.min(0.35, Math.max(0, o.overlap / 100)),
      sizeU * Math.max(0.3, o.lineGap / 100));
    const nText = parts.length;
    parts.push(..._ttMotifParts(parts, sizeU, o.motifSize, o.motifPos, o.motifGap));
    const segs = _ttBridgeSegs(parts, webU);
    // Komponenten zählen: berührend/überlappend + die berechneten Stege
    const n = parts.length, root = [...Array(n).keys()];
    const find = i => { while (root[i] !== i) { root[i] = root[root[i]]; i = root[i]; } return i; };
    const uni = (a, b) => { root[find(a)] = find(b); };
    const anyIn = (A, B) => A.some(p => _ttInPoly(B, p.x, p.y));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (_ttClosest(parts[i].pts, parts[j].pts).d < 0.035
        || anyIn(parts[i].pts, parts[j].pts) || anyIn(parts[j].pts, parts[i].pts)) uni(i, j);
    }
    // Steg verbindet die Teile, deren Umriss seine Endpunkte trägt
    for (const s of segs) {
      let ia = -1, ib = -1;
      for (let i = 0; i < n; i++) for (const q of parts[i].pts) {
        if (ia < 0 && Math.abs(q.x - s.ax) < 1e-9 && Math.abs(q.y - s.ay) < 1e-9) ia = i;
        if (ib < 0 && Math.abs(q.x - s.bx) < 1e-9 && Math.abs(q.y - s.by) < 1e-9) ib = i;
      }
      if (ia >= 0 && ib >= 0) uni(ia, ib);
    }
    const comps = new Set(); for (let i = 0; i < n; i++) comps.add(find(i));
    // Motiv-Bereich: Teile ab Index nText
    let mMinX = 1e9, mMaxX = -1e9, mMinY = 1e9, mMaxY = -1e9, tMaxX = -1e9, tMaxY = -1e9, tMinX = 1e9;
    for (let i = 0; i < n; i++) for (const q of parts[i].pts) {
      if (i >= nText) { if (q.x < mMinX) mMinX = q.x; if (q.x > mMaxX) mMaxX = q.x; if (q.y < mMinY) mMinY = q.y; if (q.y > mMaxY) mMaxY = q.y; }
      else { if (q.x > tMaxX) tMaxX = q.x; if (q.x < tMinX) tMinX = q.x; if (q.y > tMaxY) tMaxY = q.y; }
    }
    return { nText, nAll: n, nSegs: segs.length, comps: comps.size,
      mMinX: +mMinX.toFixed(2), mMaxX: +mMaxX.toFixed(2), mMinY: +mMinY.toFixed(2), mMaxY: +mMaxY.toFixed(2),
      tMinX: +tMinX.toFixed(2), tMaxX: +tMaxX.toFixed(2), tMaxY: +tMaxY.toFixed(2) };
  };

  out.right = build('right', 10);
  out.left = build('left', 10);
  out.top = build('top', 10);

  // ── Geometrie + Laufzeit (Vorschau läuft bei jedem Reglerzug) ──
  _ttSetMotifPos('right');
  document.getElementById('tt-motifgap').value = 10;
  const t0 = performance.now();
  const g = _ttGeo(font, _ttOpts());
  out.geoMs = Math.round(performance.now() - t0);
  out.geoOk = !!(g && g.geo && g.geo.attributes.position.count > 100);
  out.nBridges = g ? g.nBridges : -1;
  out.wMM = g ? Math.round(g.wMM) : null;

  // ── Erstellen: Gruppe mit Schriftzug + Stegen + Pins ──
  const before = objects.length;
  _ttCreate();
  await new Promise(r => setTimeout(r, 700));
  out.created = objects.length - before;
  if (objects.length > before) {
    const top = objects[objects.length - 1];
    out.kids = top.children ? top.children.length : 0;
    const b = new THREE.Box3().setFromObject(top);
    out.sizeMM = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +(v * 10).toFixed(1));
  }

  // ── Nur Motiv, ohne Text ──
  document.getElementById('tt-text').value = '';
  const g2 = _ttGeo(font, _ttOpts());
  out.motifOnly = !!(g2 && g2.geo && g2.geo.attributes.position.count > 50);
  document.getElementById('tt-text').value = 'Ida';

  // ── Vorschau ist entkoppelt: Zeilen sofort, Neuaufbau verzögert ──
  document.getElementById('tt-info').textContent = '';
  document.getElementById('tt-pins').value = '0';
  _ttPreview();
  out.rowsInstant = document.getElementById('tt-row-pinlen').style.display === 'none';
  out.infoDeferred = document.getElementById('tt-info').textContent === '';
  document.getElementById('tt-pins').value = '1';
  _ttPreview();
  await new Promise(r => setTimeout(r, 900));
  out.infoAfter = document.getElementById('tt-info').textContent.startsWith('Topper ');

  // ── Weg Vektorisierer → Topper ──
  _ttMotifClear();
  const cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 200, 200);
  cx.fillStyle = '#000'; cx.beginPath(); cx.arc(100, 100, 70, 0, 7); cx.fill();
  await new Promise((r, j) => { const im = new Image(); im.onload = () => { _vec.img = im; r(); }; im.onerror = j; im.src = cv.toDataURL(); });
  _vecP.mode = 0; _vecProcess();
  _vecToTopper();
  out.handoff = !!_ttMotif && _ttMotif.polys.length === 1;
  out.topperOpen = document.getElementById('topper-modal').classList.contains('show');
  out.rowsShown = document.getElementById('tt-motif-rows').style.display !== 'none';
  return out;
});

console.log(JSON.stringify(res, null, 2));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const conn = p => p && p.comps === 1 && p.nAll === p.nText + 2 && p.nSegs > 0;
const ok =
  res.setOk && res.polys === 2 && Math.abs(res.motifW - 1.7) < 0.01 &&
  res.apexTop && res.apexCentered &&
  conn(res.right) && conn(res.left) && conn(res.top) &&
  res.right.mMinX > res.right.tMaxX &&        // rechts vom Schriftzug
  res.left.mMaxX < res.left.tMinX &&          // links davon
  res.top.mMinY > res.top.tMaxY &&            // darüber
  res.geoOk && res.nBridges > 0 && res.geoMs < 400 &&
  res.created === 1 && res.kids >= 3 &&
  res.motifOnly && res.handoff && res.topperOpen && res.rowsShown &&
  res.rowsInstant && res.infoDeferred && res.infoAfter;

console.log(ok ? '\n✅ Topper-Motiv: alle Prüfungen bestanden' : '\n❌ Topper-Motiv: Prüfung fehlgeschlagen');

await browser.close();
srv.kill();
process.exit(ok && !errs.length ? 0 : 1);
