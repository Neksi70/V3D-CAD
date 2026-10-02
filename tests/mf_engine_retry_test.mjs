// Engine-Neustart: Meldet Manifold mitten im Abziehen einen internen Fehler
// („parameter 0 has unknown type“, Volker 2.10.26), muss die Instanz verworfen und
// der Abzug einmal wiederholt werden. Ablauf wie bei ihm: Platte importieren →
// Schwalbenschnitt → 10 Teile füllen → mit 0,5 mm Aufmaß abziehen.
// Start: npm run dev (Port 8766)
import { chromium } from 'playwright';
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('pageerror', e => console.log('PAGEERR', String(e)));
page.on('console', m => { if (/subtract|fit\]|Cut|rror|mf\]/i.test(m.text())) console.log('CON', m.text().slice(0,300)); });
await page.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.addShape === 'function', null, { timeout: 60000 });
const MIT_SCHNITT = process.argv[2] !== 'ohne';
await page.evaluate(async (MIT_SCHNITT) => {
  hideStarter();
  // Engine „kaputt": erster Aufruf von difference wirft wie bei Volker
  const w0 = await _mfInit(); window._w0 = w0; const echt = w0.Manifold.difference; let n = 0;
  window._stoer = () => { w0.Manifold.difference = function () { n++; const e = new Error('parameter 0 has unknown type '); e.name = 'BindingError'; throw e; }; };
  window._stoerN = () => n;
  document.getElementById('auth-overlay')?.classList.add('hidden');
  window._notes = []; const on = window.notify; window.notify = (m, t) => { window._notes.push(t + ': ' + m); return on(m, t); };
  const sh = new THREE.Shape(); sh.moveTo(-31,-21); sh.lineTo(31,-21); sh.lineTo(31,21); sh.lineTo(-31,21); sh.closePath();
  [[-28,-18],[28,-18],[28,18],[-28,18],[-3,-18],[-3,18],[3,-18],[3,18]].forEach(([x,y]) => { const h = new THREE.Path(); h.absarc(x,y,0.5,0,Math.PI*2,true); sh.holes.push(h); });
  const g = new THREE.ExtrudeGeometry(sh, { depth: 2, bevelEnabled: false, curveSegments: 24 }).toNonIndexed();
  g.rotateX(-Math.PI/2); g.scale(10,10,10); g.rotateX(Math.PI/2);   // wie STL: mm, Z-up
  _addImportedGeo(g, 'Adapterplatte.stl', true, null, false);
  let plate = objects[objects.length-1];
  window._info = { plate0: plate.userData.type + '/' + plate.userData.shapeType, box: getMeshBox(plate).getSize(new THREE.Vector3()).toArray().map(v => Math.round(v*10)) };
  if (MIT_SCHNITT) {
    selectObjs([plate]); _cut.cParams.type = 'dove'; openCutTool(); _cutSetAxis('x');
    await _cutExecute();
    plate = objects[0];
  }
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(55, 0); s.absarc(55, 14, 14, -Math.PI/2, Math.PI/2, false); s.lineTo(30, 28);
  s.lineTo(22, 28); s.absarc(15, 28, 7, 0, Math.PI, true); s.lineTo(0, 28); s.lineTo(0, 0);
  for (const [x, y] of [[12, 14], [52, 14], [30, 8]]) { const h = new THREE.Path(); h.absarc(x, y, 3, 0, Math.PI*2, true); s.holes.push(h); }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 8, bevelEnabled: false, curveSegments: 48 }).toNonIndexed();
  geo.computeVertexNormals();
  _addImportedGeo(geo, 'halter.stl', true, null, false);
  const part = objects[objects.length-1];
  part.userData.isHole = true;
  selectObjs([plate, part]);
  _applyFillPlate(3, 5, true, 10, true, 5); _stoer();
  window._info.nachFuellen = objects.length;
  selectObjs(objects.filter(o => o !== objects[1] || !MIT_SCHNITT));
}, MIT_SCHNITT);
const n0 = await page.evaluate(() => objects.length);
page.evaluate(() => subtractHoles());
await page.waitForSelector('#fit-dialog', { timeout: 5000 });
await page.click(`#fit-dialog ._fit-unit[data-u="mm"]`);
await page.fill('#fit-dialog ._fit-val', '0.5');
await page.click('#fit-dialog ._fit-ok');
await page.waitForFunction(n => objects.length < n || _notes.some(x => /^e:|möglich|Fehler/.test(x)), n0, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(800);
const r = await page.evaluate(() => ({ info: _info, n: objects.length, notes: _notes, stoerungen: _stoerN(), neueInstanz: _mfWasm !== _w0 }));
const gut = r.n === 2 && r.stoerungen === 1 && r.neueInstanz && r.notes.some(x => /Abzug fertig/.test(x));
console.log((gut ? '  OK   ' : 'FEHLER ') + 'Engine-Fehler → frische Instanz → Abzug gelingt', JSON.stringify(r));
process.exitCode = gut ? 0 : 1;
await b.close();
