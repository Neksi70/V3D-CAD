// Test: „Form folgen — Außenhaut glatt" am Klemmbaustein-Generator.
// Ralf 12.9.26: „Ein Ball soll seine Form behalten — die äußeren Steine müssten
// die Kugel abbilden. Also glatt." … „Was mega wäre, wenn dieses Modell steckbar
// wäre. Es wären dann außen sehr viele Sondersteine. Quasi ein 3D-Puzzle."
// Geprüft wird genau das, woran die Idee scheitern kann:
//   (1) Die Kugel ist hinterher wirklich rund (Radiusstreuung der Hülle),
//   (2) das Netz bleibt wasserdicht (Look-Modus, sonst kein Boolean/Druck mehr),
//   (3) jeder Sonderstein ist EIN Stück (keine losen Splitter im Druck),
//   (4) er bleibt STECKBAR: die Aufnahme unten bleibt frei und die Noppen
//       stehen noch, wo ein Stein darüber sitzt,
//   (5) ein Quader erzeugt KEINE Sondersteine (dort schneidet die Form nichts).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('skin-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { console.log('  (kein Sitzungs-Cookie: ' + e.message.split('\n')[0] + ')'); }
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
pg.on('popup', p => p.close().catch(() => {}));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show');
                          document.getElementById('auth-overlay')?.classList.add('hidden'); });

// ── 1+2) Look-Modus: Kugel bleibt rund und das Netz bleibt dicht ───────────
// Gemessen wird die STUETZFUNKTION: In 200 Richtungen der weiteste Punkt des
// Ergebnisses, geteilt durch den Radius der Ausgangskugel. Bei einer echten
// Kugel ist der Wert ueberall 1. Der eckige Treppenkoerper steht ueberall
// darueber (Zellecken), der angeschmiegte liegt auf der Kugel — nur die Noppen
// ragen heraus, und zwar genau dort, wo sie stehen sollen.
const rund = await pg.evaluate(async () => {
  const bau = async (skin) => {
    [...objects].forEach(o => scene.remove(o)); objects.length = 0; selectObjs([]);
    addShape('sphere'); const o = objects[0]; selectObjs([o]);
    _lgoOpen(); _lgoSetMode('look');
    document.getElementById('lgo-studs').value = 12;
    document.getElementById('lgo-skin').checked = skin; _lgoInfo();
    await _lgoCreate(); await new Promise(r => setTimeout(r, 200));
    const m = objects.find(x => x !== o);
    const p = m.geometry.attributes.position.array;
    const bb = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position);
    const c = bb.getCenter(new THREE.Vector3());
    const rIdeal = 12 * 8 / 2;                       // 12 Noppen breit → Ø96 mm
    let maxS = -1e9, minS = 1e9, sum = 0;
    for (let k = 0; k < 200; k++) {                  // Fibonacci-Richtungen
      const z = 1 - 2 * (k + 0.5) / 200, rr = Math.sqrt(1 - z*z), th = k * 2.399963;
      const dx = rr*Math.cos(th), dy = rr*Math.sin(th), dz = z;
      let s = -1e9;
      for (let i = 0; i < p.length; i += 3) {
        const v = (p[i]-c.x)*dx + (p[i+1]-c.y)*dy + (p[i+2]-c.z)*dz; if (v > s) s = v; }
      maxS = Math.max(maxS, s); minS = Math.min(minS, s); sum += s;
    }
    const nt = p.length / 9, q = 1e4, vid = new Map(), ids = new Int32Array(nt * 3);
    for (let i = 0; i < nt * 3; i++) { const k = Math.round(p[i*3]*q)+'|'+Math.round(p[i*3+1]*q)+'|'+Math.round(p[i*3+2]*q);
      let id = vid.get(k); if (id === undefined) { id = vid.size; vid.set(k, id); } ids[i] = id; }
    const seen = new Set(); let dup = 0;
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const k = ids[t*3+e] + '>' + ids[t*3+(e+1)%3]; if (seen.has(k)) dup++; else seen.add(k); }
    let open = 0; for (const k of seen) { const s2 = k.split('>'); if (!seen.has(s2[1]+'>'+s2[0])) open++; }
    return { mittel: +(sum/200/rIdeal).toFixed(3), max: +(maxS/rIdeal).toFixed(3),
             min: +(minS/rIdeal).toFixed(3), dup, open, tris: nt };
  };
  return { eckig: await bau(false), glatt: await bau(true) };
});
ok('Kugel: Silhouette liegt im Mittel viel näher an der Kugel',
   rund.glatt.mittel < rund.eckig.mittel - 0.05 && rund.glatt.mittel < 1.07, rund);
ok('Kugel: die Außenhaut liegt wirklich AUF der Kugel (nicht darüber)',
   rund.glatt.min <= 1.005 && rund.eckig.min > 1.01,
   { glatt: rund.glatt.min, eckig: rund.eckig.min });
ok('Look-Netz bleibt wasserdicht', rund.glatt.dup === 0 && rund.glatt.open === 0, rund.glatt);

// ── 3+4) Bausatz: Sondersteine sind ein Stück und bleiben steckbar ─────────
const kit = await pg.evaluate(async () => {
  [...objects].forEach(o => scene.remove(o)); objects.length = 0; selectObjs([]);
  addShape('sphere'); const o = objects[0]; selectObjs([o]);
  _lgoOpen(); _lgoSetMode('kit');
  document.getElementById('lgo-studs').value = 10;
  document.getElementById('lgo-skin').checked = true;
  document.getElementById('lgo-guide').checked = false; _lgoInfo();

  // Denselben Weg wie _lgoCreate gehen, aber die Steine einzeln behalten
  const W = await _mfInit(), M = W.Manifold, d = _lgoDims();
  let tris = _moldCollectTris(o);
  let mnX=1/0,mnY=1/0,mnZ=1/0,mxX=-1/0,mxY=-1/0,mxZ=-1/0;
  for (let i = 0; i < tris.length; i += 3) {
    if (tris[i]<mnX) mnX=tris[i]; if (tris[i]>mxX) mxX=tris[i];
    if (tris[i+1]<mnY) mnY=tris[i+1]; if (tris[i+1]>mxY) mxY=tris[i+1];
    if (tris[i+2]<mnZ) mnZ=tris[i+2]; if (tris[i+2]>mxZ) mxZ=tris[i+2]; }
  const sc = d.scale, cx0 = (mnX+mxX)/2, cy0 = (mnY+mxY)/2;
  for (let i = 0; i < tris.length; i += 3) {
    tris[i] = cx0+(tris[i]-cx0)*sc; tris[i+1] = cy0+(tris[i+1]-cy0)*sc; tris[i+2] = mnZ+(tris[i+2]-mnZ)*sc; }
  mnX=cx0+(mnX-cx0)*sc; mxX=cx0+(mxX-cx0)*sc; mnY=cy0+(mnY-cy0)*sc; mxY=cy0+(mxY-cy0)*sc;
  const ox = (mnX+mxX)/2 - d.nx*8/2, oy = (mnY+mxY)/2 - d.ny*8/2, oz = mnZ;
  const acc = _lgoVoxelize(tris, ox, oy, oz, d.nx, d.ny, d.nz, d.h, 3);
  const filled = new Uint8Array(acc.length);
  for (let i = 0; i < acc.length; i++) if (acc[i] >= 0.4) filled[i] = 1;
  _lgoWeld(filled, acc, d.nx, d.ny, d.nz);
  const air = _lgoOutside(filled, d.nx, d.ny, d.nz);
  const bricks = _lgoSplitBricks(filled, d.nx, d.ny, d.nz, 8, true);
  const mModel = _mfFromSoup(W, tris);
  const opt = { clear: 0.2, skin: true };
  const F = (i,j,k) => (i<0||j<0||k<0||i>=d.nx||j>=d.ny||k>=d.nz) ? 0 : filled[(k*d.ny+j)*d.nx+i];

  let sonder = 0, mehrteilig = 0, blockiert = 0, ohneNoppe = 0, geprueftNoppe = 0, geprueftLoch = 0;
  const rStud = 4.8/2 - opt.clear/2;
  for (const bb of bricks) {
    if (!_lgoBrickAussen(bb, air)) continue;
    const norm = await _lgoBrickGeo(bb.w, bb.d, d.h, opt);
    const at = [ox + (bb.i + bb.w/2)*8, oy + (bb.j + bb.d/2)*8, oz + bb.k*d.h];
    const g = await _lgoSkinBrick(W, M, mModel, norm.attributes.position.array, at, bb, d, opt);
    if (!g) continue;
    sonder++;
    if ((g.userData?.teile || 1) > 1) mehrteilig++;
    const mT = _mfFromSoup(W, g.attributes.position.array);       // lokale Koordinaten
    for (let q = 0; q < bb.d; q++) for (let p2 = 0; p2 < bb.w; p2++) {
      const lx = (p2 - (bb.w-1)/2)*8, ly = (q - (bb.d-1)/2)*8;
      // (a) Aufnahme unten frei? Nur wo unten wirklich ein Stein steht.
      if (F(bb.i+p2, bb.j+q, bb.k-1)) {
        geprueftLoch++;
        const pin = M.cylinder(1.8, rStud, rStud, 24, false).translate([lx, ly, 0]);
        const drin = mT.intersect(pin);
        if (drin.volume() > 0.05 * pin.volume()) blockiert++;
        pin.delete(); drin.delete();
      }
      // (b) Noppe oben da, wo ein Stein darüber sitzt?
      if (F(bb.i+p2, bb.j+q, bb.k+1)) {
        geprueftNoppe++;
        const stud = M.cylinder(1.6, rStud*0.8, rStud*0.8, 24, false).translate([lx, ly, d.h + 0.1]);
        const drin = mT.intersect(stud);
        if (drin.volume() < 0.8 * stud.volume()) ohneNoppe++;
        stud.delete(); drin.delete();
      }
    }
    mT.delete();
  }
  mModel.delete();
  return { steine: bricks.length, sonder, mehrteilig, blockiert, geprueftLoch, ohneNoppe, geprueftNoppe };
});
ok('Bausatz: es entstehen Sondersteine', kit.sonder > 10, kit);
ok('Jeder Sonderstein ist EIN Stück', kit.mehrteilig === 0, { mehrteilig: kit.mehrteilig });
ok('Aufnahme bleibt frei — Stein lässt sich aufstecken',
   kit.blockiert === 0 && kit.geprueftLoch > 10, { blockiert: kit.blockiert, geprueft: kit.geprueftLoch });
ok('Noppen stehen, wo ein Stein darüber sitzt',
   kit.ohneNoppe === 0 && kit.geprueftNoppe > 10, { ohne: kit.ohneNoppe, geprueft: kit.geprueftNoppe });

// ── 5) Quader: nichts abzuschneiden → keine Sondersteine ──────────────────
const quader = await pg.evaluate(async () => {
  [...objects].forEach(o => scene.remove(o)); objects.length = 0; selectObjs([]);
  addShape('box'); const o = objects[0]; selectObjs([o]);
  _lgoOpen(); _lgoSetMode('kit');
  document.getElementById('lgo-studs').value = 6;
  document.getElementById('lgo-skin').checked = true;
  document.getElementById('lgo-guide').checked = false; _lgoInfo();
  await _lgoCreate(); await new Promise(r => setTimeout(r, 200));
  return objects.filter(x => x !== o).map(m => m.userData.name).join(' | ');
});
ok('Quader: keine Sondersteine', !/Sonder/.test(quader), quader);

await b.close();
if (errs.length) ok('keine Seitenfehler', false, errs.slice(0, 3));
console.log(fails.length ? ('\nFEHLGESCHLAGEN: ' + fails.join(', ')) : '\nAlles grün');
process.exit(fails.length ? 1 : 0);
