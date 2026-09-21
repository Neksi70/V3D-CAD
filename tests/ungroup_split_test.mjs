// Test: „Aufheben" auf ein einzelnes Netz aus mehreren getrennten Teilen
// zerlegt es (Ralf 21.9.2026: zwei Böcke als ein STL — „das ist keine Gruppe").
// Hohlkörper (Innenwand) und zusammenhängende Teile bleiben ganz.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });

const res = await pg.evaluate(async () => {
  const box = (sx, sy, sz, tx, ty, tz, inv) => {
    const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); g.translate(tx, ty, tz);
    if (inv) { const p = g.attributes.position; for (let i = 0; i < p.count; i += 3) { for (const k of ['X','Y','Z']) { const a = p['get'+k](i+1); p['set'+k](i+1, p['get'+k](i+2)); p['set'+k](i+2, a); } } }
    return g.attributes.position.array;
  };
  const make = (arrs) => {
    _newCreate(false);
    const n = arrs.reduce((s, a) => s + a.length, 0), v = new Float32Array(n); let o = 0;
    arrs.forEach(a => { v.set(a, o); o += a.length; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(v, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#3377ff' }));
    m.userData = { id: idCtr++, name: 'Böcke', color: '#3377ff', isHole: false, type: 'custom' };
    m.position.set(2, 0, -1); m.rotation.y = 0.4; m.scale.set(1, 1, -1);   // Lage + Spiegelung mitprüfen
    scene.add(m); objects.push(m); selectObjs([m]);
    return m;
  };
  const vol = objs => objs.reduce((s, o) => { const bb = getMeshBox(o); return s; }, 0);
  const wait = () => new Promise(r => setTimeout(r, 1500));
  const out = {};
  // 1) zwei getrennte Böcke
  let m = make([box(2, 3, 1, -3, 1.5, 0), box(2, 3, 1, 3, 1.5, 0)]);
  const bb0 = getMeshBox(m);
  ungroupSelected(); await wait();
  out.two = { n: objects.length, sel: selectedObjs.length, names: objects.map(o => o.userData.name),
              bbOk: (() => { const u = new THREE.Box3(); objects.forEach(o => u.union(getMeshBox(o))); return u.min.distanceTo(bb0.min) + u.max.distanceTo(bb0.max); })(),
              vol: objects.map(o => { const p = o.geometry.attributes.position; let v = 0; for (let i = 0; i < p.count; i += 3) { const a = new THREE.Vector3().fromBufferAttribute(p, i), b2 = new THREE.Vector3().fromBufferAttribute(p, i+1), c = new THREE.Vector3().fromBufferAttribute(p, i+2); v += a.dot(b2.cross(c)) / 6; } return v; }) };
  undo(); await new Promise(r => setTimeout(r, 300));
  out.undo = objects.length;
  // 2) Hohlkörper: Außenwand + umgedrehte Innenwand → bleibt ein Teil
  make([box(4, 4, 4, 0, 2, 0), box(2, 2, 2, 0, 2, 0, true)]);
  ungroupSelected(); await wait();
  out.hollow = objects.length;
  // 3) einfacher Würfel → nichts zu trennen
  make([box(2, 2, 2, 0, 1, 0)]);
  ungroupSelected(); await wait();
  out.single = objects.length;
  out.toast = [...document.querySelectorAll('.ni')].map(e => e.textContent).slice(-1)[0];
  return out;
});
ok('zwei Böcke → 2 Teile', res.two.n === 2, res.two.names);
ok('beide ausgewählt', res.two.sel === 2);
ok('Lage unverändert (Gesamt-Bbox)', res.two.bbOk < 1e-4, res.two.bbOk);
ok('Teile sind geschlossen + außen-orientiert (Volumen 6)', res.two.vol.every(v => Math.abs(v - 6) < 1e-3), res.two.vol);
ok('Rückgängig stellt das eine Netz wieder her', res.undo === 1, res.undo);
ok('Hohlkörper bleibt ein Teil', res.hollow === 1, res.hollow);
ok('einzelnes Stück bleibt ein Teil', res.single === 1, res.single);
ok('Hinweis nennt Schneiden', /Schneiden/.test(res.toast || ''), res.toast);
ok('keine Seitenfehler', errs.length === 0, errs);
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
