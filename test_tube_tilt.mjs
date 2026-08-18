// Ergänzung zu test_tube_diameter.mjs: prüft die SCHRÄGEN Lagen (22,5°-Schritte
// über den „⤵ Kippen"-Knopf), nicht nur die liegenden 90°-Fälle. Genau dort war
// die Achsen-Zuordnung mehrdeutig — Ralfs Meldung: „Länge ist dann nicht mehr
// Länge sondern macht ein Ei".
//
// Misst absichtlich MIT EIGENER Mess-Funktion (nicht mit _fpLocalSize der App),
// damit der Test auch gegen ältere Stände läuft und nicht die zu prüfende
// Rechnung als Maßstab benutzt.
//   node test_tube_tilt.mjs [verzeichnis] [port]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const DIR  = process.argv[2] || process.cwd();
const PORT = +(process.argv[3] || 8796);
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: DIR });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout:20000 }).catch(()=>{});
// Ältere Stände setzen _isReady noch nicht — auf die Szene-Globals warten
await page.waitForFunction(() => {
  try { return typeof objects !== 'undefined' && typeof undoStack !== 'undefined' && typeof addShape === 'function'; }
  catch { return false; }
}, { timeout:20000 });
await page.waitForTimeout(1200);

const res = await page.evaluate(() => {
  const out = { steps: [] };
  // Ausdehnung entlang der EIGENEN Achsen des Körpers, in mm — unabhängig von
  // der App-Logik nachgerechnet.
  const localMM = o => {
    o.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
    const box = new THREE.Box3();
    o.traverse(c => {
      if (!c.isMesh || !c.geometry || !c.geometry.attributes.position) return;
      const lb = new THREE.Box3().setFromBufferAttribute(c.geometry.attributes.position);
      const m  = new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld);
      for (const x of [lb.min.x, lb.max.x]) for (const y of [lb.min.y, lb.max.y]) for (const z of [lb.min.z, lb.max.z])
        box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(m));
    });
    const s = o.getWorldScale(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    return { d:+(sz.x*Math.abs(s.x)*10).toFixed(2), h:+(sz.y*Math.abs(s.y)*10).toFixed(2), dz:+(sz.z*Math.abs(s.z)*10).toFixed(2) };
  };

  // Rohr wie im Screenshot: Ø40, Höhe 20
  addShape('tube'); const t = objects[objects.length-1];
  selectObjs([t]); _fpCurType = null; updateFP();
  fpApplyDiameter(40); fpApplyDim('h', 20);
  out.start = localMM(t);

  // In 22,5°-Schritten kippen und nach JEDEM Schritt Ø + Höhe neu setzen
  for (let i = 1; i <= 3; i++) {
    rotate225('x', 1);                       // 22,5° · 45° · 67,5°
    selectObjs([t]); _fpCurType = null; updateFP();
    const deg   = +(t.rotation.x * 180 / Math.PI).toFixed(1);
    const panel = { d: +document.getElementById('fp-r').value, h: +document.getElementById('fph').value };
    const real  = localMM(t);
    const zielD = 30, zielH = 50;
    fpApplyDiameter(zielD);
    const afterDia = localMM(t);
    fpApplyDim('h', zielH);
    const afterH = localMM(t);
    out.steps.push({
      deg, zielD, zielH,
      panelZeigt: panel,                     // soll der echten Form entsprechen
      formVorher: real,
      nachDia: afterDia,                     // d = zielD, h unverändert
      nachHoehe: afterH,                     // d = zielD, h = zielH
      rund: Math.abs(afterH.d - afterH.dz) < 0.2,     // kein „Ei"
      aufPlatte: getMeshBox(t).min.y > -0.001
    });
  }
  return out;
});
await browser.close(); srv.kill();
console.log(JSON.stringify(res, null, 2));

let bad = 0;
for (const s of res.steps) {
  const okPanel = Math.abs(s.panelZeigt.d - s.formVorher.d) < 0.2 && Math.abs(s.panelZeigt.h - s.formVorher.h) < 0.2;
  const okDia   = Math.abs(s.nachDia.d - s.zielD) < 0.2 && Math.abs(s.nachDia.h - s.formVorher.h) < 0.2;
  const okH     = Math.abs(s.nachHoehe.h - s.zielH) < 0.2 && Math.abs(s.nachHoehe.d - s.zielD) < 0.2;
  console.log(`${String(s.deg).padStart(6)}° : ${okPanel?'✓':'✗'} Anzeige  ${okDia?'✓':'✗'} Ø-Regler  ` +
              `${okH?'✓':'✗'} Höhe-Regler  ${s.rund?'✓':'✗'} rund  ${s.aufPlatte?'✓':'✗'} auf Platte`);
  if (!(okPanel && okDia && okH && s.rund && s.aufPlatte)) bad++;
}
console.log(bad === 0 ? '\nALLE SCHRÄGLAGEN OK' : `\n${bad} SCHRÄGLAGE(N) FEHLERHAFT`);
process.exit(bad === 0 ? 0 : 1);
