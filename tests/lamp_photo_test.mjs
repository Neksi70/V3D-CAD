// Headless-Check für das Foto-Muster (Lithophane) im Lampen-Generator.
// Lädt ein synthetisches Testbild, baut Vorschau + finale Geometrie und prüft,
// dass das Relief tatsächlich moduliert und das Mesh geschlossen bleibt.
import { chromium } from '@playwright/test';

const URL = 'http://127.0.0.1:8766/volme3d.html';
const b = await chromium.launch();
const page = await b.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._buildLampShadeGeo === 'function', { timeout: 60000 });

const res = await page.evaluate(async () => {
  const out = {};
  // Testbild: linke Hälfte schwarz, rechte weiß, dazu ein heller Balken oben
  const c = document.createElement('canvas'); c.width = 200; c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 100, 200);
  x.fillStyle = '#fff'; x.fillRect(100, 0, 100, 200);
  x.fillStyle = '#888'; x.fillRect(0, 0, 200, 30);
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = c.toDataURL(); });

  _lampImg.img = img; _lampImg.aspect = 1;
  const cols = 200, rows = 200;
  const d = x.getImageData(0, 0, cols, rows).data, lum = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  _lampImg.lum = lum; _lampImg.cols = cols; _lampImg.rows = rows;

  const stats = (g) => {
    const p = g.attributes.position, n = p.count;
    let rmin = 1e9, rmax = -1e9;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (r > 0.05) { rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
    }
    return { verts: n, tris: (g.index ? g.index.count : n) / 3, rmin, rmax, vol: _geoSignedVolume(g) };
  };

  _lampP.pattern = 'smooth';
  out.smooth = stats(_buildLampShadeGeo(_lampP));

  _lampP.pattern = 'photo'; _lampP.photoDepth = 1.6; _lampP.photoArc = 360;
  _lampP.photoH = 60; _lampP.photoY = 55; _lampP.photoInv = false; _lampP.photoOut = false;
  _lampP.photoFit = 'stretch';   // dieser Block prüft das Rundum-Mapping

  let t0 = performance.now();
  out.prev = stats(_buildLampShadeGeo(_lampP, true)); out.prevMs = Math.round(performance.now() - t0);
  t0 = performance.now();
  const g = _buildLampShadeGeo(_lampP); out.full = stats(g); out.fullMs = Math.round(performance.now() - t0);

  // Innenradien in der Motivhöhe: müssen zwischen den Halbseiten differieren
  const p = g.attributes.position;
  const yMid = 0.55 * (_lampP.h * 0.1);
  let inDark = 1e9, inLight = -1e9;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); if (Math.abs(y - yMid) > 0.3) continue;
    const r = Math.hypot(p.getX(i), p.getZ(i)); if (r < 0.05) continue;
    if (r > _lampP.dia * 0.05 - 0.05) continue;             // nur Innenwand (< Außenradius)
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const u = ((-a / (Math.PI * 2)) % 1 + 1) % 1;   // u läuft gegen den Winkel (Blick von außen)
    if (u > 0.05 && u < 0.45) inDark = Math.min(inDark, r);  // Bildhälfte schwarz
    if (u > 0.55 && u < 0.95) inLight = Math.max(inLight, r);
  }
  out.innerDarkMin = inDark; out.innerLightMax = inLight;

  // Außenkontur darf sich beim Relief-nach-innen NICHT ändern
  out.outerSameAsSmooth = Math.abs(out.full.rmax - out.smooth.rmax) < 1e-4;

  _lampP.photoOut = true;
  out.outward = stats(_buildLampShadeGeo(_lampP));
  _lampP.photoOut = false;

  _lampP.mount = 'base';
  out.base = stats(_buildLampShadeBaseGeo(_lampP));
  _lampP.mount = 'standalone';

  _lampP.photoArc = 120;
  out.arc120 = stats(_buildLampShadeGeo(_lampP));
  _lampP.photoArc = 360;

  // Topologie: gleiche Auflösung mit und ohne Relief muss identisch zählen.
  // (Die Kuppelspitze liefert bauartbedingt nicht-manifolde Kanten — das ist
  // ein Vorbefund aller Lampenschirme, kein Effekt des Foto-Musters.)
  const edges = (g) => {
    const p = g.attributes.position, idx = g.index, n = (idx ? idx.count : p.count) / 3;
    const E = new Map(), v = new THREE.Vector3();
    const key = i => { v.fromBufferAttribute(p, i); return Math.round(v.x*1000)+'_'+Math.round(v.y*1000)+'_'+Math.round(v.z*1000); };
    const add = (a, c) => { const k = a < c ? a+'|'+c : c+'|'+a; E.set(k, (E.get(k) || 0) + 1); };
    for (let t = 0; t < n; t++) {
      const i0 = idx?idx.getX(t*3):t*3, i1 = idx?idx.getX(t*3+1):t*3+1, i2 = idx?idx.getX(t*3+2):t*3+2;
      const a = key(i0), c = key(i1), d = key(i2); add(a, c); add(c, d); add(d, a);
    }
    let bE = 0, nm = 0; E.forEach(c => { if (c === 1) bE++; else if (c > 2) nm++; });
    return { bE, nm };
  };
  const tiefe = _lampP.photoDepth;
  _lampP.photoDepth = 0.2; out.topoFlach = edges(_buildLampShadeGeo(_lampP));
  _lampP.photoDepth = tiefe; out.topoRelief = edges(_buildLampShadeGeo(_lampP));

  // Extremfall: schmaler Schirm mit großer LED-Tasche — das Relief darf nicht
  // in die Tasche hineinwachsen.
  const save = { h: _lampP.h, dia: _lampP.dia, mh: _lampP.photoH, d: _lampP.photoDepth };
  _lampP.h = 60; _lampP.dia = 50; _lampP.led = 60; _lampP.photoH = 30; _lampP.photoDepth = 3.5;
  const ge = _buildLampShadeGeo(_lampP), gp = ge.attributes.position;
  let rmin = 1e9;
  for (let i = 0; i < gp.count; i++) {
    const r = Math.hypot(gp.getX(i), gp.getZ(i));
    if (r > 0.05 && gp.getY(i) > 1.0) rmin = Math.min(rmin, r);   // oberhalb der Tasche
  }
  out.extremInnenMin = rmin;
  out.extremPocketR = Math.min(60/2 + _lampP.clr, (50/2 - _lampP.wall) - 0.6) / 10;
  Object.assign(_lampP, { h: save.h, dia: save.dia, photoH: save.mh, photoDepth: save.d });

  // Hochkant-Motiv (3:4) auf Ø90×120: der Umfang ist 283 mm breit, unverzerrt
  // bräuchte das Bild 377 mm Höhe. Genau der Fall, der vorher zerquetscht wurde.
  _lampImg.aspect = 0.75;
  Object.assign(_lampP, { h: 120, dia: 90, photoH: 90, photoArc: 360 });
  out.lay = {};
  for (const modus of ['stretch', 'fit', 'repeat']) {
    _lampP.photoFit = modus;
    const L = _lampPhotoLayout(_lampP);
    out.lay[modus] = { arc: Math.round(L.arc), rep: L.rep, mh: Math.round(L.mh),
      breite: Math.round(L.breiteMm), verz: +L.verzerrung.toFixed(2),
      tris: stats(_buildLampShadeGeo(_lampP)).tris, vol: stats(_buildLampShadeGeo(_lampP)).vol };
  }
  // Querformat (4:3) soll bei „Einpassen" fast den ganzen Umfang belegen dürfen
  _lampImg.aspect = 4 / 3; _lampP.photoFit = 'fit';
  out.querArc = Math.round(_lampPhotoLayout(_lampP).arc);
  _lampImg.aspect = 1; _lampP.photoFit = 'stretch';
  return out;
});

console.log(JSON.stringify(res, null, 1));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const ok = [];
const check = (name, cond) => { ok.push(`${cond ? '✓' : '✗'} ${name}`); return cond; };
let all = true;
all &= check('Vorschau baut Dreiecke', res.prev.tris > 5000);
all &= check(`Vorschau schnell (${res.prevMs} ms)`, res.prevMs < 400);
all &= check('Volle Auflösung deutlich feiner', res.full.tris > res.prev.tris * 3);
all &= check('Volumen positiv (Orientierung ok)', res.full.vol > 0);
all &= check('Innenwand dunkel dicker als hell', res.innerDarkMin < res.innerLightMax - 0.05);
all &= check('Außenkontur unverändert bei Relief innen', res.outerSameAsSmooth);
all &= check('Relief nach außen vergrößert rmax', res.outward.rmax > res.smooth.rmax + 0.05);
all &= check('Push-Basis-Schirm baut', res.base.tris > 5000 && res.base.vol > 0);
all &= check('120°-Motiv baut', res.arc120.tris > 5000 && res.arc120.vol > 0);
all &= check('keine offenen Kanten', res.topoRelief.bE === 0);
all &= check(`Relief fügt keine Topologie-Fehler hinzu (${res.topoFlach.nm} → ${res.topoRelief.nm})`,
  res.topoRelief.nm <= res.topoFlach.nm);
all &= check(`Relief bleibt aus der LED-Tasche (${res.extremInnenMin.toFixed(2)} > ${res.extremPocketR.toFixed(2)})`,
  res.extremInnenMin > res.extremPocketR);
const L = res.lay;
all &= check(`Hochkant + „Strecken" verzerrt erwartungsgemäß (${L.stretch.verz}×)`, L.stretch.verz > 3);
all &= check(`Hochkant + „Einpassen" unverzerrt (${L.fit.verz}×, ${L.fit.arc}° statt 360°)`,
  Math.abs(L.fit.verz - 1) < 0.02 && L.fit.arc < 120);
all &= check(`Hochkant + „Wiederholen" unverzerrt (${L.repeat.rep}× rundum, ${L.repeat.verz}×)`,
  L.repeat.rep >= 3 && Math.abs(L.repeat.verz - 1) < 0.1 && L.repeat.arc === 360);
all &= check('alle drei Modi bauen ein positives Volumen',
  ['stretch','fit','repeat'].every(m => L[m].vol > 0 && L[m].tris > 5000));
all &= check(`Querformat belegt bei „Einpassen" mehr Umfang (${res.querArc}°)`, res.querArc > L.fit.arc * 1.5);
all &= check('keine Seitenfehler', errs.length === 0);
console.log('\n' + ok.join('\n'));
console.log(all ? '\nALLES GRÜN' : '\nFEHLGESCHLAGEN');
await b.close();
process.exit(all ? 0 : 1);
