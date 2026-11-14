// Kurs 8.10.: Arbeitsebene oben auf die Box, Versatz nach unten, neues Teil am grünen Pfeil
// nach unten gezogen → Anzeige sagte „Y“, gemeint ist die Höhe = Z (wie Maße und Slicer).
// Prüft die Zug-Anzeige für alle drei Pfeile und die Beschriftung von Position/Rotation.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';

const PORT = 8865;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.env.V3D_DIR || '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fehler = 0; const ok = (b, t, x) => { console.log((b ? '  OK   ' : '  FEHL ') + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!b) fehler++; };
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const tip = (axis, f = 0.8) => pg.evaluate(([axis, f]) => { _mgUpdate(); const g = _mg.group; const v = _mgAxisVec(axis);
  return g.position.clone().addScaledVector(v, f * g.scale.x).toArray(); }, [axis, f]);

try {
  await pg.goto(`http://localhost:${PORT}/volme3d.html`);
  await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => {
    hideStarter(); _newCreate(false);
    const box = (w, d, h) => { addShape('box'); const o = objects[objects.length - 1]; selectObjs([o]); numChanged('sw', w); numChanged('sd', d); numChanged('sh', h); return o; };
    const A = box(80, 60, 35);
    _wpBaseN = new THREE.Vector3(0, 1, 0); _wpBaseP = new THREE.Vector3(0, 3.5, 0);
    document.getElementById('wp-off').value = -5.4; _wpAdjust();
    setShapeMode('hole'); const C = box(78, 56, 3.4); setShapeMode('solid');
    selectObjs([C]);
    orbitTarget.set(0, 2.5, 0); sph.theta = 0.6; sph.phi = 1.1; sph.r = 30; sph2cam(); camera.updateMatrixWorld(true);
  });
  await pg.mouse.click(5, 900); await pg.evaluate(() => selectObjs([objects[objects.length - 1]])); await pg.waitForTimeout(300);

  // Seit 1.18.406 (Oswald): nur der Achsname, ohne „Breite/Tiefe/Höhe“ (klang nach Größenänderung)
  for (const [achse, dy, erwartet] of [['y', 60, 'Z'], ['x', 0, 'X'], ['z', 0, 'Y']]) {
    const t = await scr(await tip(achse));
    await pg.mouse.move(t.x, t.y); await pg.mouse.down();
    const ziel = dy ? { x: t.x, y: t.y + dy } : { x: t.x + 40, y: t.y + 25 };
    for (let i = 1; i <= 10; i++) { await pg.mouse.move(t.x + (ziel.x - t.x) * i / 10, t.y + (ziel.y - t.y) * i / 10); await pg.waitForTimeout(20); }
    const anzeige = await pg.evaluate(() => { const el = document.getElementById('mg-tip'); return el && el.style.display !== 'none' ? el.textContent : null; });
    await pg.mouse.up(); await pg.waitForTimeout(150);
    ok(anzeige && new RegExp('^' + erwartet + ' [+−±]').test(anzeige) && anzeige.includes('Mitte bei ' + erwartet + ' =') && !/Breite|Tiefe|Höhe/.test(anzeige), `Pfeil intern ${achse} zeigt „${erwartet}“`, anzeige);
    if (achse === 'y') ok(/−/.test(anzeige || ''), 'nach unten gezogen = negativ', anzeige);
  }

  const lbl = await pg.evaluate(() => {
    const zeile = id => [...document.getElementById(id).parentElement.querySelectorAll('.xt')].map(s => s.textContent + '→' + s.nextElementSibling.id).join(' ');
    return { pos: zeile('px'), rot: zeile('rx') };
  });
  ok(lbl.pos === 'X→px Y→pz Z→py', 'Position: Z ist die Höhe', lbl.pos);
  ok(lbl.rot === 'X→rx Y→rz Z→ry', 'Rotation: Z dreht um die Hochachse', lbl.rot);
  ok(!errs.length, 'keine Seitenfehler', errs);
} finally { await b.close(); srv.kill(); }
console.log(fehler ? `${fehler} FEHLER` : 'ALLES OK');
process.exit(fehler ? 1 : 0);
