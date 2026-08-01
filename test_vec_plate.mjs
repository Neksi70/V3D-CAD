// Grundplatte: Ralfs Fall — eine Strichzeichnung aus LOSEN Ringen muss auf der
// Platte zu EINEM zusammenhängenden Stück werden, und die Linien müssen erhaben
// darauf stehen (sonst sieht man das Motiv nicht mehr).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8808;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

const res = await page.evaluate(async () => {
  const out = {};
  if (typeof hideStarter === 'function') hideStarter();

  // Strichzeichnung: drei getrennte Ringe (wie Kopf/Körper/Arm einer Figur),
  // die einander NICHT berühren — genau Ralfs Problem.
  const cv = document.createElement('canvas'); cv.width = 600; cv.height = 400;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 600, 400);
  cx.strokeStyle = '#000'; cx.lineWidth = 5;
  [[150, 200, 90], [330, 200, 60], [470, 200, 45]].forEach(([x, y, r]) => {
    cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.stroke();
  });
  await new Promise((r, j) => { const im = new Image(); im.onload = () => { _vec.img = im; r(); }; im.onerror = j; im.src = cv.toDataURL(); });

  Object.assign(_vecP, { mode: 0, thr: 55, inv: 0, smooth: 2, minA: 0, res: 900, wmm: 100,
                         crop: null, plate: 0, plateMM: 1.5, plateH: 2, reliefH: 1 });
  _vec.traced = true;

  // ── ohne Platte: lose Ringe ──
  _vecProcess();
  out.ohne = { teile: _vec.out.layers[0].faces.length, platte: !!_vec.out.plate };

  // ── mit Platte ──
  _vecP.plate = 1; _vecProcess();
  const o = _vec.out;
  out.mit = { teile: o.layers[0].faces.length, plattenTeile: o.plate ? o.plate.length : 0 };
  // Platte muss die Zeichnung überragen (Rand) …
  let ax0=1e9, ax1=-1e9, px0=1e9, px1=-1e9;
  for (const f of o.layers[0].faces) for (const p of f.outer.pts) { if(p.x<ax0)ax0=p.x; if(p.x>ax1)ax1=p.x; }
  for (const f of o.plate) for (const p of f.outer.pts) { if(p.x<px0)px0=p.x; if(p.x>px1)px1=p.x; }
  out.randAussen = px0 < ax0 && px1 > ax1;
  // … und die Ringe füllen (Loch weg → Scheibe)
  out.platteVoll = o.plate.every(f => (f.holes || []).length === 0);
  // SVG enthält die Platte als eigenen, ZUERST geschriebenen Pfad
  const svg = _vecSvgText();
  out.svgPlateFirst = svg.indexOf('#cccccc') > 0 && svg.indexOf('#cccccc') < svg.indexOf('#000000');

  // ── In die Szene: Gruppe mit Platte + erhabener Nachzeichnung ──
  const n0 = objects.length;
  _vecToScene();
  await new Promise(r => setTimeout(r, 600));
  out.added = objects.length - n0;
  const grp = objects[objects.length - 1];
  out.kinder = grp.children ? grp.children.map(c => c.userData.name) : null;
  const bb = o => { const b = new THREE.Box3().setFromObject(o); return {
    x: +((b.max.x-b.min.x)*10).toFixed(1), y0: +(b.min.y*10).toFixed(2), y1: +(b.max.y*10).toFixed(2) }; };
  const bP = bb(grp.children[0]), bA = bb(grp.children[1]);
  out.platte = bP; out.kunst = bA;
  out.platteDick = Math.abs((bP.y1 - bP.y0) - 2) < 0.15;          // 2 mm
  out.kunstHoeher = Math.abs((bA.y1 - bA.y0) - 3) < 0.2;          // 2 + 1 mm
  out.gleicherBoden = Math.abs(bA.y0 - bP.y0) < 0.05;             // beide auf der Platte
  out.breiteStimmt = Math.abs(bP.x - 100) < 2;                    // Regler „Breite"
  out.kunstSchmaler = bA.x < bP.x;                                 // Platte überragt

  // ── Weg in den Topper: dort zählt nur die volle Platte, keine Linien-Ringe.
  // Sonst hielte der SVG-Leser die Linien INNERHALB der Platte für Löcher und
  // machte aus dem vollen Motiv wieder eine Strichzeichnung.
  _ttMotifClear();
  _vecToTopper();
  await new Promise(r => setTimeout(r, 400));
  out.topper = _ttMotif
    ? { teile: _ttMotif.polys.length, loecher: _ttMotif.polys.reduce((s, p) => s + p.holes.length, 0) }
    : null;
  out.svgNur = { platteOhneKunst: !_vecSvgText('plate').includes('#000000'),
                 kunstOhnePlatte: !_vecSvgText('art').includes('#cccccc') };

  // ── der Kern: hängt alles zusammen? Über die Platten-Konturen prüfen ──
  const P = o.plate.map(f => f.outer.pts);
  const n = P.length, root = [...Array(n).keys()];
  const find = i => { while (root[i] !== i) { root[i] = root[root[i]]; i = root[i]; } return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    if (_ttClosest(P[i], P[j]).d < 1.5) root[find(i)] = find(j);
  const comps = new Set(); for (let i = 0; i < n; i++) comps.add(find(i));
  out.plattenStuecke = comps.size;
  return out;
});

console.log(JSON.stringify(res, null, 2));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const ok =
  res.ohne.teile === 3 && !res.ohne.platte &&          // vorher drei lose Ringe
  res.mit.plattenTeile === 3 && res.platteVoll &&      // Platte: drei volle Scheiben
  res.randAussen && res.svgPlateFirst &&
  res.added === 1 && res.kinder.join() === 'Grundplatte,Nachzeichnung' &&
  res.platteDick && res.kunstHoeher && res.gleicherBoden &&
  res.breiteStimmt && res.kunstSchmaler &&
  // Topper bekommt drei VOLLE Scheiben, keine Ringe (also keine Löcher)
  res.topper && res.topper.teile === 3 && res.topper.loecher === 0 &&
  res.svgNur.platteOhneKunst && res.svgNur.kunstOhnePlatte &&
  // getrennte Figuren bleiben getrennt — das muss die App auch sagen
  res.plattenStuecke === 3;

console.log(ok ? '\n✅ Grundplatte: alles verbunden, Linien erhaben' : '\n❌ Grundplatte: Prüfung fehlgeschlagen');
await browser.close(); srv.kill();
process.exit(ok && !errs.length ? 0 : 1);
