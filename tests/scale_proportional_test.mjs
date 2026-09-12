// Test: Die weißen Eck-Anfasser ziehen PROPORTIONAL, und im Modus „Größe"
// bleiben die Anfasser anfassbar.
// Ralf 12.9.26: „Mit angeklicktem Pfeil wird das Modell über den Schieber am
// Rand nicht proportional größer oder kleiner, sondern wird gestaucht. Beim
// Umstellen auf Skalieren verschwinden wieder die Schiebekästchen."
// Der Fehler zeigt sich nur an FLACHEN Körpern: Früher bekam jede Kante
// denselben Millimeter-Zuschlag statt denselben Faktor — aus 100×100×10 wurde
// 150×150×60. Bei einem Würfel fällt das nicht auf, darum hier eine Platte.
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show');
                          document.getElementById('auth-overlay')?.classList.add('hidden'); });

await pg.evaluate(() => {
  // Fasst den Griff `key` und zieht ihn um `px` Pixel nach AUSSEN (px<0 = nach
  // innen); meldet die Kantenlängen vorher/nachher.
  window._zieh = (key, px, sc) => {
    const o = getFirst();
    o.scale.set(sc[0], sc[1], sc[2]); o.rotation.set(0, 0, 0); o.position.set(0, sc[1], 0);
    o.updateMatrixWorld(true);
    selectObjs([o]); setMode('select'); updateDimHandles();
    const item = _dimHandleData.find(d => d.key === key);
    if (!item) return { skip: 'kein Griff ' + key };
    if (item.el.style.visibility === 'hidden') return { skip: 'Griff liegt hinten' };
    camera.updateMatrixWorld(true);
    const vr = vpEl.getBoundingClientRect(), cR = canvas.getBoundingClientRect();
    const c = getMeshBox(o).getCenter(new THREE.Vector3()).project(camera);
    const cs = { x: (cR.left - vr.left) + (c.x + 1) / 2 * vr.width,
                 y: (cR.top - vr.top) + (-c.y + 1) / 2 * vr.height };
    let ux = item.sx - cs.x, uy = item.sy - cs.y;
    const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
    const s0 = getMeshBox(o).getSize(new THREE.Vector3());
    const von = { x: vr.left + item.sx, y: vr.top + item.sy };
    const pe = (t, x, y, tg) => tg.dispatchEvent(new PointerEvent(t,
      { clientX: x, clientY: y, button: 0, buttons: 1, pointerType: 'mouse', bubbles: true, cancelable: true }));
    pe('pointerdown', von.x, von.y, item.el);
    const gefasst = !!_dragHandle;
    pe('pointermove', von.x + ux * px, von.y + uy * px, window);
    const s1 = getMeshBox(o).getSize(new THREE.Vector3());
    pe('pointerup', von.x + ux * px, von.y + uy * px, window);
    const r3 = v => Math.round(v * 1000) / 100;                 // App-Einheit → mm
    return { gefasst, vor: [r3(s0.x), r3(s0.y), r3(s0.z)], nach: [r3(s1.x), r3(s1.y), r3(s1.z)],
             fx: +(s1.x/s0.x).toFixed(4), fy: +(s1.y/s0.y).toFixed(4), fz: +(s1.z/s0.z).toFixed(4) };
  };
});
await pg.evaluate(() => { [...objects].forEach(o => scene.remove(o)); objects.length = 0;
                          addShape('box'); selectObjs([objects[0]]); });

// Flache Platte 100 × 10 × 100 mm (Grundbox = 20 mm je Einheit)
let geprueft = 0;
for (const key of ['c000','c100','c010','c110','c001','c101','c011','c111']) {
  for (const px of [80, -40]) {
    const r = await pg.evaluate(([k, p]) => _zieh(k, p, [5, 0.5, 5]), [key, px]);
    if (r.skip) continue;
    geprueft++;
    ok('Platte, Ecke ' + key + ' ' + (px > 0 ? 'nach außen' : 'nach innen') + ': gleicher Faktor auf allen Kanten',
       Math.abs(r.fx - r.fy) < 0.02 && Math.abs(r.fx - r.fz) < 0.02, r);
    ok('Platte, Ecke ' + key + ': Richtung stimmt', px > 0 ? r.fx > 1.05 : r.fx < 0.95, { f: r.fx });
  }
}
ok('Es wurden sichtbare Ecken geprüft', geprueft >= 6, { geprueft });

// Würfel: Zugtempo unverändert (Bezug ist die längste Kante).
// Achtung: Bei kleinen Körpern liegt der Eckgriff über einem Pfeil des
// Achsen-Gizmos — der greift auf pointerdown absichtlich zuerst zu (_mgDown).
// Darum ein Würfel mit 40 mm, und wenn der Gizmo doch davor liegt: überspringen.
let w = null;
for (const eck of ['c111', 'c011', 'c101']) {
  w = await pg.evaluate((k) => _zieh(k, 60, [2, 2, 2]), eck);
  if (w.gefasst) break;
}
if (w && w.gefasst) ok('Würfel: proportional', Math.abs(w.fx - w.fy) < 0.01 && Math.abs(w.fx - w.fz) < 0.01, w);
else console.log('  ÜBERSPRUNGEN Würfel (Achsen-Gizmo liegt über allen Eckgriffen)');

// Modus „Größe": Anfasser bleiben anfassbar, in Verschieben/Drehen nicht
const m = await pg.evaluate(() => {
  const zustand = (mode) => {
    setMode(mode);
    const dh = document.getElementById('dim-handles');
    const el = _dimHandleData.find(d => d.cls === 'h-white')?.el;
    if (!el) return { mode, aus: dh.classList.contains('handles-off'), css: '-', gefasst: false };
    el.dispatchEvent(new PointerEvent('pointerdown',
      { clientX: 0, clientY: 0, button: 0, buttons: 1, pointerType: 'mouse', bubbles: true, cancelable: true }));
    const gefasst = !!_dragHandle;
    if (_dragHandle) window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return { mode, aus: dh.classList.contains('handles-off'), css: getComputedStyle(el).pointerEvents, gefasst };
  };
  const r = ['scale', 'move', 'rotate', 'select'].map(zustand);
  setMode('select');
  return r;
});
const modus = Object.fromEntries(m.map(x => [x.mode, x]));
ok('Größe-Modus: Anfasser anfassbar', !modus.scale.aus && modus.scale.gefasst && modus.scale.css !== 'none', modus.scale);
ok('Verschieben-Modus: Anfasser stumm', modus.move.aus && modus.move.css === 'none', modus.move);
ok('Drehen-Modus: Anfasser stumm', modus.rotate.aus && modus.rotate.css === 'none', modus.rotate);
ok('Auswahl-Modus: Anfasser anfassbar', !modus.select.aus && modus.select.gefasst, modus.select);

await b.close();
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
console.log(fails.length ? ('\nFEHLGESCHLAGEN: ' + fails.join(', ')) : '\nAlle Prüfungen bestanden.');
process.exit(fails.length ? 1 : 0);
