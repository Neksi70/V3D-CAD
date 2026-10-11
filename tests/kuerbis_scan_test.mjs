// Regressionstest „🎃 Eigenen Kürbis (Scan) schnitzen“ (_ksn*).
// Simuliert einen Scan: Generator-Kürbis massiv ohne Gesicht → Dreiecke in mm,
// jede Ecke mit Rauschen verschoben, Boden durchlöchert (offene Ränder wie bei
// einem echten Scan), als Binär-STL über den echten Import-Pfad geladen. Dazu
// eine verbeulte Kugel. Geprüft werden beide Modi:
//   • Vorschau-Prismen erscheinen auf dem Objekt
//   • Ergebnis wasserdicht (gerichtete Kanten: jede genau 1× + Gegenrichtung 1×),
//     Volumen > 0, ein Stück, ersetzt das Objekt, Undo stellt es wieder her
//   • Vertieft: an der Augenmitte ist die Haut bis „Tiefe“ weg, darunter voll
//   • Hohl: Mitte innen ist Luft, Wand an der Seite vorhanden, Auge durch die
//     Wand, Boden-Loch offen
// Start: node tests/kuerbis_scan_test.mjs (startet eigenen Dev-Server auf 8813,
// oder V3D_URL=… gegen einen laufenden; dist: zusätzlich V3D_COOKIE=1).
// Bilder: /tmp/ksnshots/*.png
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';

const PORT = 8813;
let srv = null;
let URL = process.env.V3D_URL;
if (!URL) {
  srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
  URL = `http://127.0.0.1:${PORT}/volme3d.html`;
  await new Promise(r => setTimeout(r, 1500));
}
const SHOTS = '/tmp/ksnshots'; fs.mkdirSync(SHOTS, { recursive: true });
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
// Gegen die ausgelieferte dist (Server ohne --dev): V3D_COOKIE=1 holt ein
// Sitzungs-Cookie wie smoke.mjs, sonst leitet der Server auf die Anmeldung um.
if (process.env.V3D_COOKIE) {
  const { execFileSync } = await import('child_process');
  const v = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('ksntest','ksntest@lokal'))"], { cwd: '/home/v3da' }).toString().trim();
  await ctx.addCookies([{ name: 'v3dsess', value: v, domain: new globalThis.URL(URL).hostname, path: '/' }]);
}
const pg = await ctx.newPage();
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function' && typeof window._ksnOpen === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
  if (typeof hideStarter === 'function') hideStarter();
});

await pg.evaluate(() => {
  window._ksnT = {
    // gerichtete Kanten zählen: loch = Kante ohne Gegenrichtung, doppelt = >1×
    edges(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      const key = i => { const j = idx ? idx.getX(i) : i;
        return Math.round(p.getX(j)*1e4)+','+Math.round(p.getY(j)*1e4)+','+Math.round(p.getZ(j)*1e4); };
      const m = new Map(); let tris = 0, degen = 0;
      for (let t = 0; t < n; t += 3) {
        const a = key(t), b2 = key(t+1), c = key(t+2);
        if (a===b2 || b2===c || a===c) { degen++; continue; }
        tris++;
        for (const [u,v] of [[a,b2],[b2,c],[c,a]]) m.set(u+'|'+v, (m.get(u+'|'+v)||0)+1);
      }
      let loch = 0, doppelt = 0;
      for (const [k,v] of m) { const [u,w] = k.split('|'); if (!m.get(w+'|'+u)) loch++; if (v > 1) doppelt++; }
      return { tris, degen, loch, doppelt };
    },
    vol(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count; let V = 0;
      const g = (i,k) => { const j = idx ? idx.getX(i) : i; return k===0?p.getX(j):k===1?p.getY(j):p.getZ(j); };
      for (let t = 0; t < n; t += 3) {
        const ax=g(t,0),ay=g(t,1),az=g(t,2), bx=g(t+1,0),by=g(t+1,1),bz=g(t+1,2), cx=g(t+2,0),cy=g(t+2,1),cz=g(t+2,2);
        V += ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx);
      }
      return V/6;
    },
    // Punkt (Welt, App-Units) innen? Parität entlang einer schiefen Richtung
    inside(mesh, x, y, z) {
      mesh.updateMatrixWorld(true);
      const rc = new THREE.Raycaster(new THREE.Vector3(x,y,z), new THREE.Vector3(0.5771, 0.5773, 0.5775).normalize(), 0, 1e4);
      return rc.intersectObject(mesh, false).length % 2 === 1;
    },
    // Dreiecke (mm, Z-up) → Binär-STL
    stl(t) {
      const nTri = t.length / 9, buf = new ArrayBuffer(84 + nTri * 50), dv = new DataView(buf);
      dv.setUint32(80, nTri, true); let off = 84;
      for (let i = 0; i < nTri; i++) { off += 12;
        for (let k = 0; k < 9; k++) { dv.setFloat32(off, t[i*9+k], true); off += 4; }
        dv.setUint16(off, 0, true); off += 2; }
      return buf;
    },
    // Rauschen je Ecke (gleiche Ecke → gleicher Versatz, damit Nachbarn
    // zusammenbleiben), dann Bodenloch(er) ausstanzen
    scanify(tris, amp, holes) {
      let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity;
      for (let i=0;i<tris.length;i+=3){ x0=Math.min(x0,tris[i]); x1=Math.max(x1,tris[i]); y0=Math.min(y0,tris[i+1]); y1=Math.max(y1,tris[i+1]); z0=Math.min(z0,tris[i+2]); }
      const cx=(x0+x1)/2, cy=(y0+y1)/2;
      let seed = 12345; const rnd = () => (seed = (seed*1103515245+12345) & 0x7fffffff) / 0x7fffffff;
      const off = new Map(), out = [];
      const disp = (x,y,z) => {
        const k = Math.round(x*1e3)+','+Math.round(y*1e3)+','+Math.round(z*1e3);
        let d = off.get(k); if (!d) { d = [(rnd()-0.5)*amp, (rnd()-0.5)*amp, (rnd()-0.5)*amp]; off.set(k, d); }
        return [x+d[0], y+d[1], z+d[2]];
      };
      let weg = 0;
      for (let i=0;i<tris.length;i+=9){
        const mz=(tris[i+2]+tris[i+5]+tris[i+8])/3, mx=(tris[i]+tris[i+3]+tris[i+6])/3-cx, my=(tris[i+1]+tris[i+4]+tris[i+7])/3-cy;
        if (holes.some(h => mz < z0+h.z && Math.hypot(mx-h.x, my-h.y) < h.r)) { weg++; continue; }
        for (let k=0;k<9;k+=3) out.push(...disp(tris[i+k],tris[i+k+1],tris[i+k+2]));
      }
      return { tris: new Float32Array(out), weg };
    },
    importStl(tris, name) {
      const n0 = objects.length;
      _addImportedStl(this.stl(tris), name, false);
      return objects.length > n0 ? objects[objects.length-1] : null;
    }
  };
});


// Bildbeleg: von vorn auf die Teile schauen (Gesicht zeigt nach vorn = +Z)
async function shot(name, deselect) {
  await pg.evaluate((d) => {
    document.querySelectorAll('button').forEach(x => { if (/^Später$/.test(x.textContent.trim()) && x.offsetParent) x.click(); });
    if (d) selectObjs([]);
    setView('front'); fitToObjects(objects);
  }, !!deselect);
  await pg.mouse.move(760, 500); await pg.mouse.move(770, 505);
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: `${SHOTS}/${name}.png` });
}

// ── Testobjekte anlegen ───────────────────────────────────────────────────
async function makeKuerbisScan() {
  return pg.evaluate(async () => {
    _newCreate(false);
    const bak = { ..._kbsP };
    Object.assign(_kbsP, _KBS_DEFAULTS, { modus:'massiv', face:'ohne', dia:110, hoehe:72, ribDepth:7, seed:3 });
    const n0 = objects.length;
    try { await _kbsCreate(); } finally { Object.assign(_kbsP, bak); }
    const gen = objects.slice(n0);
    let tris = _moldCollectTris(gen[0]);
    for (const g of gen) { scene.remove(g); }
    objects.splice(n0);
    const s = _ksnT.scanify(tris, 0.5, [{x:0,y:0,r:9,z:4},{x:14,y:-6,r:4,z:4}]);
    const o = _ksnT.importStl(s.tris, 'kuerbis-scan.stl');
    const e = _ksnT.edges(o.geometry);
    return { ok: !!o, tris: s.tris.length/9, weg: s.weg, loch: e.loch };
  });
}
async function makeKugelScan() {
  return pg.evaluate(() => {
    _newCreate(false);
    // verbeulte Kugel Ø ~90 mm, Kugelgitter mit Beulen + Bodenloch
    const g = new THREE.SphereGeometry(45, 120, 80).toNonIndexed();
    const p = g.attributes.position, t = new Float32Array(p.count*3);
    for (let i = 0; i < p.count; i++) {
      let x=p.getX(i), y=p.getY(i), z=p.getZ(i);
      const a = Math.atan2(z, x), r = Math.hypot(x,y,z);
      const f = 1 + 0.06*Math.cos(8*a) + 0.03*Math.sin(3*y/12);
      x*=f; z*=f; y*=0.85;
      // Y-up → Z-up (x, -z, y), Wicklung bleibt (Drehung)
      t[i*3]=x; t[i*3+1]=-z; t[i*3+2]=y;
    }
    const s = _ksnT.scanify(t, 0.4, [{x:0,y:0,r:7,z:3}]);
    const o = _ksnT.importStl(s.tris, 'beule.stl');
    return { ok: !!o, tris: s.tris.length/9, weg: s.weg, loch: _ksnT.edges(o.geometry).loch };
  });
}

// Gesicht schnitzen über die UI-Funktionen; liefert Messwerte
async function carve(opts, tag) {
  const r0 = await pg.evaluate(o => {
    const src = objects[objects.length-1];
    selectObjs([src]); updateCtxPopup();
    const ctxSichtbar = document.getElementById('ctx-ksn').style.display !== 'none';
    _ksnOpen();
    for (const [k,v] of Object.entries(o)) _ksnSet(k, v);
    _ksnPreview();
    const prev = _ksnPrev;
    const c = _ksnGeom(src), fr = _ksnFrame(c, _ksnP);
    const maxC = _ksnMaxC(c, fr);
    // Messpunkt: Mitte des ersten Polygons (linkes Auge) in Welt-mm
    const pl = fr.polys[0]; let a=0, bb=0; for (const q of pl) { a+=q[0]; bb+=q[1]; } a/=pl.length; bb/=pl.length;
    return { ctxSichtbar, popOffen: document.getElementById('ksn-pop').style.display === 'block',
      prev: !!(prev && prev.parent && prev.geometry.attributes.position.count > 0),
      maxC, eye: [a, bb], belly: c.belly, R: c.R, H: c.H, n0: objects.length, srcId: src.userData.id,
      vol0: _ksnT.vol(src.geometry) * 1, undo0: undoStack.length };
  }, opts);
  // Bildbeleg Vorschau
  await shot(tag + '_vorschau', false);
  const r = await pg.evaluate(async (eye) => {
    const t0 = performance.now();
    await _ksnApply();
    const ms = Math.round(performance.now() - t0);
    const res = objects[objects.length-1];
    const geo = res.geometry;
    const e = _ksnT.edges(geo);
    // Welt-mm → App-Welt: (x, y, z)mm Z-up → (x/10, z/10, -y/10)
    const c = _ksnCache || _ksnGeom(res);
    const P = _ksnP, th = (P.dreh||0)*Math.PI/180, f=[Math.sin(th),-Math.cos(th)], rr=[Math.cos(th),Math.sin(th)];
    const zc = c.minZ + c.H*P.hoehe/100;
    const at = (cc, a = eye[0], b = eye[1]) => { const xm=c.cx+a*rr[0]+cc*f[0], ym=c.cy+a*rr[1]+cc*f[1], zm=zc+b;
      return _ksnT.inside(res, xm/10, zm/10, -ym/10); };
    let teile = 1;
    try { const w = await _mfInit(); const m = _mfFromSoup(w, _moldCollectTris(res)); teile = m.decompose().length; m.delete(); } catch (x) { teile = -1; }
    return { ms, name: res.userData.name, srcWeg: !objects.some(o => o.userData.ksn === undefined && o.userData.name && o.userData.name.startsWith('kuerbis-scan') && false),
      ersetzt: res.userData.ksn !== undefined, edges: e, vol: _ksnT.vol(geo)*1e-3*1000, teile, cache: { cx:c.cx, cy:c.cy, minZ:c.minZ, H:c.H, rMax:c.rMax },
      at, n1: objects.length, undo1: undoStack.length,
      probe: { mitte: at(0, 0, 0) } , zc, f, rr };
  }, r0.eye).catch(e => ({ err: String(e) }));
  return { r0, r };
}

// ── Lauf 1: Kürbis-Scan, vertieft ─────────────────────────────────────────
const k1 = await makeKuerbisScan();
ok('Kürbis-Scan importiert (mit offenen Rändern)', k1.ok && k1.loch > 0, k1);
let { r0, r } = await carve({ modus:'tief', tiefe:3, face:'klassisch' }, 'kuerbis_tief');
ok('🎃 im Kontextmenü bei Import sichtbar', r0.ctxSichtbar);
ok('Panel offen + Vorschau-Prismen in der Szene', r0.popOffen && r0.prev, { belly: r0.belly });
ok('Vorschau: alle Gesichtsteile treffen den Kürbis', r0.maxC.every(v => v > 0), r0.maxC.map(v => Math.round(v)));
ok('Vertieft: kein Fehler', !r.err, r.err); console.log('       Laufzeit', r.ms, 'ms');
if (!r.err) {
  ok('Vertieft: Objekt ersetzt (gleiche Anzahl, geschnitzt)', r.n1 === r0.n0 && r.ersetzt, { n0: r0.n0, n1: r.n1, name: r.name });
  ok('Vertieft: wasserdicht (0 offene, 0 doppelte Kanten)', r.edges.loch === 0 && r.edges.doppelt === 0, r.edges);
  ok('Vertieft: ein Stück', r.teile === 1, r.teile);
  ok('Vertieft: Undo-Eintrag angelegt', r.undo1 === r0.undo0 + 1, [r0.undo0, r.undo1]);
}
// Tiefe an der Augenmitte prüfen: Haut-Abstand aus der Vorschau (maxC ~ höchster Hautpunkt)
const depthCheck = await pg.evaluate((args) => {
  const res = objects[objects.length-1];
  const c = _ksnGeom(res), P = _ksnP, th = (P.dreh||0)*Math.PI/180, f=[Math.sin(th),-Math.cos(th)], rr=[Math.cos(th),Math.sin(th)];
  const zc = c.minZ + c.H*P.hoehe/100;
  // Haut entlang des Strahls von vorn suchen: erste Stelle, an der das Ergebnis voll ist
  const inside = (cc) => { const xm=c.cx+args.eye[0]*rr[0]+cc*f[0], ym=c.cy+args.eye[0]*rr[1]+cc*f[1], zm=zc+args.eye[1];
    return _ksnT.inside(res, xm/10, zm/10, -ym/10); };
  let firstSolid = null;
  for (let cc = c.rMax + 5; cc > 0; cc -= 0.25) if (inside(cc)) { firstSolid = cc; break; }
  return { firstSolid, skin: args.skin };
}, { eye: r0.eye, skin: null });
await shot('kuerbis_tief_ergebnis', true);

// Undo stellt den Scan wieder her
const undo = await pg.evaluate(async () => { undo(); await new Promise(r => setTimeout(r, 300));
  const o = objects[objects.length-1]; return { name: o.userData.name, ksn: !!o.userData.ksn }; });
ok('Undo bringt den ungeschnitzten Scan zurück', !undo.ksn && /kuerbis-scan/.test(undo.name), undo);

// Haut ohne Schnitz (nach Undo) an derselben Stelle messen → Tiefe = Differenz
const skin = await pg.evaluate((eye) => {
  const res = objects[objects.length-1];
  const c = _ksnGeom(res), P = _ksnP, th = (P.dreh||0)*Math.PI/180, f=[Math.sin(th),-Math.cos(th)], rr=[Math.cos(th),Math.sin(th)];
  const zc = c.minZ + c.H*P.hoehe/100;
  const inside = (cc) => { const xm=c.cx+eye[0]*rr[0]+cc*f[0], ym=c.cy+eye[0]*rr[1]+cc*f[1], zm=zc+eye[1];
    return _ksnT.inside(res, xm/10, zm/10, -ym/10); };
  for (let cc = c.rMax + 5; cc > 0; cc -= 0.25) if (inside(cc)) return cc;
  return null;
}, r0.eye);
const tiefeIst = skin != null && depthCheck.firstSolid != null ? skin - depthCheck.firstSolid : null;
ok('Vertieft: Auge ist ~3 mm tief (2–4,2 mm)', tiefeIst != null && tiefeIst > 2 && tiefeIst < 4.2, { skin, boden: depthCheck.firstSolid, tiefeIst });

// ── Lauf 2: Kürbis-Scan, durchbrochen + hohl ──────────────────────────────
await pg.evaluate(() => { selectObjs([objects[objects.length-1]]); });
({ r0, r } = await carve({ modus:'hohl', wall:2.8, loch:40, face:'gruselig', dreh:20 }, 'kuerbis_hohl'));
ok('Hohl: kein Fehler', !r.err, r.err); console.log('       Laufzeit', r.ms, 'ms');
if (!r.err) {
  ok('Hohl: wasserdicht (0 offene, 0 doppelte Kanten)', r.edges.loch === 0 && r.edges.doppelt === 0, r.edges);
  ok('Hohl: ein Stück', r.teile === 1, r.teile);
  ok('Hohl: Volumen deutlich kleiner als massiv (< 45 %)', r.vol > 0 && r.vol < r0.vol0 * 0.45, { vol: Math.round(r.vol), vol0: Math.round(r0.vol0) });
}
const hohl = await pg.evaluate((eye) => {
  const res = objects[objects.length-1];
  const c = _ksnGeom(res), P = _ksnP, th = (P.dreh||0)*Math.PI/180, f=[Math.sin(th),-Math.cos(th)], rr=[Math.cos(th),Math.sin(th)];
  const zc = c.minZ + c.H*P.hoehe/100;
  const inside = (a, b, cc) => { const xm=c.cx+a*rr[0]+cc*f[0], ym=c.cy+a*rr[1]+cc*f[1], zm=zc+b;
    return _ksnT.inside(res, xm/10, zm/10, -ym/10); };
  // Strahl von vorn durchs Auge: darf nirgends Material treffen, bis zur Mitte
  let augeVoll = 0; for (let cc = c.rMax + 3; cc > 0; cc -= 0.3) if (inside(eye[0], eye[1], cc)) augeVoll++;
  // Strahl seitlich (90° neben dem Gesicht): Wand vorhanden, Dicke messen
  let wand = 0; const a90 = [rr[0], rr[1]];
  for (let s = c.rMax + 3; s > 0; s -= 0.1) { const xm=c.cx+s*a90[0], ym=c.cy+s*a90[1];
    if (_ksnT.inside(res, xm/10, zc/10, -ym/10)) wand += 0.1; }
  const mitteLuft = !_ksnT.inside(res, c.cx/10, zc/10, -c.cy/10);
  // Boden-Loch: senkrecht von unten in der Mitte darf bis in den Hohlraum nichts sein
  let bodenVoll = 0; for (let z = c.minZ + 0.2; z < c.minZ + 12; z += 0.3) if (_ksnT.inside(res, c.cx/10, z/10, -c.cy/10)) bodenVoll++;
  return { augeVoll, wand: Math.round(wand*10)/10, mitteLuft, bodenVoll };
}, r0.eye);
ok('Hohl: Mitte ist Luft', hohl.mitteLuft, hohl);
ok('Hohl: Auge geht ganz durch die Wand', hohl.augeVoll === 0, hohl);
ok('Hohl: Seitenwand ~2,8 mm (2,2–4,5 inkl. Furchen-Schräge)', hohl.wand >= 2.2 && hohl.wand <= 4.5, hohl.wand);
ok('Hohl: Boden-Loch offen', hohl.bodenVoll === 0, hohl);
await shot('kuerbis_hohl_ergebnis', true);

// ── Lauf 3: verbeulte Kugel, hohl ─────────────────────────────────────────
const k2 = await makeKugelScan();
ok('Kugel-Scan importiert (mit Bodenloch)', k2.ok && k2.loch > 0, k2);
({ r0, r } = await carve({ modus:'hohl', wall:2.4, loch:38, face:'froehlich', dreh:0, size:100 }, 'kugel_hohl'));
ok('Kugel hohl: kein Fehler', !r.err, r.err);
if (!r.err) {
  ok('Kugel hohl: wasserdicht', r.edges.loch === 0 && r.edges.doppelt === 0, r.edges);
  ok('Kugel hohl: ein Stück', r.teile === 1, r.teile);
}
await shot('kugel_hohl_ergebnis', true);

// ── Lauf 3b: kaputter Scan (doppelte + umgedrehte Dreiecke), vertieft ──────
const k3 = await pg.evaluate(() => {
  _newCreate(false);
  const g = new THREE.SphereGeometry(40, 96, 64).toNonIndexed();
  const p = g.attributes.position, t = [];
  for (let i = 0; i < p.count; i++) { const x=p.getX(i), y=p.getY(i), z=p.getZ(i); t.push(x*(1+0.05*Math.cos(6*Math.atan2(z,x))), -z, y*0.8); }
  const n = t.length/9;
  // jedes 37. Dreieck doppelt, jedes 41. als umgedrehtes Doppel, jedes 53.
  // an Ort und Stelle umgedreht (uneinheitliche Normalen) → nicht manifold
  for (let i = 0; i < n; i += 37) t.push(...t.slice(i*9, i*9+9));
  for (let i = 3; i < n; i += 41) { const a = t.slice(i*9, i*9+9); t.push(a[0],a[1],a[2], a[6],a[7],a[8], a[3],a[4],a[5]); }
  for (let i = 5; i < n; i += 53) { for (let k = 0; k < 3; k++) { const u = t[i*9+3+k]; t[i*9+3+k] = t[i*9+6+k]; t[i*9+6+k] = u; } }
  const s = _ksnT.scanify(new Float32Array(t), 0.3, [{x:0,y:0,r:6,z:3}]);
  const o = _ksnT.importStl(s.tris, 'kaputt.stl');
  return { ok: !!o, tris: s.tris.length/9 };
});
ok('Kaputter Scan importiert', k3.ok, k3);
const msgs3 = [];
await pg.exposeFunction('_ksnMsg', m => msgs3.push(m));
await pg.evaluate(() => { const o = window.notify; window.notify = (m, t) => { window._ksnMsg(String(m)); return o(m, t); }; });
({ r0, r } = await carve({ modus:'tief', tiefe:2.5, face:'klassisch', dreh:0 }, 'kaputt_tief'));
ok('Kaputt vertieft: kein Fehler', !r.err, r.err);
if (!r.err) {
  ok('Kaputt vertieft: wasserdicht', r.edges.loch === 0 && r.edges.doppelt === 0, r.edges);
  ok('Kaputt vertieft: ein Stück', r.teile === 1, r.teile);
}
console.log('       Meldung:', msgs3.filter(m => /Gesicht|Kürbis|Schnitz/.test(m)).slice(-1)[0], '· Laufzeit', r.ms, 'ms');
await shot('kaputt_tief_ergebnis', true);

// ── Lauf 4: Hinweis ohne Auswahl + Einstieg im Generator ──────────────────
const ui = await pg.evaluate(() => {
  selectObjs([]); const msgs = [];
  const orig = window.notify; window.notify = (m, t) => { msgs.push(m); };
  try { _ksnOpen(); } finally { window.notify = orig; }
  _openKbsModal();
  const btn = [...document.querySelectorAll('#kbs-modal button')].find(x => /Gewählten Kürbis schnitzen/.test(x.textContent));
  _closeKbsModal();
  return { msgs, popZu: document.getElementById('ksn-pop').style.display !== 'block', btn: !!btn };
});
ok('Ohne Auswahl: Hinweis statt Fehler', ui.msgs.length === 1 && /anklicken/.test(ui.msgs[0]) && ui.popZu, ui);
ok('Abschnitt im Kürbis-Generator vorhanden', ui.btn);

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
if (srv) srv.kill();
console.log(fails.length ? `\n${fails.length} FEHLER: ${fails.join(' | ')}` : '\nAlle Prüfungen bestanden. Bilder: ' + SHOTS);
process.exit(fails.length ? 1 : 0);
