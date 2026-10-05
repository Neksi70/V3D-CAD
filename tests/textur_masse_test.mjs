// Ralf 5.10.2026: „Wenn ich eine Textur anbringen möchte, verändert sich die Größe."
// Vorher legte jede Textur ihre Höhe AUSSEN auf: 200×60×23,4 → 201×61×24,4 und der
// Boden rutschte 0,5 mm unter die Platte. Jetzt: neue Texturen eingeprägt, Boden glatt.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8854;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
const res = await page.evaluate(() => {
  hideStarter?.();
  const box = o => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
  const mm = o => { const s = box(o).getSize(new THREE.Vector3()).multiplyScalar(10); return [s.x, s.z, s.y].map(v => +v.toFixed(2)); };
  // tiefste Stelle der Oberseite: wie weit reicht das Muster ins Material?
  const topDepth = o => { const b = box(o); let lo = Infinity; o.updateMatrixWorld(true);
    const p = o.geometry.attributes.position, v = new THREE.Vector3();
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, hx = (b.max.x - b.min.x) * 0.3, hz = (b.max.z - b.min.z) * 0.3;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      if (Math.abs(v.x - cx) < hx && Math.abs(v.z - cz) < hz && v.y > (b.min.y + b.max.y) / 2) lo = Math.min(lo, v.y); }
    return +((b.max.y - lo) * 10).toFixed(2); };
  const clear = () => { for (const k of objects.slice()) scene.remove(k); objects.length = 0; };
  const mk = {
    box: () => { addShape('box'); const o = objects[objects.length-1]; selectObjs([o]); fpApplyDim('w', 200); fpApplyDim('d', 60); fpApplyDim('h', 23.4); return o; },
    cyl: () => { addShape('cylinder'); const o = objects[objects.length-1]; selectObjs([o]); fpApplyDim('w', 60); fpApplyDim('h', 40); return o; },
    imp: () => { const g = new THREE.BoxGeometry(200, 23.4, 60).toNonIndexed(); _addImportedGeo(g, 'k.stl', false, null, false); return objects[objects.length-1]; },
    grp: () => { addShape('box'); const a = objects[objects.length-1]; addShape('box'); const b = objects[objects.length-1]; b.position.x += 1.5; selectObjs([a,b]); groupSelected(); return objects[objects.length-1]; },
  };
  const out = {};
  for (const [name, f] of Object.entries(mk)) {
    clear(); const o = f(); const vor = mm(o), minY0 = box(o).min.y;
    selectObjs([o]); applyDisplacement('pattern', 'riffel');
    out[name] = { vor, nach: mm(o), minY: +((box(o).min.y - minY0) * 10).toFixed(2), dir: o.userData.texDir, tiefe: o.isMesh ? topDepth(o) : null };
  }
  // Aufgesetzt: altes Verhalten auf Wunsch
  clear(); { const o = mk.box(); selectObjs([o]); applyDisplacement('pattern', 'riffel'); applyDisplacement('dir', 'aufgesetzt');
    out.aufgesetzt = mm(o);
    // Speichern/Laden behält die Richtung
    const d = JSON.parse(JSON.stringify(objectToData(o))); out.saveDir = d.texDir;
    applyDisplacement('dir', 'eingepraegt'); out.zurueck = mm(o); }
  // Alte Szene ohne texDir: bleibt aufgesetzt, auch nach Musterwechsel
  clear(); { const o = mk.box(); selectObjs([o]); applyDisplacement('pattern', 'riffel');
    const d = JSON.parse(JSON.stringify(objectToData(o))); delete d.texDir; delete d.texWhere;
    const l = buildObjectFromData(d); scene.add(l); objects.push(l); selectObjs([l]);
    applyDisplacement('pattern', 'waben'); out.alt = { dir: l.userData.texDir || null, mm: mm(l) }; }
  return out;
});
console.log(JSON.stringify(res));
const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.05);
const checks = [
  ...['box', 'cyl', 'imp', 'grp'].map(k => [k + ': Maße bleiben', same(res[k].vor, res[k].nach)]),
  ...['box', 'cyl', 'imp', 'grp'].map(k => [k + ': Boden bleibt auf der Platte', Math.abs(res[k].minY) < 0.05]),
  ['Muster wirklich eingeprägt (~0,5 mm)', res.box.tiefe > 0.3 && res.box.tiefe <= 0.55 && res.imp.tiefe > 0.3],
  ['Aufgesetzt wächst wie früher', res.aufgesetzt[0] > 200.9 && res.aufgesetzt[2] > 23.8],
  ['Richtung wird gespeichert', res.saveDir === 'aufgesetzt'],
  ['zurück auf eingeprägt', same(res.zurueck, [200, 60, 23.4])],
  ['alte Szene bleibt aufgesetzt', !res.alt.dir && res.alt.mm[0] > 200.9],
  ['keine JS-Fehler', !errs.length],
];
for (const [n, ok] of checks) console.log((ok ? '  OK   ' : '  FEHL ') + n);
await browser.close(); srv.kill();
process.exit(checks.every(c => c[1]) ? 0 : 1);
